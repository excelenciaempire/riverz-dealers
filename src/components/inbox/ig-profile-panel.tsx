"use client";

import { useEffect, useState } from "react";
import { UserSearch, BadgeCheck, Users, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";

/**
 * Lo que la IA averiguó de esta persona antes de escribirle.
 *
 * Las dos capas de enriquecimiento (`profile-enrich` con la API de Meta + visión
 * sobre la foto de perfil, y `external-enrich` con el perfil público) llevaban
 * meses escribiendo en `contact_ig_profile` sin que ninguna pantalla lo leyera:
 * el trabajo existía y era invisible, así que nadie podía juzgar si el DM
 * personalizado tenía de dónde agarrarse.
 *
 * Se muestra donde se decide qué escribir —la ficha del contacto en la bandeja—
 * y solo cuando hay algo que decir. Sin datos no renderiza nada: un "sin
 * información" ocupa el mismo espacio y no aporta ninguno.
 */

interface IgProfile {
  follower_count: number | null;
  is_verified: boolean | null;
  follows_business: boolean | null;
  persona_hint: string | null;
  external_hint: string | null;
  opener_hint: string | null;
  is_public: boolean | null;
  external_enriched_at: string | null;
  enriched_at: string | null;
}

export function IgProfilePanel({
  contactId,
  channel,
}: {
  contactId: string;
  channel?: string | null;
}) {
  const t = useT();
  const fmt = useFormat();
  // El resultado se guarda JUNTO al contacto al que pertenece: al saltar de una
  // conversación a otra, el perfil anterior seguía en pantalla hasta que
  // respondía la consulta nueva — leías los intereses de otra persona.
  const [loaded, setLoaded] = useState<{
    contactId: string;
    profile: IgProfile | null;
  } | null>(null);
  const isIg = channel === "instagram" || channel === "ig_comment";

  useEffect(() => {
    if (!isIg) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("contact_ig_profile")
      .select(
        "follower_count, is_verified, follows_business, persona_hint, external_hint, opener_hint, is_public, external_enriched_at, enriched_at",
      )
      .eq("contact_id", contactId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setLoaded({ contactId, profile: (data as IgProfile | null) ?? null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, isIg]);

  const profile = loaded?.contactId === contactId ? loaded.profile : null;
  if (!isIg || !profile) return null;

  // El gancho concreto manda sobre las pistas abstractas: "publicó su nuevo
  // cachorro el martes" sirve para abrir; "le gustan los animales" no.
  const interests =
    profile.external_hint && profile.persona_hint
      ? `${profile.external_hint}; ${profile.persona_hint}`
      : profile.external_hint ?? profile.persona_hint;
  const facts: string[] = [];
  if (profile.follower_count != null) {
    facts.push(
      t("inbox.igFollowers", { n: fmt.number(profile.follower_count) }),
    );
  }
  if (profile.follows_business) facts.push(t("inbox.igFollowsYou"));
  if (profile.is_verified) facts.push(t("inbox.igVerified"));

  const privateAccount = profile.is_public === false;
  if (!profile.opener_hint && !interests && facts.length === 0 && !privateAccount) {
    return null;
  }

  return (
    <>
      <div>
        <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <UserSearch className="h-3 w-3 text-accent-ink" />
          {t("inbox.igProfileTitle")}
        </div>

        <div className="mt-2 space-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
          {profile.opener_hint && (
            <p className="text-[13px] leading-snug text-foreground">
              {profile.opener_hint}
            </p>
          )}
          {interests && (
            <p className="text-xs leading-snug text-muted-foreground">
              {interests}
            </p>
          )}
          {privateAccount && !interests && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" />
              {t("inbox.igPrivateAccount")}
            </p>
          )}
          {facts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {profile.follower_count != null && (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {t("inbox.igFollowers", {
                    n: fmt.number(profile.follower_count),
                  })}
                </span>
              )}
              {profile.follows_business && (
                <span className="text-accent-ink">{t("inbox.igFollowsYou")}</span>
              )}
              {profile.is_verified && (
                <span className="inline-flex items-center gap-1">
                  <BadgeCheck className="h-3 w-3" />
                  {t("inbox.igVerified")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="my-4 border-t border-border" />
    </>
  );
}
