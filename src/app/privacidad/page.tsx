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

const UPDATED = "18 de julio de 2026";
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

      {/* TODO (legal): las secciones de transferencias internacionales, RGPD y
          CCPA son una base estándar y razonable; deben ser revisadas por un
          abogado y ajustadas a la entidad y jurisdicción reales de riverz. */}
      <p className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        {t("legal.privacyDisclaimer")}
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
          <p className="mt-2">{t("legal.privacy2Isolation")}</p>
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
          <p className="mt-2">{t("legal.privacy4MlBody")}</p>
        </Section>

        <Section title={t("legal.privacy5Title")}>
          <p>{t("legal.privacy5Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("legal.privacy5ItemMeta")}</li>
            <li>{t("legal.privacy5ItemSupabase")}</li>
            <li>{t("legal.privacy5ItemRender")}</li>
            <li>{t("legal.privacy5ItemAnthropic")}</li>
            <li>{t("legal.privacy5ItemShopify")}</li>
            <li>{t("legal.privacy5ItemMercadoLibre")}</li>
            <li>{t("legal.privacy5ItemEmail")}</li>
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
          <p>{t("legal.privacy9Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("legal.privacy9Item1")}</li>
            <li>{t("legal.privacy9Item2")}</li>
            <li>{t("legal.privacy9Item3")}</li>
            <li>{t("legal.privacy9Item4")}</li>
          </ul>
        </Section>

        <Section title={t("legal.privacyIntlTitle")}>
          <p>{t("legal.privacyIntlBody")}</p>
        </Section>

        <Section title={t("legal.privacyGdprTitle")}>
          <p>{t("legal.privacyGdprIntro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("legal.privacyGdprItemAccess")}</li>
            <li>{t("legal.privacyGdprItemRectify")}</li>
            <li>{t("legal.privacyGdprItemErase")}</li>
            <li>{t("legal.privacyGdprItemRestrict")}</li>
            <li>{t("legal.privacyGdprItemPortability")}</li>
            <li>{t("legal.privacyGdprItemConsent")}</li>
            <li>{t("legal.privacyGdprItemComplaint")}</li>
          </ul>
          <p className="mt-2">{t("legal.privacyGdprBody")}</p>
        </Section>

        <Section title={t("legal.privacyCcpaTitle")}>
          <p>{t("legal.privacyCcpaIntro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("legal.privacyCcpaItemKnow")}</li>
            <li>{t("legal.privacyCcpaItemDelete")}</li>
            <li>{t("legal.privacyCcpaItemCorrect")}</li>
            <li>{t("legal.privacyCcpaItemNoDiscrim")}</li>
            <li>{t("legal.privacyCcpaItemNoSale")}</li>
          </ul>
          <p className="mt-2">{t("legal.privacyCcpaBody")}</p>
        </Section>

        <Section title={t("legal.privacy10Title")}>
          <p>{t("legal.privacy10Body")}</p>
        </Section>

        <Section title={t("legal.privacy11Title")}>
          <p>
            {t("legal.privacy11BodyPre")}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            {t("legal.privacy11BodyEnd")}
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
