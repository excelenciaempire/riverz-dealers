-- Transactional guide delivery: one receipt per guide and Shopify order.
create table if not exists public.post_purchase_guides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_domain text not null,
  connection_id uuid not null references public.channel_connections(id),
  name text not null,
  guide_product_id text not null,
  qualifying_product_id text not null,
  minimum_quantity integer not null default 3 check (minimum_quantity > 0),
  file_url text not null check (file_url like 'https://cdn.shopify.com/%'),
  subject text not null,
  body text not null,
  enabled boolean not null default false,
  enabled_at timestamptz not null default now(),
  scan_after timestamptz not null default now(),
  scan_until timestamptz,
  scan_page_url text,
  last_error text,
  unique (workspace_id, shop_domain, guide_product_id)
);
create table if not exists public.post_purchase_guide_deliveries (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.post_purchase_guides(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','uncertain','cancelled','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  sent_at timestamptz,
  external_message_id text,
  recipient_email text,
  email_subject text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (guide_id, order_id)
);
create index if not exists post_purchase_guides_due on public.post_purchase_guide_deliveries(guide_id, status, next_attempt_at);
alter table public.post_purchase_guides enable row level security;
alter table public.post_purchase_guide_deliveries enable row level security;
revoke all on public.post_purchase_guides, public.post_purchase_guide_deliveries from anon, authenticated;
grant all on public.post_purchase_guides, public.post_purchase_guide_deliveries to service_role;
