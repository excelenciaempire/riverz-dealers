-- Reusable voice notes are not Meta-approved message templates.
create table if not exists public.voice_note_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists voice_note_templates_workspace_idx on public.voice_note_templates(workspace_id);
alter table public.voice_note_templates enable row level security;
drop policy if exists voice_note_templates_members on public.voice_note_templates;
create policy voice_note_templates_members on public.voice_note_templates for all to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = voice_note_templates.workspace_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.workspace_members m where m.workspace_id = voice_note_templates.workspace_id and m.user_id = auth.uid()));
alter table public.broadcasts add column if not exists voice_note jsonb;
alter table public.ai_agents add column if not exists voice_note jsonb;
alter table public.ai_pending_replies add column if not exists voice_note jsonb;
