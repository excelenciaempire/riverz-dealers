"use client";

import { useEffect, useState } from "react";
import { ExternalLink, ShoppingBag } from "lucide-react";
import { useT } from "@/hooks/use-locale";

/**
 * "Ver pedido" en la tienda de donde vino la venta.
 *
 * El chat no dice dónde compró la persona: puede haber comprado por la tienda
 * o por Mercado Libre, y cada pedido vive en un panel distinto. El endpoint
 * resuelve el origen (pedido espejado en Riverz → snapshot de Shopify) y
 * devuelve un solo enlace correcto. Sin venta que mostrar no se renderiza
 * nada, así que la ficha del contacto no se llena de botones muertos.
 */
interface CommerceLink {
  url: string | null;
  platform?: string;
  order_number?: string | null;
  kind?: "order" | "customer";
}

export function CommerceLinkButton({ contactId }: { contactId: string }) {
  const t = useT();
  // El resultado se guarda junto al contacto al que pertenece: al cambiar de
  // chat el enlace viejo deja de valer solo, sin limpiar estado desde el
  // efecto (que dispararía un render de más por cada cambio de conversación).
  const [state, setState] = useState<{ id: string; link: CommerceLink | null }>({
    id: contactId,
    link: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contacts/${contactId}/commerce-link`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CommerceLink | null) => {
        if (!cancelled) setState({ id: contactId, link: data });
      })
      .catch(() => {
        /* silencioso: el botón es contexto extra */
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const link = state.id === contactId ? state.link : null;
  if (!link?.url) return null;

  const label =
    link.platform === "mercadolibre"
      ? t("inbox.viewOrderInMercadoLibre")
      : link.kind === "customer"
        ? t("inbox.viewCustomerInShopify")
        : t("inbox.viewOrderInShopify");

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
    >
      <ShoppingBag className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
      {link.order_number && (
        <span className="text-xs text-muted-foreground">{link.order_number}</span>
      )}
      <ExternalLink className="h-3 w-3 text-muted-foreground" />
    </a>
  );
}
