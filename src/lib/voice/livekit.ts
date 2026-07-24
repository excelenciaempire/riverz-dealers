/**
 * Voice AI — LiveKit server-side helpers (dispatch only).
 *
 * Next.js only *dispatches* the agent to a fresh room with the call id in
 * the metadata; the Python worker (agent_name "riverz-voice") receives the
 * job, pulls the call context over HTTP and does the actual SIP dialing
 * (CreateSIPParticipant) against the Telnyx trunk. This keeps all telephony
 * and media in the worker, and the web app free of a persistent connection.
 */
import { AgentDispatchClient } from 'livekit-server-sdk';

export const VOICE_AGENT_NAME = 'riverz-voice';

/** Deterministic room name for a call — also used to reconcile stuck calls. */
export function roomNameForCall(callId: string): string {
  return `voice_${callId}`;
}

function client(): AgentDispatchClient {
  const host = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!host || !apiKey || !apiSecret) {
    throw new Error('Missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  }
  // AgentDispatchClient wants an https/wss host with protocol. The worker
  // and browser use wss://; the server SDK's Twirp calls use https://.
  const httpHost = host.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  return new AgentDispatchClient(httpHost, apiKey, apiSecret);
}

export function isLiveKitConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET,
  );
}

/**
 * Dispatch the voice agent to a new room for this call. Returns the room
 * name so the caller can persist it (used to detect/kill stuck calls).
 * The worker reads `{ call_id, workspace_id }` from the dispatch metadata.
 */
export async function dispatchVoiceCall(input: {
  callId: string;
  workspaceId: string;
}): Promise<{ roomName: string }> {
  const roomName = roomNameForCall(input.callId);
  const metadata = JSON.stringify({
    call_id: input.callId,
    workspace_id: input.workspaceId,
  });
  await client().createDispatch(roomName, VOICE_AGENT_NAME, { metadata });
  return { roomName };
}
