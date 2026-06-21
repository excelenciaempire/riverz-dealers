import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("legal.privacyMetaTitle"),
    description: t("legal.privacyMetaDescription"),
    // Public + indexable so Meta can verify the URL during App Review.
    robots: { index: true, follow: true },
  };
}

const UPDATED = "19 de junio de 2026";
const CONTACT = "info@riverzai.com";

export default async function PrivacidadPage() {
  const t = await getT();
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("legal.brand")}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        {t("legal.privacyTitle")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("legal.updatedLabel", { date: UPDATED })}
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground/90">
        <Section title={t("legal.privacy1Title")}>
          <p>
            {t("legal.privacy1BodyPre")}
            <a href="https://riverz.co" className="underline">
              riverz.co
            </a>
            {t("legal.privacy1BodyMid")}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            {t("legal.privacy1BodyEnd")}
          </p>
        </Section>

        <Section title={t("legal.privacy2Title")}>
          <p>{t("legal.privacy2Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>{t("legal.privacy2Item1Strong")}</strong>
              {t("legal.privacy2Item1Rest")}
            </li>
            <li>
              <strong>{t("legal.privacy2Item2Strong")}</strong>
              {t("legal.privacy2Item2Rest")}
            </li>
          </ul>
        </Section>

        <Section title={t("legal.privacy3Title")}>
          <p>{t("legal.privacy3Body")}</p>
        </Section>

        <Section title={t("legal.privacy4Title")}>
          <p>
            {t("legal.privacy4BodyPre")}
            <strong>{t("legal.privacy4BodyStrong")}</strong>
            {t("legal.privacy4BodyEnd")}
          </p>
        </Section>

        <Section title={t("legal.privacy5Title")}>
          <p>{t("legal.privacy5Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("legal.privacy5ItemMeta")}</li>
            <li>{t("legal.privacy5ItemSupabase")}</li>
            <li>{t("legal.privacy5ItemRender")}</li>
            <li>{t("legal.privacy5ItemAnthropic")}</li>
            <li>{t("legal.privacy5ItemShopify")}</li>
          </ul>
        </Section>

        <Section title={t("legal.privacy6Title")}>
          <p>{t("legal.privacy6Body")}</p>
        </Section>

        <Section title={t("legal.privacy7Title")}>
          <p>{t("legal.privacy7Body1")}</p>
          <p className="mt-2">
            {t("legal.privacy7Body2Pre")}
            <Link href="/eliminar-datos" className="underline">
              riverz.co/eliminar-datos
            </Link>
            {t("legal.privacy7Body2End")}
          </p>
        </Section>

        <Section title={t("legal.privacy8Title")}>
          <p>{t("legal.privacy8Body")}</p>
        </Section>

        <Section title={t("legal.privacy9Title")}>
          <p>{t("legal.privacy9Body")}</p>
        </Section>

        <Section title={t("legal.privacy10Title")}>
          <p>
            {t("legal.privacy10BodyPre")}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            {t("legal.privacy10BodyEnd")}
          </p>
        </Section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/terminos" className="underline">
          {t("legal.footerTerms")}
        </Link>
        <span className="mx-2">·</span>
        <Link href="/eliminar-datos" className="underline">
          {t("legal.footerDeleteData")}
        </Link>
        <span className="mx-2">·</span>
        <a href="https://riverz.co" className="underline">
          {t("legal.footerSite")}
        </a>
      </footer>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-2 text-foreground/85">{children}</div>
    </section>
  );
}
