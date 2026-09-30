/** Only navigation/focus actions; never send, approve money or delete by keyboard. */
export function inboxShortcut(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string; defaultPrevented: boolean }, typing: boolean): 'next' | 'previous' | 'reply' | 'search' | null {
  if (typing || event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  return ({ KeyJ: 'next', KeyK: 'previous', KeyR: 'reply', KeyF: 'search' } as const)[event.code as 'KeyJ' | 'KeyK' | 'KeyR' | 'KeyF'] ?? null
}
