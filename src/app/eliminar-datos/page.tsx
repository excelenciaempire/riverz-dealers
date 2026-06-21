import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("legal.deleteMetaTitle"),
    description: t("legal.deleteMetaDescription"),
    // Public + indexable so Meta can verify the URL during App Review.
    robots: { index: true, follow: true },
  };
}

const CONTACT = "info@riverzai.com";

export default async function EliminarDatosPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const t = await getT();

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("legal.brand")}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        {t("legal.deleteTitle")}
      </h1>

      {code && (
        <div className="mt-6 rounded-lg border border-emerald-600/30 bg-emerald-500/5 px-4 py-3 text-sm text-foreground">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">
            {t("legal.deleteReceivedTitle")}
          </p>
          <p className="mt-1 text-foreground/85">
            {t("legal.deleteReceivedBody1")}{" "}
            <span className="font-mono text-foreground break-all">{code}</span>
          </p>
          <p className="mt-1 text-foreground/85">
            {t("legal.deleteReceivedBody2")}
          </p>
        </div>
      )}

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <p>{t("legal.deleteIntro")}</p>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            {t("legal.delete1Title")}
          </h2>
          <p className="mt-2 text-foreground/85">{t("legal.delete1Body")}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            {t("legal.delete2Title")}
          </h2>
          <p className="mt-2 text-foreground/85">
            {t("legal.delete2BodyPre")}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            {t("legal.delete2BodyEnd")}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">
            {t("legal.deleteWhatTitle")}
          </h2>
          <p className="mt-2 text-foreground/85">{t("legal.deleteWhatBody")}</p>
        </section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/privacidad" className="underline">
          {t("legal.footerPrivacy")}
        </Link>
        <span className="mx-2">·</span>
        <a href="https://riverz.co" className="underline">
          {t("legal.footerSite")}
        </a>
      </footer>
    </main>
  );
}
