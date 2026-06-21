import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("legal.termsMetaTitle"),
    description: t("legal.termsMetaDescription"),
    // Public + indexable so Meta can verify the URL during App Review.
    robots: { index: true, follow: true },
  };
}

const UPDATED = "19 de junio de 2026";
const CONTACT = "info@riverzai.com";

export default async function TerminosPage() {
  const t = await getT();
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("legal.brand")}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        {t("legal.termsTitle")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("legal.updatedLabel", { date: UPDATED })}
      </p>

      {/* TODO (legal): este texto es una base razonable para un SaaS B2B y
          debe ser revisado y validado por un abogado antes de considerarse
          definitivo. Ajusta jurisdicción, responsabilidad, planes y precios
          según la operación real de riverz. */}
      <p className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        {t("legal.termsDisclaimer")}
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground/90">
        <Section title={t("legal.terms1Title")}>
          <p>
            {t("legal.terms1BodyPre")}
            <a href="https://riverz.co" className="underline">
              riverz.co
            </a>
            {t("legal.terms1BodyMid")}
            <Link href="/privacidad" className="underline">
              {t("legal.footerPrivacy")}
            </Link>
            {t("legal.terms1BodyEnd")}
          </p>
        </Section>

        <Section title={t("legal.terms2Title")}>
          <p>{t("legal.terms2Body")}</p>
        </Section>

        <Section title={t("legal.terms3Title")}>
          <p>{t("legal.terms3Body")}</p>
        </Section>

        <Section title={t("legal.terms4Title")}>
          <p>{t("legal.terms4Intro")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("legal.terms4Item1")}</li>
            <li>{t("legal.terms4Item2")}</li>
            <li>{t("legal.terms4Item3")}</li>
            <li>{t("legal.terms4Item4")}</li>
          </ul>
          <p className="mt-2">{t("legal.terms4Footer")}</p>
        </Section>

        <Section title={t("legal.terms5Title")}>
          <p>{t("legal.terms5Body")}</p>
        </Section>

        <Section title={t("legal.terms6Title")}>
          <p>{t("legal.terms6Body")}</p>
        </Section>

        <Section title={t("legal.terms7Title")}>
          <p>{t("legal.terms7Body")}</p>
        </Section>

        <Section title={t("legal.terms8Title")}>
          <p>
            {t("legal.terms8BodyPre")}
            <Link href="/privacidad" className="underline">
              {t("legal.footerPrivacy")}
            </Link>
            {t("legal.terms8BodyEnd")}
          </p>
        </Section>

        <Section title={t("legal.terms9Title")}>
          <p>{t("legal.terms9Body")}</p>
        </Section>

        <Section title={t("legal.terms10Title")}>
          <p>{t("legal.terms10Body")}</p>
        </Section>

        <Section title={t("legal.terms11Title")}>
          <p>{t("legal.terms11Body")}</p>
        </Section>

        <Section title={t("legal.terms12Title")}>
          <p>{t("legal.terms12Body")}</p>
        </Section>

        <Section title={t("legal.terms13Title")}>
          <p>{t("legal.terms13Body")}</p>
        </Section>

        <Section title={t("legal.terms14Title")}>
          <p>
            {t("legal.terms14BodyPre")}
            <a href={`mailto:${CONTACT}`} className="underline">
              {CONTACT}
            </a>
            {t("legal.terms14BodyEnd")}
          </p>
        </Section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/privacidad" className="underline">
          {t("legal.footerPrivacy")}
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
