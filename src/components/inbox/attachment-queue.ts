export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

export function selectAttachments(files: File[], accept: string | undefined, remaining: number) {
  const accepted: File[] = [];
  const rejected: Array<{ file: File; reason: 'size' | 'type' | 'count' }> = [];
  for (const file of files) {
    const matches = !accept || accept.split(',').some(rule => {
      rule = rule.trim().toLowerCase();
      if (rule.startsWith('.')) return file.name.toLowerCase().endsWith(rule);
      return rule.endsWith('/*') ? file.type.toLowerCase().startsWith(rule.slice(0, -1)) : file.type.toLowerCase() === rule;
    });
    const reason = file.size > MAX_ATTACHMENT_BYTES ? 'size' : !matches ? 'type' : accepted.length >= remaining ? 'count' : null;
    if (reason) rejected.push({ file, reason }); else accepted.push(file);
  }
  return { accepted, rejected };
}

/** Sequential sends stop at the failed item. Callers only remove successful items. */
export async function sendAttachmentQueue<T>(items: T[], send: (item: T, index: number) => Promise<void>, isCurrent: () => boolean, onSent: (item: T, index: number) => void) {
  for (let i = 0; i < items.length; i++) {
    if (!isCurrent()) return;
    await send(items[i], i);
    onSent(items[i], i);
  }
}
