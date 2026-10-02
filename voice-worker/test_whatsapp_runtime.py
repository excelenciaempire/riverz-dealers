import asyncio
import unittest
from types import SimpleNamespace
from whatsapp_runtime import (validate_whatsapp_transport, wait_for_whatsapp_customer,
                              set_whatsapp_disconnect, disconnect_whatsapp_before_room_close, _disconnect)

CALL = '11111111-1111-4111-8111-111111111111'
WS = '22222222-2222-4222-8222-222222222222'
ROOM = f'voice_{CALL}'
IDENTITY = f'whatsapp-{CALL}'


def context():
    return {'call_id': CALL, 'transport': {'transport': 'whatsapp', 'workspace_id': WS,
            'room_name': ROOM, 'customer_identity': IDENTITY, 'direction': 'inbound'}}


META = {'transport': 'whatsapp', 'call_id': CALL, 'workspace_id': WS}


class WhatsAppRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def test_exact_dispatch_binding(self):
        self.assertEqual(validate_whatsapp_transport(context(), META, ROOM)['direction'], 'inbound')
        for change in [{'workspace_id': CALL}, {'room_name': 'wrong'},
                       {'customer_identity': 'sip-customer'}, {'direction': 'unknown'}]:
            value = context(); value['transport'].update(change)
            with self.assertRaises(ValueError):
                validate_whatsapp_transport(value, META, ROOM)

    async def run_wait(self, *, kind=7, identity=IDENTITY, attrs=None, observed=True):
        calls = []
        async def wait_participant(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(identity=identity, kind=kind, attributes=attrs if attrs is not None else
                {'riverz.call': CALL, 'riverz.workspace': WS, 'riverz.transport': 'whatsapp'})
        async def observe(*args):
            calls.append(args); return {'observed': observed}
        value = await wait_for_whatsapp_customer(wait_participant=wait_participant, observe=observe,
                    context=context(), meta=META, room_name=ROOM)
        return value, calls

    async def test_waits_for_connector_explicitly_before_backend_observation(self):
        (_, participant), calls = await self.run_wait()
        self.assertEqual(calls, [{'identity': IDENTITY, 'kind': 7}, (CALL, ROOM, IDENTITY)])
        self.assertEqual(participant.identity, IDENTITY)

    async def test_other_participant_kinds_cannot_start_ai(self):
        for kind in [0, 3, 5]:
            with self.assertRaises(ValueError):
                await self.run_wait(kind=kind)

    async def test_rejects_wrong_customer_and_workspace(self):
        with self.assertRaises(ValueError):
            await self.run_wait(identity='another-customer')
        with self.assertRaises(ValueError):
            await self.run_wait(attrs={'riverz.call': CALL, 'riverz.workspace': CALL, 'riverz.transport': 'whatsapp'})

    async def test_backend_must_confirm_media_not_sdk_acceptance(self):
        with self.assertRaises(ValueError):
            await self.run_wait(observed=False)

    async def test_no_answer_is_bounded(self):
        async def wait_participant(**_):
            await asyncio.Event().wait()
        async def observe(*_):
            self.fail('unobserved participant must not be accepted')
        with self.assertRaises(asyncio.TimeoutError):
            await wait_for_whatsapp_customer(wait_participant=wait_participant, observe=observe,
                      context=context(), meta=META, room_name=ROOM, timeout=0.01)

    async def test_disconnect_is_task_local_and_pstn_has_no_connector(self):
        effects = []
        async def close():
            effects.append('whatsapp-end')
        await disconnect_whatsapp_before_room_close()
        async def whatsapp_task():
            token = set_whatsapp_disconnect(close)
            try:
                await disconnect_whatsapp_before_room_close()
            finally:
                _disconnect.reset(token)
        await asyncio.create_task(whatsapp_task())
        await disconnect_whatsapp_before_room_close()
        self.assertEqual(effects, ['whatsapp-end'])

    async def test_disconnect_error_does_not_get_retried(self):
        calls = []
        async def close():
            calls.append('end'); raise TimeoutError('synthetic')
        token = set_whatsapp_disconnect(close)
        try:
            with self.assertRaises(TimeoutError):
                await disconnect_whatsapp_before_room_close()
        finally:
            _disconnect.reset(token)
        self.assertEqual(calls, ['end'])


if __name__ == '__main__':
    unittest.main()
