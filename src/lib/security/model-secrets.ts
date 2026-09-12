/** Defense in depth for accidentally embedded credentials in notes/provider
 * errors. Do not remove customer/order identifiers or normal payment links.
 * Explicit patterns only; this cannot recognize every possible secret.
 */
export function redactModelSecrets(text: string): string {
  return text
    .replace(/\b(?:sbp_[a-f0-9]{40}|sk-ant-api03-[A-Za-z0-9_-]{40,}|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:access_token|refresh_token|api_key|api_key_encrypted|client_secret|service_role_key|password)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;}"']+)/gi,
      (_match, prefix: string, value: string) => `${prefix}${value.startsWith('"') ? '"[REDACTED]"' : value.startsWith("'") ? "'[REDACTED]'" : '[REDACTED]'}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g, (token, payload: string) => {
      try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).role === 'service_role' ? '[REDACTED]' : token; }
      catch { return token; }
    });
}

/** Preserve provider signatures, image/document payloads and protocol IDs. */
export function redactModelContent(content: unknown): unknown {
  if (typeof content === 'string') return redactModelSecrets(content);
  if (!Array.isArray(content)) return content;
  return content.map(block => {
    if (block?.type === 'text' && typeof block.text === 'string') return { ...block, text: redactModelSecrets(block.text) };
    if (block?.type === 'tool_result') return { ...block, content: redactModelContent(block.content) };
    return block;
  });
}
