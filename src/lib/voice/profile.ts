/**
 * Un perfil telefónico dedicado se guarda en ai_agents por compatibilidad con
 * el runtime, pero no es un asistente de chat: sólo ocupa el canal de voz.
 */
export function isDedicatedVoiceProfile(agent: {
  voice_enabled?: boolean;
  scope?: string | null;
  ai_agent_channels?: { channel: string }[] | null;
}): boolean {
  const channels = agent.ai_agent_channels ?? [];
  return (
    agent.voice_enabled === true &&
    agent.scope === 'channels' &&
    channels.length === 1 &&
    channels[0]?.channel === 'voice'
  );
}
