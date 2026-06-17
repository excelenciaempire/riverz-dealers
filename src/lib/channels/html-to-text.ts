/**
 * Convert an email's HTML body into readable plain text WITHOUT flattening
 * its structure. The old strip collapsed every run of whitespace — newlines
 * included — into single spaces, so a multi-paragraph email plus its quoted
 * reply chain landed in `content_text` as one unreadable line. That broke the
 * inbox's quote-fold (it looks for "El … escribió:" / "On … wrote:" at the
 * start of a line) and dumped the whole technical reply history inline.
 *
 * Here we turn block boundaries (<br>, </p>, </div>, list/table rows, …) into
 * newlines first, drop the remaining tags, then collapse only spaces/tabs —
 * never newlines. The result reads like the message does in a real mail client
 * and gives the quote-fold the line breaks it needs.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    // Explicit line breaks.
    .replace(/<br\s*\/?>/gi, "\n")
    // Block-level boundaries → newline so paragraphs and the quoted reply
    // chain survive the strip.
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|table|ul|ol)>/gi, "\n")
    .replace(/<(?:p|div|blockquote|tr|li)\b[^>]*>/gi, "\n")
    // Everything else: drop the tag.
    .replace(/<[^>]+>/g, "")
    // Collapse horizontal whitespace but keep newlines intact.
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    // Cap runs of blank lines so signatures/quotes don't add huge gaps.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
