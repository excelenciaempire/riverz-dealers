import type { Metadata } from "next";
import { CalculatorScreen } from "@/components/landing/v4/calculator-screen";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { absolute: t("landingV4.roiMetaTitle") },
    description: t("landingV4.roiMetaDescription"),
    alternates: {
      canonical: "/calculadora",
      languages: { es: "/calculadora", en: "/calculator" },
    },
  };
}

export default function CalculatorPage() {
  return <CalculatorScreen />;
}
