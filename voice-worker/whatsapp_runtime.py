"""Provider-free validation of one dispatched WhatsApp connector customer."""
from __future__ import annotations

import asyncio
from contextvars import ContextVar
from uuid import UUID

_disconnect = ContextVar("riverz_whatsapp_disconnect", default=None)


def set_whatsapp_disconnect(callback):
    return _disconnect.set(callback)


async def disconnect_whatsapp_before_room_close():
    callback = _disconnect.get()
    if callback is not None:
        await asyncio.wait_for(callback(), timeout=10)


def validate_whatsapp_transport(context, meta, room_name):
    transport = context.get("transport")
    call_id = str(UUID(meta.get("call_id", "")))
    workspace_id = str(UUID(meta.get("workspace_id", "")))
    if not isinstance(transport, dict) or meta.get("transport") != "whatsapp":
        raise ValueError("invalid_whatsapp_transport")
    if (context.get("call_id") != call_id or transport.get("transport") != "whatsapp"
            or transport.get("workspace_id") != workspace_id
            or transport.get("room_name") != room_name
            or room_name != f"voice_{call_id}"
            or transport.get("customer_identity") != f"whatsapp-{call_id}"
            or transport.get("direction") not in ("inbound", "outbound")):
        raise ValueError("invalid_whatsapp_transport")
    return transport


async def wait_for_whatsapp_customer(*, wait_participant, observe, context, meta,
                                     room_name, timeout=35):
    transport = validate_whatsapp_transport(context, meta, room_name)
    identity = transport["customer_identity"]
    # Select only the bound connector, independently of SDK default kinds,
    # so a browser/agent/SIP participant can never win this wait.
    participant = await asyncio.wait_for(
        wait_participant(identity=identity, kind=7), timeout=timeout,
    )
    attrs = getattr(participant, "attributes", {}) or {}
    if (getattr(participant, "identity", None) != identity
            or getattr(participant, "kind", None) != 7
            or attrs.get("riverz.call") != context["call_id"]
            or attrs.get("riverz.workspace") != transport["workspace_id"]
            or attrs.get("riverz.transport") != "whatsapp"):
        raise ValueError("whatsapp_customer_not_observed")
    result = await observe(context["call_id"], room_name, identity)
    if result.get("observed") is not True:
        raise ValueError("whatsapp_customer_not_observed")
    return transport, participant
