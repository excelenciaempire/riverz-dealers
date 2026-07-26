"use client";

import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/hooks/use-locale";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import { useBusinessPhoneCountry } from "@/hooks/use-business-phone-country";
import { findPhones } from "@/lib/inbox/phones";
import { phonesMatch } from "@/lib/whatsapp/phone-utils";
import type { Conversation } from "@/types";

/**
 * Cuando el cliente deja su teléfono en un mensaje (lo típico en Instagram y
 * Messenger, donde mandar enlaces es incómodo), la burbuja ofrece pasar la
 * conversación a WhatsApp sin copiar el número a mano: abre —o crea— el hilo
 * de WhatsApp con esa persona dentro de Riverz.
 *
 * No renderiza nada cuando no hay un teléfono válido, que es el caso normal.
 */
export function PhoneActions({
  text,
  contactName,
  contactPhone,
}: {
  text?: string | null;
  contactName?: string | null;
  /** Teléfono del contacto del hilo: si el mensaje repite ese mismo número no
   *  hay nada que ofrecer — ya estamos hablando con esa persona. */
  contactPhone?: string | null;
}) {
  const t = useT();
  const country = useBusinessPhoneCountry();
  const fetchWithCsrf = useFetchWithCsrf();
  const router = useLocalizedRouter();
  const [busyPhone, setBusyPhone] = useState<string | null>(null);

  const phones = findPhones(text, country).filter(
    (p) => !contactPhone || !phonesMatch(p.e164, contactPhone),
  );
  if (phones.length === 0) return null;

  async function openWhatsapp(e164: string) {
    setBusyPhone(e164);
    try {
      const res = await fetchWithCsrf("/api/conversations/start-whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: e164, name: contactName ?? undefined }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        conversation?: Conversation;
        error?: string;
      };
      if (!res.ok || !payload.conversation) {
        toast.error(payload.error || t("inbox.newChatFailed", { reason: "" }));
        return;
      }
      // El hilo de WhatsApp queda abierto en la bandeja: desde ahí el
      // composer ya resuelve si se puede escribir libre o hace falta una
      // plantilla (ventana de 24 h de Meta).
      router.push(`/bandeja?c=${payload.conversation.id}`);
    } finally {
      setBusyPhone(null);
    }
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1 border-t border-border/40 pt-1.5">
      {phones.map((p) => (
        <button
          key={p.e164}
          type="button"
          onClick={() => void openWhatsapp(p.e164)}
          disabled={busyPhone !== null}
          className="flex items-center gap-1.5 text-xs font-medium text-accent-ink hover:opacity-80 disabled:opacity-50"
        >
          {busyPhone === p.e164 ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">
            {t("inbox.writeOnWhatsapp", { phone: p.display })}
          </span>
        </button>
      ))}
    </div>
  );
}
