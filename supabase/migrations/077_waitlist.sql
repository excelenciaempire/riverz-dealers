-- ============================================================
-- 077 — Waitlist (pre-launch lead capture)
--
-- The public landing replaces "crear cuenta / iniciar sesión" with a
-- "Unirse a la lista de espera" form while the product is in pre-launch.
-- Every submission is captured here (durable record) and also emailed to
-- the owner by POST /api/waitlist.
--
-- RLS is ON with NO policies: anon/authenticated clients can neither read
-- nor write. Only the service-role key (used server-side by the API route)
-- bypasses RLS, so leads can never be enumerated from the browser.
-- ============================================================

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  name       text,
  source     text not null default 'landing',
  created_at timestamptz not null default now()
);

-- One row per email (the API upserts on conflict).
create unique index if not exists uq_waitlist_email
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;
-- (intentionally no policies — service role only)
