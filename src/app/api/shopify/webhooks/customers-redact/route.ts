import { handleGdprWebhook } from '@/lib/shopify/gdpr'

export async function POST(request: Request) {
  return handleGdprWebhook(request)
}
