-- Durable owner notifications. No merchant data or credentials are stored here.
alter table public.platform_watch_state
  add column if not exists pending_notifications jsonb not null default '[]'::jsonb,
  add column if not exists notification_lease_id uuid,
  add column if not exists notification_lease_until timestamptz;

create or replace function public.claim_platform_watch_notifications()
returns setof public.platform_watch_state
language plpgsql security definer set search_path = public as $$
begin
  insert into platform_watch_state(id, fingerprint) values (true, '')
    on conflict (id) do nothing;
  return query update platform_watch_state
    set notification_lease_id = gen_random_uuid(),
        notification_lease_until = now() + interval '10 minutes'
    where id = true and (notification_lease_until is null or notification_lease_until < now())
    returning *;
end $$;

create or replace function public.release_platform_watch_notifications(p_lease uuid)
returns void language sql security definer set search_path = public as $$
  update platform_watch_state set notification_lease_id = null, notification_lease_until = null
  where id = true and notification_lease_id = p_lease;
$$;
revoke all on function public.claim_platform_watch_notifications() from public, anon, authenticated;
revoke all on function public.release_platform_watch_notifications(uuid) from public, anon, authenticated;
grant execute on function public.claim_platform_watch_notifications() to service_role;
grant execute on function public.release_platform_watch_notifications(uuid) to service_role;

create table if not exists public.platform_provider_credit_signals (
  provider text primary key,
  key_digest text not null,
  state text not null check (state in ('ok', 'sin_saldo')),
  recorded_at timestamptz not null default now()
);
alter table public.platform_provider_credit_signals enable row level security;
revoke all on public.platform_provider_credit_signals from anon, authenticated;
grant all on public.platform_provider_credit_signals to service_role;
