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
 *
 * Entities are decoded once the tags are gone — a decoded `&lt;` can't be
 * taken for a tag — and before the whitespace pass, so `&nbsp;` collapses like
 * any other space.
 */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
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
      .replace(/<[^>]+>/g, ""),
  )
    // Collapse horizontal whitespace but keep newlines intact.
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    // Cap runs of blank lines so signatures/quotes don't add huge gaps.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["iexcl", "¡"],
  ["iquest", "¿"],
  ["laquo", "«"],
  ["raquo", "»"],
  ["ordf", "ª"],
  ["ordm", "º"],
  ["deg", "°"],
  ["middot", "·"],
  ["bull", "•"],
  ["hellip", "…"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["euro", "€"],
]);

/** An accented letter (`&oacute;`, `&Ntilde;`, `&ccedil;`…) is the letter plus
 *  a combining mark, so it's composed instead of listed one by one. */
const COMBINING_MARKS: Record<string, number> = {
  acute: 0x301,
  grave: 0x300,
  circ: 0x302,
  tilde: 0x303,
  uml: 0x308,
  cedil: 0x327,
};

/**
 * Turn HTML character references back into the characters they stand for:
 * numeric ones, accented letters and the punctuation Spanish and Portuguese
 * text uses. Anything else stays as written.
 */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#")) {
      const code = /^#x/i.test(name)
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      // 0 and the UTF-16 surrogate halves are not characters.
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    }
    const accented = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/.exec(name);
    if (accented) {
      const mark = String.fromCharCode(COMBINING_MARKS[accented[2]]);
      return (accented[1] + mark).normalize("NFC");
    }
    return (
      NAMED_ENTITIES.get(name) ?? NAMED_ENTITIES.get(name.toLowerCase()) ?? entity
    );
  });
}
