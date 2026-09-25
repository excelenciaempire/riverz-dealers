import {
  completeText,
  describeImage,
  hasLlm,
  toImageMediaType,
} from '@/lib/ai/llm-client';
import { resolveAnthropicKey, type ResolvedKey } from '@/lib/ai/platform-key';
import { resolveWorkspaceKeyConOrigen } from '@/lib/integrations/workspace-key';
import type { BillingContext } from '@/lib/wallet/operacion';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProfileBilled } from './apify-billing';
import { getProviderCooldown, setProviderCooldown } from './provider-cooldown';

/**
 * External Instagram enrichment — the "see their public profile/gallery" step
 * that the Meta Graph API cannot provide.
 *
 * WHY EXTERNAL: there is no sanctioned API to read a random user's feed. This
 * uses a third-party scraper (Apify) that reads a PUBLIC account's bio + public
 * post captions + public photos, so we can derive a rich interest persona for
 * genuinely personal DMs.
 *
 * RISK ISOLATION (critical): the scrape runs on the third-party's
 * infrastructure with OUR OWN scraper token — it never touches the brand's Meta
 * token or app. The brand's connected Instagram account is not the one doing the
 * scraping, so its standing with Meta is not what's on the line.
 *
 * GUARDRAILS: PUBLIC accounts only (private → nothing). Opt-out is honored by
 * the caller (the cron filters opted_out). The derived hint is NON-SENSITIVE
 * interest cues only — never age/gender/ethnicity/etc. Fail-soft everywhere;
 * TTL-cached. Requires APIFY_TOKEN (scrape) + an LLM key (analysis) — absent
 * either, it degrades to no external hint.
 */

/**
 * Lo que sale consultar UN perfil público, en USD.
 *
 * El actor de Apify cobra ~2,30 USD cada mil perfiles. Es un proveedor
 * conectado más: el costo se le pasa al comercio.
 */
export const USD_POR_PERFIL = 2.3 / 1000;

const APIFY_ACTOR =
  process.env.APIFY_IG_ACTOR ?? 'apify~instagram-profile-scraper';

interface ApifyPost {
  caption?: string;
  hashtags?: string[];
  displayUrl?: string;
  type?: string;
}
interface ApifyProfile {
  username?: string;
  biography?: string;
  private?: boolean;
  isPrivate?: boolean;
  verified?: boolean;
  followersCount?: number;
  latestPosts?: ApifyPost[];
  posts?: ApifyPost[];
}

const EXTERNAL_SYSTEM = `Analizas el perfil PÚBLICO de Instagram de una persona (bio, temas de sus posts y una foto) para ayudar a una marca a personalizar un DM.
Devuelve SOLO señales de interés útiles y NO sensibles: aficiones, temas que le gustan, estilo de vida visible (viajes, gym, cocina, mascotas, moda, arte…), estética.
NUNCA menciones ni supongas edad, género, etnia, raza, religión, salud, cuerpo, atractivo, orientación ni nacionalidad.
Si no hay señal útil, responde exactamente: null
Máximo 22 palabras, en español, sin comillas.`;

/**
 * El gancho para ABRIR: no una categoría de interés, sino UNA cosa concreta y
 * reciente que la persona publicó y sobre la que cualquiera comentaría de forma
 * natural. Es lo que convierte un DM de venta en una conversación.
 */
const OPENER_SYSTEM = `De los posts PÚBLICOS recientes de una persona en Instagram, eliges UNA sola cosa concreta con la que un humano abriría una conversación natural.

Reglas:
- Que sea algo que ELLA publicó y quiso mostrar: un viaje, una mascota, una receta, una carrera, un logro, una mudanza, un concierto.
- Concreto y reciente, no una categoría. Bien: "acaba de volver de un viaje a la playa". Mal: "le gustan los viajes".
- NADA sensible ni deducido: nunca edad, género, etnia, religión, salud, cuerpo, orientación, política, dinero, ni hijos.
- Nada incómodo de que te lo mencione un desconocido: si dudas, responde null.
- Nada de rupturas, duelos, enfermedades, problemas ni quejas.
- Si no hay nada claro, reciente y agradable, responde exactamente: null
Máximo 14 palabras, en español, en tercera persona, sin comillas.`;

function isPrivate(p: ApifyProfile): boolean {
  return p.private === true || p.isPrivate === true;
}
function postsOf(p: ApifyProfile): ApifyPost[] {
  return (p.latestPosts ?? p.posts ?? []).filter(Boolean);
}
function clean(out: string): string | null {
  const t = out.replace(/^["'“”]|["'“”]$/g, '').trim();
  return !t || t.toLowerCase() === 'null' ? null : t.slice(0, 200);
}

/**
 * Run the third-party scraper for one public username.
 *
 * Distingue DOS fracasos que antes se confundían, y la diferencia importa
 * porque marcar el intento quema 60 días de TTL para esa persona:
 *
 *   'empty' — el scraper respondió bien y ese perfil no existe. Es una
 *             respuesta: se marca y no se reintenta en dos meses.
 *   'error' — el token no vale, no hay crédito, o se cayó la red. No sabemos
 *             nada de la persona; marcar sería mentir. No se toca la fila, así
 *             que el siguiente intento la vuelve a coger.
 *
 * Con un token inválido, la versión anterior recorría la base entera marcando
 * a todo el mundo como "ya investigado" sin haber investigado a nadie.
 */
type ScrapeOutcome =
  | { ok: true; profile: ApifyProfile }
  | { ok: false; kind: 'empty' }
  | {
      ok: false;
      kind: 'error';
      reason: ExternalEnrichFailureReason;
      status?: number;
    };

export type ExternalEnrichFailureReason =
  | 'missing_key'
  | 'authentication'
  | 'billing'
  | 'rate_limit'
  | 'provider'
  | 'request'
  | 'network'
  | 'database'
  | 'unknown';

/** Convierte la respuesta externa en una causa estable y accionable. */
export function classifyApifyFailure(
  status: number,
  body = ''
): ExternalEnrichFailureReason {
  const normalized = body.toLowerCase();
  if (status === 401 || status === 403) return 'authentication';
  if (
    status === 402 ||
    /not-enough-usage|usage-limit|payment|billing|credit|plan-required/.test(
      normalized
    )
  ) {
    return 'billing';
  }
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'request';
}

async function scrapeProfile(
  username: string,
  token: string,
  billing?: BillingContext
): Promise<ScrapeOutcome> {
  const cooling = getProviderCooldown(token);
  if (cooling)
    return {
      ok: false,
      kind: 'error',
      reason: cooling.reason as ExternalEnrichFailureReason,
      status: cooling.status,
    };
  try {
    const res = billing
      ? await runProfileBilled(billing, token, APIFY_ACTOR, username)
      : await fetch(
          `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], resultsLimit: 6 }),
            signal: AbortSignal.timeout(90_000),
          }
        );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const reason = classifyApifyFailure(res.status, body);
      setProviderCooldown(token, reason, res.status);
      console.error(
        `[ig-external-enrich] Apify respondió ${res.status} — no se marca el intento`
      );
      return {
        ok: false,
        kind: 'error',
        reason,
        status: res.status,
      };
    }
    const items = (await res.json()) as ApifyProfile[];
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, kind: 'empty' };
    }
    return { ok: true, profile: items[0] };
  } catch (error) {
    const billingError =
      error instanceof Error && /wallet_|sin_saldo/.test(error.message);
    return {
      ok: false,
      kind: 'error',
      reason: billingError ? 'billing' : 'network',
    };
  }
}

/**
 * La misma clave que el resto de la IA: una cuenta BYOK paga con la suya, y el
 * cobro sabe de quién fue para no descontarle al comercio lo que ya le cobra
 * Anthropic.
 */
async function claveDeLaCuenta(
  billing: BillingContext
): Promise<{ key: string | null; cobro: BillingContext }> {
  const clave: ResolvedKey | null = await resolveAnthropicKey(billing.db, {
    workspaceId: billing.workspaceId,
  });
  return {
    key: clave?.key ?? null,
    cobro: { ...billing, origenDeLaClave: clave?.source },
  };
}

/** Derive a non-sensitive interest persona from bio + captions + one photo. */
async function analyze(
  p: ApifyProfile,
  billing: BillingContext
): Promise<string | null> {
  const { key, cobro } = await claveDeLaCuenta(billing);
  if (!hasLlm(key)) return null;
  const ps = postsOf(p);
  const captions = ps
    .map((x) => x.caption)
    .filter(Boolean)
    .slice(0, 6)
    .join(' | ')
    .slice(0, 1200);
  const hashtags = Array.from(new Set(ps.flatMap((x) => x.hashtags ?? [])))
    .slice(0, 20)
    .join(' ');
  const textContext = [
    p.biography ? `Bio: ${p.biography.slice(0, 300)}` : '',
    captions ? `Publica sobre: ${captions}` : '',
    hashtags ? `Hashtags: ${hashtags}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const imgUrl = ps.find((x) => x.displayUrl)?.displayUrl ?? null;

  try {
    // Feed photo + text context → the richest signal (needs an Anthropic key).
    if (imgUrl && key) {
      const r = await fetch(imgUrl, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const out = await describeImage({
          billing: cobro,
          base64: buf.toString('base64'),
          mediaType: toImageMediaType(r.headers.get('content-type')),
          system: EXTERNAL_SYSTEM,
          user: `Contexto de texto del perfil:\n${textContext || '(sin texto)'}\n\nDa la pista de interés combinando texto + foto.`,
          maxTokens: 60,
          anthropicKey: key,
        });
        return clean(out.text);
      }
    }
    // Text-only fallback (works through any provider).
    if (textContext) {
      const out = await completeText({
        billing: cobro,
        tier: 'triage',
        system: EXTERNAL_SYSTEM,
        user: `Perfil:\n${textContext}\n\nDa la pista de interés.`,
        maxTokens: 60,
        anthropicKey: key,
      });
      return clean(out);
    }
    return null;
  } catch {
    return null;
  }
}

/** El gancho concreto para abrir (solo texto: nace de lo que ella publicó). */
async function findOpener(
  p: ApifyProfile,
  billing: BillingContext
): Promise<string | null> {
  const { key, cobro } = await claveDeLaCuenta(billing);
  if (!hasLlm(key)) return null;
  const captions = postsOf(p)
    .map((x) => x.caption)
    .filter(Boolean)
    .slice(0, 4)
    .join('\n---\n')
    .slice(0, 1200);
  if (!captions.trim()) return null;
  try {
    const out = await completeText({
      billing: cobro,
      // Este texto se le dice a la persona en la primera línea: si el modelo se
      // equivoca de tono, quedamos como intrusos. Vale el modelo bueno.
      tier: 'premium',
      system: OPENER_SYSTEM,
      user: `Posts recientes:\n${captions}\n\nDa el gancho, o null.`,
      maxTokens: 60,
      anthropicKey: key,
      effort: 'low',
    });
    return clean(out);
  } catch {
    return null;
  }
}

async function mark(
  db: SupabaseClient,
  contactId: string,
  fields: {
    external_hint: string | null;
    is_public: boolean | null;
    opener_hint?: string | null;
  }
): Promise<void> {
  const { error } = await db.from('contact_ig_profile').upsert(
    {
      contact_id: contactId,
      ...fields,
      external_enriched_at: new Date().toISOString(),
    },
    { onConflict: 'contact_id' }
  );
  if (error) throw new Error(error.message);
}

export type ExternalEnrichResult =
  | 'enriched'
  | 'private'
  | 'skipped'
  | `failed:${ExternalEnrichFailureReason}`
  | `failed:${ExternalEnrichFailureReason}:http_${number}`;

export function externalEnrichFailureReason(
  result: ExternalEnrichResult
): ExternalEnrichFailureReason | null {
  if (!result.startsWith('failed:')) return null;
  return result.split(':')[1] as ExternalEnrichFailureReason;
}

/**
 * Enrich one contact from their PUBLIC Instagram profile. Idempotent + marks
 * the attempt (even on failure/private) so the cron doesn't re-hammer the same
 * username. Service-role client.
 */
export async function enrichExternalProfile(
  db: SupabaseClient,
  opts: { contactId: string; username: string; workspaceId?: string | null }
): Promise<ExternalEnrichResult> {
  try {
    const uname = opts.username.replace(/^@/, '').trim();
    if (!uname) return 'skipped';
    // El token que el comercio conectó en Integraciones; la variable de entorno
    // queda solo como respaldo para despliegues de un solo negocio.
    const llave = await resolveWorkspaceKeyConOrigen(
      db,
      opts.workspaceId ?? null,
      'apify',
      process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN ?? null
    );
    if (!llave) return 'skipped';
    const scraped = await scrapeProfile(
      uname,
      llave.key,
      llave.propia
        ? undefined
        : {
            db,
            workspaceId: opts.workspaceId ?? '',
            concepto: 'perfil_externo',
            detalle: { referenciaId: opts.contactId },
          }
    );
    if (!scraped.ok) {
      // Solo un "no existe" cuenta como investigado. Un fallo de transporte se
      // deja sin marcar para que el siguiente pase lo reintente.
      if (scraped.kind === 'empty') {
        await mark(db, opts.contactId, {
          external_hint: null,
          is_public: null,
        });
        return 'skipped';
      }
      return scraped.status
        ? `failed:${scraped.reason}:http_${scraped.status}`
        : `failed:${scraped.reason}`;
    }
    const p = scraped.profile;
    if (isPrivate(p)) {
      await mark(db, opts.contactId, { external_hint: null, is_public: false });
      return 'private';
    }
    const [hint, opener] = await Promise.all([
      analyze(p, {
        db,
        workspaceId: opts.workspaceId ?? '',
        concepto: 'ia_clasificacion',
      }),
      findOpener(p, {
        db,
        workspaceId: opts.workspaceId ?? '',
        concepto: 'ia_asistencia',
      }),
    ]);
    await mark(db, opts.contactId, {
      external_hint: hint,
      opener_hint: opener,
      is_public: true,
    });
    return 'enriched';
  } catch (error) {
    const reason: ExternalEnrichFailureReason =
      error instanceof Error &&
      /database|relation|column|row|upsert/i.test(error.message)
        ? 'database'
        : 'unknown';
    return `failed:${reason}`;
  }
}
