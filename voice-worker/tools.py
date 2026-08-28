"""Function tools que expone el agente al LLM.

Dos grupos:
  1) Tools de negocio (lookup_order, create_checkout, create_order): sólo se
     construyen las que vengan en `tools_enabled`. Su cuerpo únicamente reenvía
     al backend Riverz (POST /voice/tool) y devuelve el `result` (string) verbatim.
  2) Tools de control (siempre presentes): report_outcome, end_call,
     customer_requests_no_more_calls, detected_answering_machine.

Todas comparten un `CallState` mutable que agent.py lee al finalizar la llamada.

NOTE: `@function_tool` + `RunContext` según docs v1.x:
https://docs.livekit.io/agents/build/tools/  (el patrón method+self está en
el ejemplo oficial livekit-examples/outbound-caller-python).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from livekit import api as lkapi
from livekit.agents import RunContext, function_tool, get_job_context

logger = logging.getLogger("riverz-voice.tools")


@dataclass
class CallState:
    """Estado mutable de la llamada. Las tools lo actualizan; agent.py lo reporta."""

    call_id: str = ""
    direction: str = "outbound"  # "outbound" | "inbound"
    # status explícito cuando aplica (voicemail / no_answer / busy / failed).
    # Si queda None y hubo answered_at -> "completed".
    status: str | None = None
    outcome: str | None = None
    outcome_details: dict[str, Any] | None = None
    opt_out: bool = False
    answered_at: str | None = None
    result_posted: bool = False
    transcript: list[dict[str, Any]] = field(default_factory=list)
    # Identidad del participante telefónico (para transferir por SIP REFER).
    phone_identity: str = ""
    # Grabación (LiveKit Egress → S3/Supabase). Se reporta en /result.
    egress_id: str = ""
    recording_key: str | None = None
    recording_url: str | None = None
    # Reloj monotónico de actividad (para el guard de silencio). last_activity_at
    # se refresca con CADA turno (cliente o agente); last_user_at solo cuando
    # habla el CLIENTE. 0.0 = todavía sin marcar (el guard lo inicializa).
    last_activity_at: float = 0.0
    last_user_at: float = 0.0
    # Fallos del modelo DURANTE la llamada (429, 401, proveedor caído). Se
    # cuentan para no reportar como «completada» una llamada en la que el
    # agente saludó y despues se quedo mudo: el cliente sigue hablando solo,
    # el comercio paga, y la automatizacion toma la rama «contesto».
    llm_errors: int = 0
    last_llm_error: str | None = None


async def hangup() -> None:
    """Cuelga eliminando la sala (desconecta a todos). El fin de sesión dispara
    el shutdown callback que reporta el resultado."""
    try:
        jc = get_job_context()
        await jc.api.room.delete_room(lkapi.DeleteRoomRequest(room=jc.room.name))
    except Exception:
        logger.warning("no se pudo colgar (delete_room)", exc_info=True)


async def _graceful_hangup(ctx: RunContext) -> None:
    """Deja que el agente termine de hablar y luego cuelga."""
    try:
        speech = ctx.session.current_speech
        if speech is not None:
            await speech.wait_for_playout()
    except Exception:
        pass
    await hangup()


async def _forward(api, call_state: CallState, tool: str, raw_input: dict[str, Any]) -> str:
    """Reenvía la tool al backend y devuelve el string `result` verbatim al LLM.
    Input permisivo: se descartan los None y el backend valida el resto."""
    payload = {k: v for k, v in raw_input.items() if v is not None}
    try:
        data = await api.run_tool(call_state.call_id, tool, payload)
    except Exception as e:  # fail-soft: el LLM recibe un error legible, no crashea
        logger.warning("tool %s falló: %s", tool, e)
        return json.dumps({"error": f"tool_unavailable: {e}"}, ensure_ascii=False)
    if data.get("ok"):
        return data.get("result", "")
    return json.dumps({"error": data.get("error", "unknown")}, ensure_ascii=False)


def _generic_tool(api, call_state: CallState, spec: dict):
    """Una function tool armada desde el esquema que manda el backend.

    Las de negocio estaban escritas a mano, una por una, así que el teléfono
    tenía cinco herramientas mientras el mismo agente por chat tenía
    diecisiete: sumar una capacidad exigía tocar este archivo y desplegar el
    worker, y nadie se acordaba. Ahora el backend manda `tools` con nombre,
    descripción y JSON Schema, y acá se construyen solas — una capacidad nueva
    llega a la llamada sin tocar el worker.

    `raw_schema` es la forma que tiene LiveKit de aceptar un esquema tal cual,
    sin derivarlo de la firma de una función Python.
    """
    nombre = spec.get("name")

    # Firma según las docs de LiveKit para tools de esquema crudo:
    # (raw_arguments, context). Respetarla importa: un desajuste no falla al
    # construir la tool sino al INVOCARLA, o sea a mitad de llamada.
    async def _run(raw_arguments: dict, context: RunContext) -> str:
        return await _forward(api, call_state, nombre, raw_arguments or {})

    return function_tool(
        _run,
        raw_schema={
            "name": nombre,
            "description": spec.get("description") or "",
            "parameters": spec.get("parameters")
            or {"type": "object", "properties": {}},
        },
    )


# Las que están escritas a mano más abajo. Se dejan mandar a ellas: son el
# camino probado, y el genérico se reserva para todo lo demás. Si el esquema
# crudo tuviera un problema en alguna versión de livekit-agents, el teléfono
# conserva igual lo esencial —pedido, checkout, crear pedido, WhatsApp— en vez
# de quedarse sin nada.
_A_MANO = {
    "lookup_order",
    "create_checkout",
    "create_order",
    "update_order",
    "send_whatsapp",
}


def build_tools(
    *,
    call_state: CallState,
    api,
    tools_enabled: list[str],
    transfer_number: str | None = None,
    tool_specs: list[dict] | None = None,
) -> list:
    """Construye la lista de tools según lo habilitado + las de control.
    `transfer_number` (opcional): si viene, se agrega `transfer_to_human`."""
    enabled = set(tools_enabled or [])
    tools: list = []

    # Camino nuevo: el backend manda el esquema de cada herramienta y se arman
    # genéricamente. Si algo falla —una versión de livekit-agents sin
    # `raw_schema`, un esquema torcido— se cae a las escritas a mano de abajo,
    # que cubren lo esencial. Nunca se queda sin herramientas por esto.
    hechas: set[str] = set()
    for spec in tool_specs or []:
        nombre = spec.get("name")
        if not nombre or nombre in _A_MANO:
            continue
        try:
            tools.append(_generic_tool(api, call_state, spec))
            hechas.add(nombre)
        except Exception:
            logger.warning("no se pudo armar la tool %s desde el esquema",
                           nombre, exc_info=True)
    if hechas:
        logger.info("tools desde esquema: %s", ", ".join(sorted(hechas)))
    enabled -= hechas

    # --- Tools de negocio (subconjunto) ---

    if "lookup_order" in enabled:
        @function_tool(
            name="lookup_order",
            description=(
                "Busca el estado de un pedido del cliente (envío, pago, entrega). "
                "Usa el número de pedido si el cliente lo menciona."
            ),
        )
        async def lookup_order(
            ctx: RunContext, reason: str, order_number: str | None = None
        ) -> str:
            return await _forward(
                api, call_state, "lookup_order",
                {"reason": reason, "order_number": order_number},
            )

        tools.append(lookup_order)

    if "create_checkout" in enabled:
        @function_tool(
            name="create_checkout",
            description="Genera el link de pago para que el cliente complete su compra.",
        )
        async def create_checkout(
            ctx: RunContext,
            offer: str | None = None,
            quantity: int | None = None,
            payment_hint: str | None = None,
        ) -> str:
            return await _forward(
                api, call_state, "create_checkout",
                {"offer": offer, "quantity": quantity, "payment_hint": payment_hint},
            )

        tools.append(create_checkout)

    if "create_order" in enabled:
        @function_tool(
            name="create_order",
            description=(
                "Crea el pedido real del cliente. Úsalo sólo cuando tengas confirmados "
                "producto, cantidad y datos de entrega."
            ),
        )
        async def create_order(
            ctx: RunContext,
            offer: str | None = None,
            quantity: int | None = None,
            customer_name: str | None = None,
            address: str | None = None,
            payment_hint: str | None = None,
            notes: str | None = None,
        ) -> str:
            return await _forward(
                api, call_state, "create_order",
                {
                    "offer": offer,
                    "quantity": quantity,
                    "customer_name": customer_name,
                    "address": address,
                    "payment_hint": payment_hint,
                    "notes": notes,
                },
            )

        tools.append(create_order)

    if "update_order" in enabled:
        @function_tool(
            name="update_order",
            description=(
                "Agrega unidades al pedido que la clienta ya hizo (upsell durante la "
                "llamada de confirmación). Úsalo una sola vez, sólo cuando la clienta "
                "confirmó que quiere las unidades extra. Actualiza el pedido real."
            ),
        )
        async def update_order(ctx: RunContext, add_units: int, reason: str | None = None) -> str:
            return await _forward(
                api, call_state, "update_order",
                {"add_units": add_units, "reason": reason},
            )

        tools.append(update_order)

    # --- Tools de control (siempre presentes) ---

    if "send_whatsapp" in enabled:
        @function_tool(
            name="send_whatsapp",
            description=(
                "Envía un mensaje de WhatsApp al cliente MIENTRAS hablás con él. "
                "Úsalo para mandarle el link de pago, los datos de transferencia, "
                "el seguimiento del envío, la ficha de un producto o el resumen de "
                "lo acordado: por teléfono no se pueden dictar direcciones web. "
                "ESPERÁ el resultado antes de decir que lo mandaste: si devuelve "
                "un error, decíselo y ofrecé otra vía."
            ),
        )
        async def send_whatsapp(
            ctx: RunContext,
            text: str,
            scenario: str = "otro",
        ) -> str:
            """`scenario` elige la plantilla cuando pasaron mas de 24 h desde el
            ultimo mensaje del cliente: fuera de esa ventana Meta sólo acepta
            plantillas aprobadas, y hay una por escenario. Valores:
            link_de_pago, transferencia, resumen_pedido, info_producto,
            seguimiento_envio, otro."""
            return await _forward(
                api, call_state, "send_whatsapp",
                {"text": text, "scenario": scenario},
            )

        tools.append(send_whatsapp)

    @function_tool(
        name="report_outcome",
        description=(
            "Registra el resultado final de la llamada. DEBES llamarla antes de colgar. "
            "outcome debe ser uno de: confirmed | cancelled_by_customer | rescheduled | "
            "recovered | declined | callback_requested | opt_out | no_outcome."
        ),
    )
    async def report_outcome(
        ctx: RunContext, outcome: str, details: str | None = None
    ) -> str:
        # details como TEXTO (no dict): un parámetro tipo objeto genera un JSON
        # schema sin `additionalProperties:false`, que los LLM en modo estricto
        # (Groq/OpenAI) RECHAZAN con 400 → tumbaba TODA la llamada al LLM.
        call_state.outcome = outcome
        call_state.outcome_details = {"note": details} if details else None
        logger.info("outcome=%s details=%s", outcome, details)
        return "ok"

    tools.append(report_outcome)

    @function_tool(
        name="end_call",
        description="Termina la llamada de forma cordial. Llama antes a report_outcome.",
    )
    async def end_call(ctx: RunContext) -> str:
        await _graceful_hangup(ctx)
        return "ok"

    tools.append(end_call)

    @function_tool(
        name="customer_requests_no_more_calls",
        description="El cliente pide no ser contactado de nuevo: marca opt-out y cuelga.",
    )
    async def customer_requests_no_more_calls(ctx: RunContext) -> str:
        call_state.opt_out = True
        call_state.outcome = "opt_out"
        await _graceful_hangup(ctx)
        return "ok"

    tools.append(customer_requests_no_more_calls)

    @function_tool(
        name="detected_answering_machine",
        description=(
            "Llámala SOLO cuando escuches un buzón de voz / contestador automático / IVR "
            "en vez de una persona. Cuelga de inmediato."
        ),
    )
    async def detected_answering_machine(ctx: RunContext) -> str:
        call_state.status = "voicemail"
        logger.info("contestador/buzón detectado; colgando")
        await hangup()
        return "ok"

    tools.append(detected_answering_machine)

    # --- Transferencia a humano (sólo si hay número configurado) ---

    if transfer_number:
        @function_tool(
            name="transfer_to_human",
            description=(
                "Transfiere la llamada a un agente humano. Úsala cuando el cliente lo pida "
                "o cuando no puedas resolver su solicitud. Avisa al cliente antes de transferir."
            ),
        )
        async def transfer_to_human(ctx: RunContext) -> str:
            # Marca el desenlace ANTES de transferir (la llamada sale de nuestras manos).
            call_state.outcome = call_state.outcome or "callback_requested"
            call_state.outcome_details = {
                **(call_state.outcome_details or {}),
                "transferred": True,
                "transfer_to": transfer_number,
            }
            # Aviso hablado al cliente.
            try:
                await ctx.session.generate_reply(
                    instructions="Dile brevemente al cliente que lo vas a transferir con un agente."
                )
            except Exception:
                pass
            # SIP REFER del participante telefónico hacia el número humano.
            # NOTE: firma según el ejemplo oficial outbound-caller-python:
            # transfer_sip_participant(room_name, participant_identity, transfer_to="tel:+E164")
            try:
                jc = get_job_context()
                await jc.api.sip.transfer_sip_participant(
                    lkapi.TransferSIPParticipantRequest(
                        room_name=jc.room.name,
                        participant_identity=call_state.phone_identity,
                        transfer_to=f"tel:{transfer_number}",
                    )
                )
                # No colgamos: la transferencia se lleva la llamada.
                call_state.status = call_state.status or "completed"
                logger.info("llamada transferida a %s", transfer_number)
                return "ok"
            except Exception as e:
                logger.warning("fallo al transferir: %s", e)
                # Revertimos el flag transferido para no reportar algo que no pasó.
                if call_state.outcome_details:
                    call_state.outcome_details["transferred"] = False
                try:
                    await ctx.session.generate_reply(
                        instructions="Discúlpate: no se pudo transferir la llamada en este momento."
                    )
                except Exception:
                    pass
                return json.dumps({"error": f"transfer_failed: {e}"}, ensure_ascii=False)

        tools.append(transfer_to_human)

    return tools
