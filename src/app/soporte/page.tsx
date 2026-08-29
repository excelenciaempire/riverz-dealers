import type { Metadata } from "next";
import Link from "@/components/i18n/locale-link";
import { LegalLangSwitch } from "@/components/legal/lang-switch";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("legal.supportMetaTitle"),
    description: t("legal.supportMetaDescription"),
    // Pública e indexable: las tiendas de aplicaciones piden una URL de
    // soporte que puedan abrir sin cuenta.
    robots: { index: true, follow: true },
  };
}

const CONTACT = "riverzoficial@gmail.com";

/**
 * Página de soporte.
 *
 * Existe porque las fichas de las tiendas de aplicaciones (Tiendanube,
 * Shopify) exigen una URL de soporte pública, y un correo suelto no
 * alcanza: el revisor la abre para comprobar que hay a quién escribirle.
 */
export default async function SoportePage() {
  const t = await getT();
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("legal.brand")}
        </p>
        <LegalLangSwitch />
      </div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        {t("legal.supportTitle")}
      </h1>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <p>{t("legal.supportIntro")}</p>

        <p>
          <a
            href={`mailto:${CONTACT}`}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {CONTACT}
          </a>
        </p>

        <p className="text-muted-foreground">{t("legal.supportHours")}</p>

        <p className="text-muted-foreground">
          {t("legal.supportLegal")}{" "}
          <Link
            href="/privacidad"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t("legal.privacyTitle")}
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
