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


def build_tools(*, call_state: CallState, api, tools_enabled: list[str]) -> list:
    """Construye la lista de tools según lo habilitado + las de control."""
    enabled = set(tools_enabled or [])
    tools: list = []

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

    # --- Tools de control (siempre presentes) ---

    @function_tool(
        name="report_outcome",
        description=(
            "Registra el resultado final de la llamada. DEBES llamarla antes de colgar. "
            "outcome debe ser uno de: confirmed | cancelled_by_customer | rescheduled | "
            "recovered | declined | callback_requested | opt_out | no_outcome."
        ),
    )
    async def report_outcome(
        ctx: RunContext, outcome: str, details: dict | None = None
    ) -> str:
        call_state.outcome = outcome
        call_state.outcome_details = details
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

    return tools
