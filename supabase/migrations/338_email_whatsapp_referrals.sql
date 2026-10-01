-- Email links and actual WhatsApp inquiries are separate events.
create table if not exists public.email_whatsapp_links (
  token text primary key check (token ~ '^[a-f0-9]{24}$'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email_connection_id uuid not null references public.channel_connections(id) on delete cascade,
  whatsapp_connection_id uuid not null references public.channel_connections(id) on delete cascade,
  source_key text not null,
  source_kind text not null check (source_kind in ('purchase_guide','email_inquiry')),
  source_conversation_id uuid references public.conversations(id) on delete set null,
  order_id text,
  order_name text,
  prefill text not null,
  is_test boolean not null default false,
  click_count bigint not null default 0,
  last_clicked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workspace_id, source_key)
);
create table if not exists public.email_whatsapp_inquiries (
  message_id uuid primary key references public.messages(id) on delete cascade,
  token text not null references public.email_whatsapp_links(token) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  received_at timestamptz not null
);
create index if not exists email_whatsapp_inquiries_workspace on public.email_whatsapp_inquiries(workspace_id, received_at);
alter table public.conversations add column if not exists email_referral jsonb;
alter table public.email_whatsapp_links enable row level security;
alter table public.email_whatsapp_inquiries enable row level security;
revoke all on public.email_whatsapp_links, public.email_whatsapp_inquiries from anon, authenticated;
grant all on public.email_whatsapp_links, public.email_whatsapp_inquiries to service_role;

create or replace function public.count_email_whatsapp_click(p_token text)
returns void language sql security invoker set search_path = public as $$
  update public.email_whatsapp_links set click_count = click_count + 1, last_clicked_at = now() where token = p_token;
$$;

create or replace function public.record_email_whatsapp_inquiry(
  p_token text, p_workspace_id uuid, p_connection_id uuid,
  p_conversation_id uuid, p_message_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare link public.email_whatsapp_links%rowtype; received timestamptz; referral jsonb; inserted integer;
begin
  select l.* into link from public.email_whatsapp_links l
  join public.channel_connections wc on wc.id = l.whatsapp_connection_id
  where l.token = p_token and l.workspace_id = p_workspace_id and not l.is_test
    and l.whatsapp_connection_id = p_connection_id
    and wc.workspace_id = p_workspace_id and wc.channel = 'whatsapp';
  if not found then return null; end if;
  select m.created_at into received from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.id = p_message_id and m.conversation_id = p_conversation_id
    and m.channel = 'whatsapp' and m.sender_type = 'customer'
    and c.workspace_id = p_workspace_id and c.connection_id = p_connection_id
    and m.created_at >= link.created_at - interval '1 minute';
  if not found then return null; end if;
  referral := jsonb_build_object('kind', link.source_kind, 'orderName', link.order_name,
    'sourceConversationId', link.source_conversation_id, 'receivedAt', received);
  insert into public.email_whatsapp_inquiries(message_id, token, workspace_id, conversation_id, received_at)
    values(p_message_id, p_token, p_workspace_id, p_conversation_id, received) on conflict(message_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.conversations set email_referral = referral where id = p_conversation_id and workspace_id = p_workspace_id;
  end if;
  return referral;
end;
$$;
revoke all on function public.count_email_whatsapp_click(text) from public, anon, authenticated;
revoke all on function public.record_email_whatsapp_inquiry(text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.count_email_whatsapp_click(text) to service_role;
grant execute on function public.record_email_whatsapp_inquiry(text, uuid, uuid, uuid, uuid) to service_role;
