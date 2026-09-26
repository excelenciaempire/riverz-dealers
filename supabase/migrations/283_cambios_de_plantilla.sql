-- Cambios de texto que un comercio pide sobre una plantilla que ya está en
-- Meta (pendiente o aprobada). Meta no deja editarla en revisión, y editar una
-- aprobada la vuelve a revisar: el cambio se guarda acá, el equipo de Riverz
-- lo ve con el antes y el después en el panel de plataforma y, al aprobarlo,
-- se crea la plantilla nueva, se manda a Meta y las automatizaciones pasan a
-- usarla.
create table if not exists public.cambios_de_plantilla (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plantilla_id uuid references public.message_templates(id) on delete set null,
  plantilla_nombre text not null,
  antes text not null,
  despues text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobado', 'descartado', 'fallido')),
  pedido_por uuid references auth.users(id) on delete set null,
  nueva_plantilla text,
  motivo text,
  created_at timestamptz not null default now(),
  resuelto_at timestamptz
);

create index if not exists cambios_de_plantilla_ws_idx
  on public.cambios_de_plantilla (workspace_id, created_at desc);

-- Sólo el servidor (service role) la lee y la escribe.
alter table public.cambios_de_plantilla enable row level security;
