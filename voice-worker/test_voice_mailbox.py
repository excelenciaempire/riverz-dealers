import asyncio
import unittest
from voice_mailbox import capture_mailbox, transfer_definitively_rejected


class MailboxTests(unittest.IsolatedAsyncioTestCase):
    def test_uncertain_transfer_does_not_start_mailbox(self):
        for code in [408,487,500,503,504,None,True,"unknown"]:
            error=RuntimeError("synthetic"); error.metadata={"sip_status_code":code}
            self.assertFalse(transfer_definitively_rejected(error))
        self.assertFalse(transfer_definitively_rejected(TimeoutError("synthetic")))

    def test_explicit_sip_refusal_can_use_mailbox(self):
        error=RuntimeError("synthetic"); error.metadata={"sip_status_code":"486"}
        self.assertTrue(transfer_definitively_rejected(error))

    async def run_capture(self, *, policy=None, available=True, leave_at=None, notice_failure=False):
        clock = [0.0]
        actions = []
        async def record():
            actions.append("record")
            return available
        async def notice():
            actions.append("notice")
            if notice_failure:
                raise RuntimeError("synthetic_notice_failure")
        async def sleep(seconds):
            clock[0] += seconds
        async def hangup():
            actions.append("hangup")
        value=await capture_mailbox(policy=policy or {"enabled": True,"version":1,"maxSeconds":15},
            start_recording=record,play_notice=notice,connected=lambda:leave_at is None or clock[0]<leave_at,
            hangup=hangup,result_ready=lambda value:actions.append("result"),now=lambda:clock[0],sleep=sleep)
        return value, actions, clock[0]

    async def test_bounded_recording_without_ia(self):
        value, actions, duration=await self.run_capture()
        self.assertEqual(value,{"mailbox_capture":"recording_requested","capture_seconds":15})
        self.assertEqual(actions,["record","notice","result","hangup"])
        self.assertEqual(duration,15)

    async def test_caller_hangup_stops_early(self):
        value,actions,duration=await self.run_capture(leave_at=3)
        self.assertEqual(value["capture_seconds"],3)
        self.assertEqual(duration,3)
        self.assertEqual(actions[-1],"hangup")

    async def test_no_recording_no_notice_or_success(self):
        value,actions,_=await self.run_capture(available=False)
        self.assertEqual(value["mailbox_capture"],"recording_unavailable")
        self.assertEqual(actions,["record","result","hangup"])

    async def test_departed_caller_has_no_provider_recording(self):
        value,actions,_=await self.run_capture(leave_at=0)
        self.assertEqual(value["mailbox_capture"],"caller_left")
        self.assertEqual(actions,["result","hangup"])

    async def test_invalid_policy_never_calls_provider(self):
        for policy in [{"enabled":True,"version":1,"maxSeconds":x} for x in [14,121,True,"60",60.5]] + [{"enabled":True,"version":True,"maxSeconds":60},{"enabled":False,"version":1,"maxSeconds":60}]:
            with self.assertRaises(ValueError):
                await self.run_capture(policy=policy)

    async def test_notice_failure_still_hangs_up(self):
        with self.assertRaisesRegex(RuntimeError,"synthetic_notice_failure"):
            await self.run_capture(notice_failure=True)


if __name__=="__main__":
    unittest.main()
