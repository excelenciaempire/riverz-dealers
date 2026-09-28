export const SONNET_VIGENTE = 'claude-sonnet-5-5'

/** Riverz no conserva variantes Sonnet antiguas en ejecución. */
export function modeloAnthropicVigente(model: string): string {
  const id = model.trim()
  return id.startsWith('claude-') && id.includes('sonnet')
    ? SONNET_VIGENTE
    : id
}
