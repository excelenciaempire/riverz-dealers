// Alias route — the Shopify Partner Dashboard for "Riverz Inbox" was
// configured with /api/shopify/oauth/callback as the redirect URI, but
// the canonical handler lives at /api/shopify/callback. Re-export the
// GET handler here so requests to either path resolve to the same logic
// without forcing a Shopify version bump (each version change is a
// distribution-blocking event for custom-app installs).
export { GET } from '../../callback/route'
