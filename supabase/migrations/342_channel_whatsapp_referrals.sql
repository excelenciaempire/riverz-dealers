-- Reuse the same scoped, idempotent referral ledger for social inquiries.
-- Legacy column/table names remain compatible with purchase-guide emails.
alter table public.email_whatsapp_links add column if not exists source_channel text;
alter table public.email_whatsapp_links drop constraint if exists email_whatsapp_links_source_kind_check;
alter table public.email_whatsapp_links add constraint email_whatsapp_links_source_kind_check
  check (source_kind in ('purchase_guide','email_inquiry','channel_inquiry'));
alter table public.email_whatsapp_links drop constraint if exists email_whatsapp_links_channel_source_check;
alter table public.email_whatsapp_links add constraint email_whatsapp_links_channel_source_check
  check (source_kind <> 'channel_inquiry' or (source_channel is not null and source_channel in ('instagram','messenger','webchat','fb_comment','ig_comment','tiktok_comment')));

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
  if link.source_kind = 'channel_inquiry' then
    referral := referral || jsonb_build_object('sourceChannel', link.source_channel);
  end if;
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
