"use client";

import { useState } from "react";
import Link from "@/components/i18n/locale-link";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/hooks/use-locale";
import { FIRST_MONTH_DISCOUNT_PERCENT, firstMonthCents } from "@/lib/billing/first-month-offer";
import { LocaleSwitch } from "./bits";
import type { PricingTier } from "./pricing-tiers";
import { RoiCalculator } from "./roi-calculator";
import "./editorial.css";

export function CalculatorScreen({ tiers }: { tiers: PricingTier[] }) {
  const t = useT();
  const fmt = useFormat();
  const [tierIndex, setTierIndex] = useState(1);
  const tier = tiers[tierIndex];

  return (
    <div className="sn min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Link href="/" className="text-[21px] font-semibold lowercase tracking-[-0.03em]">riverz</Link>
        <LocaleSwitch />
      </header>

      <main className="sn-pricing-shell min-h-[calc(100vh-80px)] px-5 pb-16 pt-12 lg:pb-24 lg:pt-20">
        <div className="mx-auto max-w-6xl">
          <h1 className="sn-display mx-auto max-w-[16ch] text-center">{t("landingV4.roiTitle")}</h1>

          <section
            className="sn-card sn-calculator-plan mx-auto mt-10 max-w-5xl text-center lg:mt-14"
            aria-labelledby="roi-plan-label"
          >
            <h2 id="roi-plan-label" className="text-[15px] font-medium">{t("landingV4.roiPlanLabel")}</h2>
            <div className="mx-auto mt-5 grid max-w-3xl grid-cols-5 gap-1.5 sm:gap-3">
              {tiers.map((option, index) => {
                const label = option.customers === null
                  ? t("landingV4.pricingTierMore")
                  : option.customers < 1_000
                    ? fmt.number(option.customers)
                    : `${fmt.number(option.customers / 1_000)}k`;
                return (
                  <button
                    key={option.customers ?? "custom"}
                    type="button"
                    onClick={() => setTierIndex(index)}
                    aria-pressed={index === tierIndex}
                    aria-label={option.customers === null
                      ? t("landingV4.pricingCustomVolume")
                      : t("landingV4.pricingUpToCustomers", { count: fmt.number(option.customers) })}
                    className="min-w-0 rounded-full px-1 py-3 font-[family-name:var(--font-mono-label)] text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 sm:text-[14px]"
                    style={{
                      background: index === tierIndex ? "var(--sn-ink)" : "var(--sn-paper)",
                      color: index === tierIndex ? "var(--sn-card)" : "var(--sn-ink)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="sn-calculator-price mt-6 font-[family-name:var(--font-editorial)]">
              {tier.monthly === null ? t("landingV4.pricingCustomPrice") : fmt.money(tier.monthly, "USD")}
              {tier.monthly !== null && (
                <span className="ml-2 font-[family-name:var(--font-grotesk)] text-[14px]">
                  {t("landingV4.pricingPerMonth")}
                </span>
              )}
            </p>
            {tier.monthly !== null && (
              <p className="mt-3 text-[14px] text-[var(--sn-ink-2)]">
                {t("landingV4.pricingCalculatorOffer", {
                  percent: FIRST_MONTH_DISCOUNT_PERCENT,
                  amount: fmt.money(firstMonthCents(tier.monthly * 100) / 100, "USD"),
                })}
              </p>
            )}
            {tier.monthly !== null && tier.customers !== null && (
              <p className="mt-2 text-[13px] text-[var(--sn-ink-2)]">
                {t("landingV4.pricingPerContact", {
                  amount: fmt.number(Math.round(tier.monthly * 100 / tier.customers)),
                })}
              </p>
            )}
          </section>

          <RoiCalculator monthlyPrice={tier.monthly} />
          <div className="mt-8 text-center">
            <Link href="/#precios" className="text-[14px] font-medium underline underline-offset-4">
              {t("landingV4.roiBackToPricing")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
