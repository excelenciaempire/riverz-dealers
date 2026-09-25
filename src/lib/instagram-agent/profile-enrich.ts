import { describeImage, toImageMediaType } from '@/lib/ai/llm-client';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { decrypt } from '@/lib/channels/encryption';
import { ingestRawMedia } from '@/lib/channels/media-ingest';
import { withAppsecretProof } from '@/lib/channels/meta-graph';
import type { BillingContext } from '@/lib/wallet/operacion';
import type { ChannelConnection } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

/**
 * Per-person Instagram enrichment — the "understand who they are" step behind
 * Blueberry-style 1:1 personalization.
 *
 * ELIGIBILITY (the whole game): Meta's Instagram User Profile API only returns
 * data for people who have MESSAGED the business. A comment-only contact yields
 * nothing here — they must first become a DM sender (the comment→DM opener).
 *
 * COMPLIANCE: we use only the sanctioned profile fields + a vision pass over the
 * person's OWN profile picture (a consented image the API returns). We never
 * touch their feed (no API for it), never scrape, and the vision hint is limited
 * to non-sensitive interest cues (no age/gender/ethnicity/etc.). We store the
 * derived hint, not the short-lived profile_pic URL.
 *
 * Fail-soft everywhere: any error → no enrichment, sending still works from the
 * name + comment text. Service-role client (runs from the ingest path).
 */

const GRAPH = 'https://graph.facebook.com/v22.0';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // re-enrich at most monthly

const VISION_SYSTEM = `Analizas la FOTO DE PERFIL de una persona para ayudar a una marca a escribir un DM cálido.
Devuelve SOLO señales de interés visuales, no sensibles y no identificantes: mascotas, hobbies, entorno (playa, gym, viajes, naturaleza), estética o vibe.
NUNCA menciones ni supongas edad, género, etnia, raza, religión, salud, cuerpo, atractivo ni nacionalidad.
Si la foto es un logo, está en blanco, o es solo un rostro sin contexto, responde exactamente: null
Máximo 12 palabras, en español, sin comillas.`;

interface ProfileResponse {
  name?: string;
  username?: string;
  profile_pic?: string;
  follower_count?: number;
  is_verified_user?: boolean;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
}

async function visionProfilePic(
  billing: BillingContext,
  url: string,
  prevHash: string | null,
  prevHint: string | null
): Promise<{ hint: string | null; hash: string | null }> {
  // La misma clave que el resto de la IA: una cuenta BYOK paga con la suya.
  const clave = await resolveAnthropicKey(billing.db, { workspaceId: billing.workspaceId });
  if (!clave) return { hint: prevHint, hash: prevHash };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { hint: prevHint, hash: prevHash };
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 32);
    // Unchanged pic → keep the cached hint, skip the (paid) vision call.
    if (prevHash && hash === prevHash) return { hint: prevHint, hash };
    const out = await describeImage({
      billing: { ...billing, origenDeLaClave: clave.source },
      base64: buf.toString('base64'),
      mediaType: toImageMediaType(res.headers.get('content-type')),
      system: VISION_SYSTEM,
      user: 'Esta es la foto de perfil de una persona. Da la pista de interés.',
      maxTokens: 40,
      anthropicKey: clave.key,
    });
    const clean = out.text.replace(/^["'“”]|["'“”]$/g, '').trim();
    const hint =
      !clean || clean.toLowerCase() === 'null' ? null : clean.slice(0, 120);
    return { hint, hash };
  } catch {
    return { hint: prevHint, hash: prevHash };
  }
}

/**
 * Persist the IG profile picture to Supabase Storage and return a STABLE
 * public URL. Meta's `profile_pic` is a short-lived signed CDN URL that 404s
 * within hours — storing it raw (as this module used to) left the inbox avatar
 * broken for the whole 30-day re-enrichment TTL. We download the bytes once and
 * re-host them, keyed by contact, so the avatar stays valid. Best-effort:
 * returns null on any failure (the caller then leaves avatar_url untouched).
 */
async function persistAvatarToStorage(
  workspaceId: string,
  contactId: string,
  url: string
): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ingested = await ingestRawMedia({
      buffer: buf,
      mime: res.headers.get('content-type') || 'image/jpeg',
      workspaceId,
      // Pseudo-scope: el path en Storage queda {workspace}/avatars/{contact}.
      conversationId: 'avatars',
      id: contactId,
      hintedKind: 'image',
    });
    return ingested?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Enrich a contact's Instagram profile. Idempotent + TTL-guarded: safe to call
 * fire-and-forget on every inbound message; it no-ops when data is fresh.
 */
export async function enrichContactProfile(
  db: SupabaseClient,
  opts: { contactId: string; igsid: string; connection: ChannelConnection }
): Promise<void> {
  try {
    const { data: existing } = await db
      .from('contact_ig_profile')
      .select('enriched_at, pic_hash, persona_hint')
      .eq('contact_id', opts.contactId)
      .maybeSingle();
    const prev = existing as {
      enriched_at: string | null;
      pic_hash: string | null;
      persona_hint: string | null;
    } | null;
    if (
      prev?.enriched_at &&
      Date.now() - new Date(prev.enriched_at).getTime() < TTL_MS
    ) {
      return; // fresh — nothing to do
    }

    const secrets = (opts.connection.secrets ?? {}) as Record<string, unknown>;
    const enc = String(secrets.access_token ?? '');
    if (!enc) return;
    const token = decrypt(enc);

    const fields =
      'name,username,profile_pic,follower_count,is_verified_user,is_user_follow_business,is_business_follow_user';
    const r = await fetch(
      withAppsecretProof(
        `${GRAPH}/${opts.igsid}?fields=${fields}&access_token=${encodeURIComponent(token)}`,
        token
      ),
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!r.ok) return; // not eligible (comment-only) / token issue → degrade
    const p = (await r.json()) as ProfileResponse;

    let personaHint: string | null = prev?.persona_hint ?? null;
    let picHash: string | null = prev?.pic_hash ?? null;
    if (p.profile_pic) {
      const v = await visionProfilePic(
        {
          db,
          workspaceId: opts.connection.workspace_id,
          concepto: 'ia_clasificacion',
        },
        p.profile_pic,
        prev?.pic_hash ?? null,
        prev?.persona_hint ?? null
      );
      personaHint = v.hint;
      picHash = v.hash;
    }

    await db.from('contact_ig_profile').upsert(
      {
        contact_id: opts.contactId,
        follower_count: p.follower_count ?? null,
        is_verified: p.is_verified_user ?? null,
        follows_business: p.is_user_follow_business ?? null,
        business_follows: p.is_business_follow_user ?? null,
        persona_hint: personaHint,
        pic_hash: picHash,
        enriched_at: new Date().toISOString(),
      },
      { onConflict: 'contact_id' }
    );

    // Re-hospedar la foto en Storage y guardar una URL ESTABLE. Antes se
    // guardaba la profile_pic cruda (URL CDN firmada de vida corta) que daba
    // 404 a las pocas horas y dejaba el avatar roto por todo el TTL de 30 días
    // — contradiciendo el propio contrato de este módulo (ver docstring).
    if (p.profile_pic) {
      const stable = await persistAvatarToStorage(
        opts.connection.workspace_id,
        opts.contactId,
        p.profile_pic
      );
      if (stable) {
        await db
          .from('contacts')
          .update({ avatar_url: stable })
          .eq('id', opts.contactId);
      }
    }
  } catch {
    /* fail-soft: enrichment is best-effort, never blocks messaging */
  }
}

export interface IgProfileEnrichment {
  follower_count: number | null;
  is_verified: boolean | null;
  follows_business: boolean | null;
  persona_hint: string | null;
  /** Gancho concreto y reciente de su perfil público con el que abrir. */
  opener_hint?: string | null;
}

/** Load a contact's Instagram enrichment for segmentation + DM personalization. */
export async function loadIgProfile(
  db: SupabaseClient,
  contactId: string
): Promise<IgProfileEnrichment | null> {
  const { data } = await db
    .from('contact_ig_profile')
    .select(
      'follower_count, is_verified, follows_business, persona_hint, external_hint, opener_hint'
    )
    .eq('contact_id', contactId)
    .maybeSingle();
  if (!data) return null;
  const d = data as IgProfileEnrichment & { external_hint: string | null };
  // Combine the two hint sources: the external (public feed) hint is richer;
  // the profile-pic hint is a fallback. Merge when both exist. The DM writer
  // reads persona_hint, so it uses the best signal with no extra plumbing.
  const persona_hint =
    d.external_hint && d.persona_hint
      ? `${d.external_hint}; ${d.persona_hint}`
      : (d.external_hint ?? d.persona_hint ?? null);
  return {
    follower_count: d.follower_count,
    is_verified: d.is_verified,
    follows_business: d.follows_business,
    persona_hint,
    opener_hint: d.opener_hint ?? null,
  };
}
