import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveWorkspaceKey } from '@/lib/integrations/workspace-key';
import {
  completeText,
  describeImage,
  toImageMediaType,
  hasLlm,
} from '@/lib/ai/llm-client';

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

const APIFY_ACTOR = process.env.APIFY_IG_ACTOR ?? 'apify~instagram-profile-scraper';

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

/** Run the third-party scraper for one public username. Null on any failure. */
async function scrapeProfile(
  username: string,
  token: string,
): Promise<ApifyProfile | null> {
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], resultsLimit: 6 }),
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (!res.ok) return null;
    const items = (await res.json()) as ApifyProfile[];
    return Array.isArray(items) && items.length ? items[0] : null;
  } catch {
    return null;
  }
}

/** Derive a non-sensitive interest persona from bio + captions + one photo. */
async function analyze(p: ApifyProfile): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY ?? null;
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
          base64: buf.toString('base64'),
          mediaType: toImageMediaType(r.headers.get('content-type')),
          system: EXTERNAL_SYSTEM,
          user: `Contexto de texto del perfil:\n${textContext || '(sin texto)'}\n\nDa la pista de interés combinando texto + foto.`,
          maxTokens: 60,
          anthropicKey: key,
        });
        return clean(out);
      }
    }
    // Text-only fallback (works through any provider).
    if (textContext) {
      const out = await completeText({
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
async function findOpener(p: ApifyProfile): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY ?? null;
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
  },
): Promise<void> {
  await db.from('contact_ig_profile').upsert(
    {
      contact_id: contactId,
      ...fields,
      external_enriched_at: new Date().toISOString(),
    },
    { onConflict: 'contact_id' },
  );
}

export type ExternalEnrichResult = 'enriched' | 'private' | 'skipped' | 'failed';

/**
 * Enrich one contact from their PUBLIC Instagram profile. Idempotent + marks
 * the attempt (even on failure/private) so the cron doesn't re-hammer the same
 * username. Service-role client.
 */
export async function enrichExternalProfile(
  db: SupabaseClient,
  opts: { contactId: string; username: string; workspaceId?: string | null },
): Promise<ExternalEnrichResult> {
  try {
    const uname = opts.username.replace(/^@/, '').trim();
    if (!uname) return 'skipped';
    // El token que el comercio conectó en Integraciones; la variable de entorno
    // queda solo como respaldo para despliegues de un solo negocio.
    const token = await resolveWorkspaceKey(
      db,
      opts.workspaceId ?? null,
      'apify',
      process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN ?? null,
    );
    if (!token) return 'skipped';
    const p = await scrapeProfile(uname, token);
    if (!p) {
      await mark(db, opts.contactId, { external_hint: null, is_public: null });
      return 'failed';
    }
    if (isPrivate(p)) {
      await mark(db, opts.contactId, { external_hint: null, is_public: false });
      return 'private';
    }
    const [hint, opener] = await Promise.all([analyze(p), findOpener(p)]);
    await mark(db, opts.contactId, {
      external_hint: hint,
      opener_hint: opener,
      is_public: true,
    });
    return 'enriched';
  } catch {
    return 'failed';
  }
}
