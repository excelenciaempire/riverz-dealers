"""Bounded non-AI inbound recording. Provider operations are injected."""
from __future__ import annotations
import asyncio
import time


def transfer_definitively_rejected(error):
    metadata = getattr(error, "metadata", None)
    if not isinstance(metadata, dict):
        return False
    value = metadata.get("sip_status_code")
    if isinstance(value, bool):
        return False
    try:
        code = int(value)
    except (TypeError, ValueError):
        return False
    # A timeout/transport exception is an uncertain REFER, not permission to
    # record or introduce a second controller while transfer may be running.
    return code in {400, 403, 404, 405, 410, 415, 480, 486, 488, 603}


async def capture_mailbox(*, policy, start_recording, play_notice, connected, hangup, result_ready,
                          now=time.monotonic, sleep=asyncio.sleep):
    if not isinstance(policy, dict) or set(policy) != {"enabled", "maxSeconds", "version"}:
        raise ValueError("invalid_mailbox_policy")
    seconds = policy["maxSeconds"]
    if (policy["enabled"] is not True or type(policy["version"]) is not int or policy["version"] != 1
            or type(seconds) is not int or not 15 <= seconds <= 120):
        raise ValueError("invalid_mailbox_policy")
    result = None
    def finish(value):
        nonlocal result
        result = value
        result_ready(value)
        return value
    try:
        if not connected():
            return finish({"mailbox_capture": "caller_left", "capture_seconds": 0})
        # No promise to record is played unless Egress accepted recording.
        accepted = await asyncio.wait_for(start_recording(), 10)
        if accepted is not True:
            return finish({"mailbox_capture": "recording_unavailable", "capture_seconds": 0})
        if not connected():
            return finish({"mailbox_capture": "caller_left", "capture_seconds": 0})
        await asyncio.wait_for(play_notice(), 15)
        start = now()
        while connected() and now() - start < seconds:
            await sleep(min(1.0, max(0, seconds - (now() - start))))
        duration = max(0, min(seconds, int(now() - start)))
        # Provider acknowledgement is not evidence that the object uploaded,
        # that the caller spoke, or that a callback was requested.
        return finish({"mailbox_capture": "recording_requested", "capture_seconds": duration})
    finally:
        if result is None:
            result_ready({"mailbox_capture": "capture_failed", "capture_seconds": 0})
        await hangup()
