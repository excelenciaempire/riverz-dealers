"""Acknowledged human control of one existing room; no AI, dialing or media SDK.

Dependencies are injected so the protocol can be exercised without a customer,
microphone, database, model or telephony provider. The worker remains in the room
after closing AgentSession and preserves the existing call/recording/finalizer.
"""
from __future__ import annotations

import asyncio
import logging
import time
from uuid import UUID, uuid4

logger = logging.getLogger("riverz-voice.human")


async def control_human_handoff(*, api, session, call_state, room, hangup,
                                sleep=asyncio.sleep, interval=2.0) -> None:
    worker_id = str(uuid4())
    call_id = call_state.call_id
    human_id = None
    stopped = False
    registered = False
    activated = False
    last_ack_attempt = 0.0

    def customer_present():
        return call_state.phone_identity in room.remote_participants

    async def stop_ai():
        nonlocal stopped
        call_state.human_handoff_pending = True
        if call_state.voice_transfer_in_flight:
            raise ValueError("sip_transfer_already_in_progress")
        session.input.set_audio_enabled(False)
        session.output.set_audio_enabled(False)
        # aclose interrupts activity, drains tool tasks and closes STT/LLM/TTS.
        # RoomInputOptions.delete_room_on_close=False is REQUIRED for this path.
        await asyncio.wait_for(session.aclose(), timeout=10)
        stopped = True

    async def acknowledge(phase):
        result = await api.voice_handoff("ack", {
            "callId": call_id, "workerId": worker_id,
            "id": human_id, "phase": phase,
        })
        return result.get("acknowledged") is True

    try:
        result = await api.voice_handoff("register", {
            "callId": call_id, "workerId": worker_id,
            "room": room.name, "customerIdentity": call_state.phone_identity,
        })
        if result.get("registered") is not True:
            return  # The unchanged AI call continues; no human grant is possible.
        registered = True
        while customer_present():
            value = await api.voice_handoff("poll", {"callId": call_id, "workerId": worker_id})
            if value.get("call_id") != call_id or value.get("worker_id") != worker_id:
                raise ValueError("voice_control_scope_changed")
            job_id = value.get("id")
            if job_id:
                job_id = str(UUID(job_id))
                if human_id and human_id != job_id:
                    raise ValueError("voice_controller_changed")
                human_id = job_id
                if not activated:
                    activated = True
                    await stop_ai()
            state = value.get("state")
            if human_id and state in ("ended", "failed", "expired"):
                break
            if human_id and state == "requested":
                # The server's durable slots include tools that are still running
                # after the worker's HTTP task was cancelled. Never guess expiry.
                if stopped and value.get("tools_pending") is False:
                    await acknowledge("ready")
            if human_id and state in ("ready", "connected"):
                participant = room.remote_participants.get("human_" + human_id)
                if participant is not None:
                    attrs = participant.attributes
                    if attrs.get("riverz.handoff") != human_id or attrs.get("riverz.actor") != value.get("actor_id"):
                        raise ValueError("voice_human_identity_changed")
                    if state == "ready" and time.monotonic() - last_ack_attempt >= 2:
                        last_ack_attempt = time.monotonic()
                        if await acknowledge("connected"):
                            call_state.human_handoff_connected = True
                            call_state.outcome_details = {
                                **(call_state.outcome_details or {}),
                                "human_handoff_id": human_id,
                                "human_handoff_connected": True,
                            }
                elif state == "connected":
                    # Once connected, absence ends the call. No silent AI resume
                    # and no replacement controller with a fresh room/token.
                    break
            await sleep(interval)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Registration/poll failure before any request leaves the AI call intact.
        # After a request, the call is ended rather than left without control.
        logger.warning("human control unavailable; activated=%s", activated)
    finally:
        if activated:
            call_state.human_handoff_pending = True
            call_state.status = call_state.status or "completed"
            if human_id and registered:
                try:
                    await asyncio.wait_for(acknowledge("ended"), timeout=5)
                    await asyncio.wait_for(api.voice_handoff("release", {
                        "callId": call_id, "workerId": worker_id, "id": human_id,
                    }), timeout=5)
                except Exception:
                    logger.warning("human participant release not confirmed")
            # Separate LiveKit room deletion disconnects customer and human even
            # if the web service is down. The existing shutdown finalizer runs.
            await hangup()
