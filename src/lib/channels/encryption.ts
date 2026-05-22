/**
 * Channel-agnostic re-export of the AES-256-GCM helpers in
 * `lib/whatsapp/encryption.ts`. Stored under `lib/channels/` so new
 * adapters import from the channel namespace rather than reaching into
 * the legacy WhatsApp folder.
 */
export { encrypt, decrypt, isLegacyFormat } from "@/lib/whatsapp/encryption";
