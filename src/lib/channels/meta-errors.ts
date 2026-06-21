import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/translate";

/**
 * Translate a Meta Graph API send failure into a clear, actionable message
 * for the agent (in the merchant's UI locale) — instead of dumping the raw
 * JSON error into a toast. Used by the Instagram + Messenger + comment
 * adapters. Pass the request locale (via getLocale()) so the toast follows
 * the language selected in settings; defaults to es when unknown.
 *
 * Background: the most common send failures on Meta DM channels are NOT
 * code bugs, they're platform-policy / access-level limits. The two we
 * see in practice:
 *
 *  - code 200 / subcode 2534048 (Instagram) — the app lacks ADVANCED
 *    ACCESS to instagram_manage_messages, so it can only DM people who
 *    hold a role in the Meta app (admin/dev/tester). Fixed only by
 *    passing Meta App Review, never by retrying.
 *
 *  - code 10 / subcode 2018278 (Messenger) and IG equivalents — the send
 *    is OUTSIDE the 24-hour messaging window. Meta forbids free-form
 *    (`messaging_type: RESPONSE`) messages more than 24h after the
 *    customer's last message. Needs an approved message tag (e.g.
 *    HUMAN_AGENT, which itself requires the human_agent permission) or
 *    the customer to message first.
 *
 * `permanent` marks failures where retrying the same send is pointless
 * (so callers can skip retry/backoff and not waste quota).
 */

export type MetaSendErrorCategory =
  | "advanced_access" // app lacks Advanced Access — needs Meta App Review
  | "permission" // a required permission isn't granted/approved — needs App Review
  | "outside_window" // 24h messaging window elapsed
  | "token" // access token expired/revoked
  | "rate_limit" // throttled — transient
  | "recipient" // recipient not reachable / unknown id
  | "unknown";

export interface MetaErrorShape {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

export interface DescribedMetaError {
  category: MetaSendErrorCategory;
  /** Agent-facing message in the request locale — safe to show in a toast / campaign log. */
  userMessage: string;
  /** True when retrying the identical send can't succeed. */
  permanent: boolean;
}

/** Parse a Meta error response body. Returns null if it wasn't JSON. */
export function parseMetaError(bodyText: string): MetaErrorShape | null {
  try {
    return JSON.parse(bodyText) as MetaErrorShape;
  } catch {
    return null;
  }
}

/** Localized channel label woven into the messages ("Instagram", "Messenger", ...). */
function channelLabel(channel: string, locale: Locale): string {
  switch (channel) {
    case "instagram":
      return "Instagram";
    case "messenger":
      return "Messenger";
    case "fb_comment":
      return translate(locale, "errMeta.metaLabelFbComments");
    case "ig_comment":
      return translate(locale, "errMeta.metaLabelIgComments");
    default:
      return "Meta";
  }
}

/**
 * Map a (status, parsed body) pair to a categorized, human-readable error.
 * `channel` only tweaks wording ("Instagram"/"Messenger"); the logic is
 * shared. `locale` controls the language of `userMessage`.
 */
export function describeMetaSendError(
  channel: string,
  status: number,
  parsed: MetaErrorShape | null,
  locale: Locale = DEFAULT_LOCALE,
): DescribedMetaError {
  const err = parsed?.error;
  const code = err?.code;
  const subcode = err?.error_subcode;
  const label = channelLabel(channel, locale);

  // Advanced Access missing — IG instagram_manage_messages / pages_messaging.
  // code 200 generally + subcode 2534048 specifically; also the message
  // text mentions "acceso avanzado" / "advanced access".
  const mentionsAdvanced = /acceso avanzado|advanced access/i.test(
    err?.message ?? "",
  );
  if (subcode === 2534048 || (code === 200 && mentionsAdvanced) || (code === 10 && mentionsAdvanced)) {
    return {
      category: "advanced_access",
      permanent: true,
      userMessage: translate(locale, "errMeta.metaAdvancedAccess", { label }),
    };
  }

  // A required permission isn't available — deprecated or pending App
  // Review (e.g. `pages_read_user_content` / `pages_manage_engagement`
  // when replying to comments). Meta phrases it "The permission(s) X are
  // not available. It could because either they are deprecated or need to
  // be approved by App Review." code 200, no advanced-access subcode.
  if (
    code === 200 &&
    /permission/i.test(err?.message ?? "") &&
    /(app review|not available|deprecated|approved)/i.test(err?.message ?? "")
  ) {
    return {
      category: "permission",
      permanent: true,
      userMessage: translate(locale, "errMeta.metaPermission", { label }),
    };
  }

  // 24-hour messaging window elapsed.
  // Messenger: code 10 / subcode 2018278. IG: code 10 / subcode 2534022.
  if (
    subcode === 2018278 ||
    subcode === 2534022 ||
    (code === 10 && /period|ventana|window|24/i.test(err?.message ?? ""))
  ) {
    return {
      category: "outside_window",
      permanent: true,
      userMessage: translate(locale, "errMeta.metaOutsideWindow", { label }),
    };
  }

  // Token death — surfaced consistently with the connection auto-flip.
  if (
    code === 190 ||
    code === 102 ||
    code === 463 ||
    code === 467 ||
    (status === 401 && err?.type === "OAuthException")
  ) {
    return {
      category: "token",
      permanent: true,
      userMessage: translate(locale, "errMeta.metaToken", { label }),
    };
  }

  // Throttling — transient, worth a retry later.
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return {
      category: "rate_limit",
      permanent: false,
      userMessage: translate(locale, "errMeta.metaRateLimit", { label }),
    };
  }

  // Unknown / unreachable recipient.
  if (code === 100 && (subcode === 2018001 || /recipient|destinatario/i.test(err?.message ?? ""))) {
    return {
      category: "recipient",
      permanent: true,
      userMessage: translate(locale, "errMeta.metaRecipient", { label }),
    };
  }

  // Fallback — keep Meta's own message if we have it, else a generic line.
  const detail = err?.message?.trim();
  return {
    category: "unknown",
    permanent: false,
    userMessage: detail
      ? translate(locale, "errMeta.metaRejectedDetail", { label, detail })
      : translate(locale, "errMeta.metaRejectedGeneric", { label, status }),
  };
}
