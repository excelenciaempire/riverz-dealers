"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { countryOfBusinessNumber } from "@/lib/inbox/phones";

/**
 * País del número de WhatsApp del comercio ("AR", "CO"…). Es el contexto que
 * falta para leer un teléfono local escrito en un mensaje: sin él,
 * "3878514146" no se distingue de un id de pedido.
 *
 * Se resuelve UNA vez por sesión de pestaña (promesa cacheada a nivel módulo):
 * cada burbuja de la bandeja lo consulta, y una query por mensaje sería
 * absurda. Devuelve null mientras carga o si no hay WhatsApp conectado — en
 * ese caso sólo se detectan los números en formato internacional.
 */
let cached: Promise<string | null> | null = null;

function resolveCountry(): Promise<string | null> {
  if (cached) return cached;
  cached = (async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("channel_connections")
        .select("config")
        .eq("channel", "whatsapp")
        .eq("status", "connected")
        .limit(1)
        .maybeSingle();
      const cfg = (data?.config ?? null) as Record<string, unknown> | null;
      return countryOfBusinessNumber(
        typeof cfg?.display_phone_number === "string" ? cfg.display_phone_number : null,
      );
    } catch {
      return null;
    }
  })();
  return cached;
}

export function useBusinessPhoneCountry(): string | null {
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveCountry().then((c) => {
      if (alive) setCountry(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return country;
}
