-- Marketing Messages de Meta: la lista de gente a la que SÍ se le puede
-- escribir fuera de la ventana.
--
-- Hasta ahora todo lo saliente de Instagram vivía dentro de dos ventanas que
-- Meta impone: 24 h desde el último DM del cliente, 7 días desde su comentario.
-- Fuera de ahí no se puede escribir, así que "Prospección IA" sólo podía
-- hablarle a quien había interactuado hace muy poco — decenas de personas — y
-- se pisaba con Comentarios, que ya le había escrito a esa misma gente.
--
-- Meta sí permite salir de esa jaula: se le pide permiso a la persona DENTRO
-- de la ventana (plantilla `notification_messages`) y, si acepta, devuelve un
-- token con el que se le puede escribir indefinidamente, con un tope de un
-- mensaje cada 48 h. Funciona en cuentas profesionales de Instagram y en
-- páginas de Facebook. Este es el lugar donde vive ese token.
--
-- Reemplazó a Recurring Notifications el 10-feb-2026. Hoy es gratis; Meta
-- avisa que piensa cobrarlo, por eso se guarda `sent_count`: sin ese número no
-- hay forma de estimar el costo cuando llegue.

create table if not exists public.meta_marketing_optins (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  connection_id uuid references public.channel_connections(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'messenger')),
  -- IGSID / PSID: quién es del lado de Meta. El token va atado a esta persona
  -- y a este tema, no al contacto de Riverz, que puede fusionarse o migrar.
  external_contact_id text not null,
  notification_messages_token text not null,
  token_expiry_timestamp timestamptz,
  -- El "tema" que la persona aceptó recibir. Meta lo muestra tal cual en el
  -- pedido de permiso y exige que lo que se mande después se corresponda.
  title text not null default 'Ofertas y novedades',
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked')),
  -- Tope duro de Meta: un envío cada 48 h por suscriptor. Se guarda calculado
  -- para no repetir la aritmética en cada barrido de campaña.
  last_sent_at timestamptz,
  next_eligible_at timestamptz,
  sent_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una persona puede aceptar varios temas; lo que no puede haber son dos filas
-- del mismo tema para la misma persona en la misma cuenta. El ON CONFLICT del
-- webhook depende de este índice para renovar el token en vez de duplicarlo.
create unique index if not exists idx_meta_optins_unique
  on public.meta_marketing_optins (connection_id, external_contact_id, title);

-- Resolver la audiencia de una campaña pregunta exactamente esto: quién de
-- este workspace se puede contactar ahora mismo.
create index if not exists idx_meta_optins_reachable
  on public.meta_marketing_optins (workspace_id, status, next_eligible_at);

create index if not exists idx_meta_optins_contact
  on public.meta_marketing_optins (contact_id);

alter table public.meta_marketing_optins enable row level security;

-- Lectura para el equipo del workspace (la UI cuenta suscriptores); las
-- escrituras entran por el webhook y por el envío, ambos con service-role.
drop policy if exists "members read marketing optins" on public.meta_marketing_optins;
create policy "members read marketing optins" on public.meta_marketing_optins
  for select using (is_workspace_member(workspace_id));

-- Pedir el permiso es, en sí, un mensaje más que el cliente recibe. Arranca
-- APAGADO: que el agente sume una burbuja a cada conversación es una decisión
-- del comercio, no un default que se le aplica sin avisar.
alter table public.ig_proactive_settings
  add column if not exists marketing_optin_enabled boolean not null default false;

comment on column public.ig_proactive_settings.marketing_optin_enabled is
  'Pedir permiso de Marketing Messages cuando el agente ya está conversando con la persona. Llena meta_marketing_optins.';
