<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Minimalista y profesional — sin texto innecesario (no-negociable)

Todo lo que construyas o modifiques debe ser minimalista y profesional. No agregues texto innecesario ni redundante:

- Sin hints que expliquen lo obvio o repitan lo que el label, la estructura o el placeholder ya dicen. Una línea corta gana a un párrafo; si un texto no aporta información nueva, elimínalo.
- Copy en español neutro (sin voseo argentino).
- **Sin caracteres incógnitos / mojibake.** Todo el texto es UTF-8 correcto: tildes, `¿` `¡`, `ñ` y emojis reales — nunca `�` ni `??`. Al escribir archivos o insertar en la DB, garantiza la codificación; nunca pases strings por un round-trip Latin-1/UTF-8 que los corrompa.

# Bilingual by default (es + en) — non-negotiable

Riverz ships in Spanish AND English. **Everything you build or modify from now on must work in both languages.** Never hardcode a single-language, user-facing string. This applies to every session and every contributor.

- **UI strings**: use the i18n catalogs in `src/lib/i18n/messages/<ns>.ts` (each entry `{ es, en }`), resolved via `useT()` / `getT()` (client) or `translate(locale, key)` (server). Add the key to the right namespace with both languages. Format dates/numbers/currency via `useFormat()` / `format.ts`.
- **Server API errors** shown to users: localize at the source — `translate(await getLocale(), 'errX.key')` — don't return hardcoded Spanish/English literals.
- **URLs**: routes are localized. Folders under `src/app` stay Spanish (canonical); the English slugs are masked by rewrites in `next.config.ts`. Use `import Link from "@/components/i18n/locale-link"` (drop-in for next/link) and `useLocalizedRouter()` (drop-in for useRouter) so navigation keeps the URL in the active language. The slug map + `localizePath`/`canonicalizePath` live in `src/lib/i18n/routes.ts`; add new routes there. Active-state and any path checks should `canonicalizePath()` first. Both forms always resolve, so a missed swap degrades to the Spanish slug — it never 404s.
- **Do NOT translate**: AI/agent prompts and customer-facing message bodies (those follow the agent's own `ai_agents.language`), Supabase auth emails (dashboard templates), logs, and internal/machine error codes.
- First-visit default language is detected by IP/geo then browser language (`src/lib/i18n/detect.ts`, seeded in `src/proxy.ts`); the user can change it in onboarding/Settings (cookie `riverz_locale`).
