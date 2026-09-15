"use client";

import { useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/hooks/use-locale";

function bounded(value: string, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), maximum) : 0;
}

function Field({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-[14px] font-medium">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 rounded-xl border bg-transparent px-4 py-3 text-[16px] outline-none focus-visible:ring-2"
        style={{ borderColor: "var(--sn-line)", color: "var(--sn-ink)" }}
      />
    </label>
  );
}

export function RoiCalculator({ monthlyPrice }: { monthlyPrice: number | null }) {
  const t = useT();
  const fmt = useFormat();
  const [orders, setOrders] = useState("2000");
  const [ticket, setTicket] = useState("70");
  const [margin, setMargin] = useState("30");
  const [uplift, setUplift] = useState("3");
  const [customPrice, setCustomPrice] = useState("");

  const monthlyOrders = bounded(orders, 1_000_000);
  const averageTicket = bounded(ticket, 1_000_000);
  const grossMargin = bounded(margin, 100) / 100;
  const possibleUplift = bounded(uplift, 100) / 100;
  const extraOrders = Math.round(monthlyOrders * possibleUplift);
  const marginPerOrder = averageTicket * grossMargin;
  const additionalMargin = extraOrders * marginPerOrder;
  const enteredCustomPrice = bounded(customPrice, 1_000_000);
  const hasPrice = monthlyPrice !== null || enteredCustomPrice > 0;
  const investment = monthlyPrice ?? enteredCustomPrice;
  const roi = hasPrice && investment > 0
    ? ((additionalMargin - investment) / investment) * 100
    : null;
  const breakEvenOrders = hasPrice && marginPerOrder > 0
    ? Math.ceil(investment / marginPerOrder)
    : null;

  return (
    <div className="sn-card mx-auto mt-10 max-w-5xl px-5 py-8 text-left sm:px-10 sm:py-10 lg:mt-14 lg:px-14">
      <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:gap-12">
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("landingV4.roiOrdersLabel")} value={orders} onChange={setOrders} max={1_000_000} />
            <Field label={t("landingV4.roiTicketLabel")} value={ticket} onChange={setTicket} max={1_000_000} />
            <Field label={t("landingV4.roiMarginLabel")} value={margin} onChange={setMargin} max={100} />
            <Field label={t("landingV4.roiUpliftLabel")} value={uplift} onChange={setUplift} max={100} />
            {monthlyPrice === null && (
              <Field label={t("landingV4.roiCustomPriceLabel")} value={customPrice} onChange={setCustomPrice} max={1_000_000} />
            )}
          </div>
        </div>

        <div className="sn-card-sand flex flex-col justify-between rounded-[20px] p-6 sm:p-8">
          <div>
            <p className="text-[14px] font-medium">{t("landingV4.roiEstimatedReturn")}</p>
            <p className="sn-roi-number mt-2 font-[family-name:var(--font-editorial)] tracking-[-0.04em]">
              {roi === null ? "—" : `${fmt.number(roi, { maximumFractionDigits: 0 })}%`}
            </p>
            <div className="mt-7 space-y-2 border-t pt-5 text-[15px]" style={{ borderColor: "var(--sn-line)" }}>
              <p className="flex justify-between gap-4"><span>{t("landingV4.roiExtraOrders")}</span><strong className="min-w-0 text-right [overflow-wrap:anywhere]">{fmt.number(extraOrders)}</strong></p>
              <p className="flex justify-between gap-4"><span>{t("landingV4.roiAdditionalMargin")}</span><strong className="min-w-0 text-right [overflow-wrap:anywhere]">{fmt.money(additionalMargin, "USD")}</strong></p>
              <p className="flex justify-between gap-4"><span>{t("landingV4.roiInvestment")}</span><strong className="min-w-0 text-right [overflow-wrap:anywhere]">{hasPrice ? fmt.money(investment, "USD") : "—"}</strong></p>
            </div>
          </div>
          {breakEvenOrders !== null && (
            <p className="mt-8 text-[15px] font-medium leading-6">
              {t("landingV4.roiBreakEven", { count: fmt.number(breakEvenOrders) })}
            </p>
          )}
        </div>
      </div>
      <p className="mt-5 max-w-[75ch] text-[14px] leading-5" style={{ color: "var(--sn-ink-2)" }}>
        {t("landingV4.roiNote")}
      </p>
    </div>
  );
}
