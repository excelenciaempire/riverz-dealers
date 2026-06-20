import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

// Force dynamic rendering per-request so the CSP nonce minted by the
// proxy (forwarded via the x-nonce header) is available to inject into
// streaming inline scripts. Static prerender would strip the nonce and
// any boot script would be blocked by CSP.
export const dynamic = "force-dynamic";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* Discoverable legal links (Meta App Review expects the privacy
          policy reachable from the app). Subtle, fixed at the bottom. */}
      <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center gap-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] text-muted-foreground">
        <Link href="/privacidad" className="pointer-events-auto hover:text-foreground">
          Privacidad
        </Link>
        <span aria-hidden>·</span>
        <Link href="/eliminar-datos" className="pointer-events-auto hover:text-foreground">
          Eliminar datos
        </Link>
      </footer>
    </>
  );
}
