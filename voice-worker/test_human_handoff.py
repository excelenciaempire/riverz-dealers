"""Pure protocol tests: no LiveKit import, phone, microphone or provider."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

from human_handoff import control_human_handoff

CALL = "11111111-1111-4111-8111-111111111111"
JOB = "22222222-2222-4222-8222-222222222222"
ACTOR = "33333333-3333-4333-8333-333333333333"


class HumanProtocolTests(unittest.IsolatedAsyncioTestCase):
    def fixture(self, states):
        events = []
        state = SimpleNamespace(call_id=CALL, phone_identity="caller-" + CALL,
            human_handoff_pending=False, human_handoff_connected=False,
            voice_transfer_in_flight=False, outcome_details={"existing": True}, status=None)
        room = SimpleNamespace(name="voice_" + CALL,
            remote_participants={state.phone_identity: SimpleNamespace()})
        session = SimpleNamespace(
            input=SimpleNamespace(set_audio_enabled=Mock(side_effect=lambda _: events.append("input-off"))),
            output=SimpleNamespace(set_audio_enabled=Mock(side_effect=lambda _: events.append("output-off"))),
            aclose=AsyncMock(side_effect=lambda: events.append("ai-closed")))
        api = SimpleNamespace()
        queue = iter(states)

        async def request(action, data):
            events.append(action + ":" + str(data.get("phase", "")))
            if action == "register":
                return {"registered": True}
            if action == "ack":
                return {"acknowledged": True}
            if action == "release":
                return {"released": True}
            value = next(queue)
            if isinstance(value, Exception):
                raise value
            if value.get("participant"):
                room.remote_participants["human_" + JOB] = SimpleNamespace(attributes={
                    "riverz.handoff": JOB, "riverz.actor": ACTOR if value.get("participant") == "valid" else "other"})
            if value.get("departed"):
                room.remote_participants.pop("human_" + JOB, None)
            return {"call_id": CALL, "worker_id": data["workerId"],
                "id": JOB, "actor_id": ACTOR, "tools_pending": False, **value}

        api.voice_handoff = AsyncMock(side_effect=request)
        hangup = AsyncMock(side_effect=lambda: events.append("hangup"))
        sleep = AsyncMock()
        return state, room, session, api, hangup, sleep, events

    async def run_fixture(self, fixture):
        state, room, session, api, hangup, sleep, _ = fixture
        await control_human_handoff(api=api, session=session, call_state=state,
            room=room, hangup=hangup, sleep=sleep)

    async def test_closes_ai_then_waits_for_server_tools_then_acknowledges_real_join(self):
        f = self.fixture([{"state": "requested", "tools_pending": True},
            {"state": "requested"}, {"state": "ready", "participant": "valid"},
            {"state": "connected"}, {"state": "ended"}])
        await self.run_fixture(f)
        state, _, session, api, hangup, _, events = f
        self.assertLess(events.index("ai-closed"), events.index("ack:ready"))
        self.assertEqual(events.count("ack:ready"), 1)
        self.assertEqual(events.count("ack:connected"), 1)
        self.assertEqual(session.aclose.await_count, 1)
        self.assertTrue(state.human_handoff_pending)
        self.assertTrue(state.human_handoff_connected)
        self.assertEqual(state.outcome_details, {"existing": True, "human_handoff_id": JOB, "human_handoff_connected": True})
        self.assertEqual(hangup.await_count, 1)
        self.assertLess(events.index("release:"), events.index("hangup"))
        self.assertEqual(len({call.args[1]["workerId"] for call in api.voice_handoff.await_args_list}), 1)

    async def test_registration_failure_preserves_the_original_ai_call(self):
        f = self.fixture([])
        f[3].voice_handoff.side_effect = ConnectionError("offline")
        await self.run_fixture(f)
        self.assertFalse(f[0].human_handoff_pending)
        f[2].aclose.assert_not_awaited()
        f[4].assert_not_awaited()

    async def test_poll_failure_before_a_request_keeps_the_original_call_intact(self):
        f = self.fixture([ConnectionError("offline")])
        await self.run_fixture(f)
        f[2].aclose.assert_not_awaited()
        f[4].assert_not_awaited()

    async def test_poll_failure_after_request_ends_the_call_without_resuming_ai(self):
        f = self.fixture([{"state": "requested"}, ConnectionError("offline")])
        await self.run_fixture(f)
        self.assertTrue(f[0].human_handoff_pending)
        self.assertEqual(f[2].aclose.await_count, 1)
        self.assertEqual(f[4].await_count, 1)

    async def test_drain_failure_never_acknowledges_ready(self):
        f = self.fixture([{"state": "requested"}])
        f[2].aclose.side_effect = RuntimeError("not drained")
        await self.run_fixture(f)
        self.assertNotIn("ack:ready", f[6])
        self.assertEqual(f[4].await_count, 1)

    async def test_foreign_participant_cannot_become_controller(self):
        f = self.fixture([{"state": "ready", "participant": "invalid"}])
        await self.run_fixture(f)
        self.assertFalse(f[0].human_handoff_connected)
        self.assertNotIn("ack:connected", f[6])
        self.assertEqual(f[4].await_count, 1)

    async def test_departed_human_ends_the_call(self):
        f = self.fixture([{"state": "ready", "participant": "valid"}, {"state": "connected", "departed": True}])
        await self.run_fixture(f)
        self.assertEqual(f[4].await_count, 1)
        self.assertEqual(f[2].aclose.await_count, 1)

    async def test_uncertain_sip_transfer_never_overlaps_browser_takeover(self):
        f = self.fixture([{"state": "requested"}])
        f[0].voice_transfer_in_flight = True
        await self.run_fixture(f)
        self.assertNotIn("ack:ready", f[6])
        self.assertEqual(f[4].await_count, 1)

    async def test_uncertain_tools_are_not_cleared_by_a_local_timer(self):
        f = self.fixture([{"state": "requested", "tools_pending": True},
            {"state": "requested", "tools_pending": True}, {"state": "expired"}])
        await self.run_fixture(f)
        self.assertNotIn("ack:ready", f[6])
        self.assertEqual(f[4].await_count, 1)

    def test_room_options_preserve_flag_off_sdk_defaults(self):
        # Evaluate only the SDK configuration helper, without loading models or
        # connecting a worker. The actual pinned 1.6.7 SDK supports this option.
        source = ast.parse(Path(__file__).with_name("agent.py").read_text(encoding="utf-8"))
        function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == "_room_input_options")
        opts = Mock(side_effect=lambda **kwargs: kwargs)
        scope = {"RoomInputOptions": opts, "noise_cancellation": None}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "options", "exec"), scope)
        self.assertEqual(scope["_room_input_options"](), {})
        self.assertEqual(scope["_room_input_options"](True), {"delete_room_on_close": False})


if __name__ == "__main__":
    unittest.main()
