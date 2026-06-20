"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";

const ENV_TIMEOUT = process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES;
const IDLE_MINUTES = Number(ENV_TIMEOUT) > 0 ? Number(ENV_TIMEOUT) : 30;
const WARN_SECONDS = 60;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "touchstart", "scroll"] as const;

/**
 * Idle-session sentinel. After IDLE_MINUTES with no user activity,
 * pops a 60-second warning modal; if the countdown finishes without
 * interaction we sign the user out. Skipped on the auth pages so a
 * forgotten login screen doesn't try to sign-out an already
 * unauthenticated visitor.
 */
export function IdleGuard() {
  const pathname = usePathname();
  const t = useT();
  const [warningOpen, setWarningOpen] = useState(false);
  const [remaining, setRemaining] = useState(WARN_SECONDS);
  const lastActiveRef = useRef<number>(Date.now());

  const skip =
    pathname?.startsWith("/ingresar") ||
    pathname?.startsWith("/registro") ||
    pathname?.startsWith("/recuperar-clave") ||
    pathname?.startsWith("/nueva-clave") ||
    pathname?.startsWith("/verificar-email") ||
    pathname?.startsWith("/invitacion");

  useEffect(() => {
    if (skip) return;

    const bump = () => {
      lastActiveRef.current = Date.now();
      if (warningOpen) setWarningOpen(false);
    };

    for (const e of ACTIVITY_EVENTS) {
      window.addEventListener(e, bump, { passive: true });
    }

    const idleMs = IDLE_MINUTES * 60_000;
    const tick = window.setInterval(() => {
      if (warningOpen) return;
      if (Date.now() - lastActiveRef.current >= idleMs) {
        setWarningOpen(true);
        setRemaining(WARN_SECONDS);
      }
    }, 5_000);

    return () => {
      for (const e of ACTIVITY_EVENTS) {
        window.removeEventListener(e, bump);
      }
      window.clearInterval(tick);
    };
  }, [skip, warningOpen]);

  useEffect(() => {
    if (!warningOpen) return;
    const countdown = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(countdown);
          void (async () => {
            const supabase = createClient();
            await supabase.auth.signOut();
            window.location.href = "/ingresar";
          })();
          return 0;
        }
        return r - 1;
      });
    }, 1_000);
    return () => window.clearInterval(countdown);
  }, [warningOpen]);

  if (skip || !warningOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-foreground">
          {t("auth.sessionExpiringIn", { remaining })}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("auth.sessionExpiringBody")}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              const supabase = createClient();
              await supabase.auth.signOut();
              window.location.href = "/ingresar";
            }}
            className="border-border text-foreground hover:bg-accent hover:text-foreground"
          >
            {t("auth.signOut")}
          </Button>
          <Button
            onClick={() => {
              lastActiveRef.current = Date.now();
              setWarningOpen(false);
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("auth.stayConnected")}
          </Button>
        </div>
      </div>
    </div>
  );
}
