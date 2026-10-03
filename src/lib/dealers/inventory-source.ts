/** Imported listing metadata remains data; only safe public HTTPS links are rendered. */
export function inventorySource(notes: string) {
  const raw = notes.match(/^Source:\s*(\S+)\s*$/m)?.[1];
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const date = notes.match(/^Checked:\s*(\S+)\s*$/m)?.[1];
    return {
      url: url.href,
      checkedAt: date && Number.isFinite(Date.parse(date)) ? date : null,
      isNew: /^Condition:\s*New\s*$/m.test(notes),
    };
  } catch {
    return null;
  }
}
