import { Loader2 } from "lucide-react";

/**
 * Route-segment loading UI for the whole dashboard. Its mere existence is
 * the point: without a `loading.tsx`, the App Router keeps the *previous*
 * page frozen on screen while it fetches the next segment's RSC payload
 * (each navigation also goes through the proxy's `supabase.auth.getUser()`
 * round-trip), so a menu click feels like "nothing happens for a moment".
 *
 * With this Suspense boundary Next paints instant feedback the moment the
 * link is clicked — the boundary is already in the loaded layout tree — and
 * swaps in the real page when it's ready. Every dashboard page is a client
 * component that shows its own in-content loaders afterwards, so this only
 * covers the brief navigation gap. Kept minimal on purpose.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}
