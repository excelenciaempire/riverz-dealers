import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getT();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <span className="mb-6 inline-block text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink">
          riverz
        </span>
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          404
        </p>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground">
          {t("system.notFoundTitle")}
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          {t("system.notFoundDescription")}
        </p>
        <Link href="/panel" className={buttonVariants({ variant: "default" })}>
          {t("system.backHome")}
        </Link>
      </div>
    </div>
  );
}
