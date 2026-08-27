-- Que Meta se entere de las ventas que se cierran en el chat.
--
-- Cuando el agente crea el pedido en la conversación —contra-entrega, sobre
-- todo— NO hay página de checkout, así que el píxel del navegador nunca
-- dispara un Purchase. Para Meta esa venta no existe: el algoritmo optimiza a
-- ciegas, el ROAS se ve más bajo de lo que es, y el comercio termina apagando
-- una campaña que estaba funcionando. Es el agujero más caro de vender por
-- chat en Latinoamérica, donde la contra-entrega es la norma.
--
-- La única forma de contarlo es la API de Conversiones, que se manda desde el
-- servidor. Y para que Meta pueda ATRIBUIR ese evento a un anuncio hacen falta
-- las señales que el navegador de la persona tenía cuando entró: `_fbp`, y
-- `_fbc` si vino de un clic. Sin eso el evento llega y no matchea con nadie.
--
-- 1. Dónde se guardan esas señales.
--
-- En la conversación y no en el contacto: son de ESTA visita. La misma persona
-- que vuelve en un mes por otro anuncio trae otro `_fbc`, y pisar el anterior
-- le atribuiría la venta a la campaña equivocada.
alter table conversations
  add column if not exists marketing jsonb;

comment on column conversations.marketing is
  'Señales del navegador para atribuir la venta: fbp, fbc, user_agent, ip y la URL donde empezó. Las captura el widget en la tienda; se usan en la API de Conversiones de Meta.';

-- 1.b Y dónde se guarda el píxel del comercio.
--
-- `workspace_integrations` ya tiene la forma exacta: un id externo público, una
-- credencial cifrada y un interruptor. Lo único que faltaba era dejar entrar el
-- proveedor nuevo — su CHECK sólo aceptaba 'klaviyo' y 'mercadopago', así que
-- guardar el píxel fallaba con una violación de restricción.
alter table workspace_integrations
  drop constraint if exists workspace_integrations_provider_check;

alter table workspace_integrations
  add constraint workspace_integrations_provider_check
  check (provider = any (array['klaviyo', 'mercadopago', 'meta_pixel']));

-- 2. Qué se mandó y qué contestaron.
--
-- Con su propia tabla y no un booleano en `orders`: el mismo pedido puede
-- generar más de un evento (Purchase ahora, y mañana otro tipo), hay que poder
-- reintentar lo que falló sin repetir lo que salió, y el comercio tiene
-- derecho a ver qué se envió en su nombre.
create table if not exists conversion_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- 'meta' hoy. Mañana puede haber otro destino con la misma forma.
  destino text not null default 'meta',
  event_name text not null,
  -- El id que deduplica contra el píxel del navegador. Meta descarta el
  -- segundo evento con el mismo (event_name, event_id), así que si la persona
  -- ADEMÁS pasa por el checkout la venta se cuenta UNA vez.
  event_id text not null,
  order_id uuid references orders(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  value numeric,
  currency text,
  status text not null default 'pendiente',
  -- Lo que contestó Meta, para poder mirar un fallo sin adivinar.
  response jsonb,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Un evento por pedido y tipo. Es la barrera contra el doble conteo: un
-- reintento, un webhook que llega dos veces o dos crons a la vez no pueden
-- inflarle las ventas a nadie.
create unique index if not exists conversion_events_una_vez
  on conversion_events (workspace_id, event_name, event_id);

create index if not exists conversion_events_por_cuenta
  on conversion_events (workspace_id, created_at desc);

-- Para el reintento: lo que quedó a medias.
create index if not exists conversion_events_pendientes
  on conversion_events (status, created_at)
  where status <> 'enviado';

alter table conversion_events enable row level security;

-- Se lee desde la cuenta; se escribe sólo desde el servidor (service role),
-- que es quien habla con Meta.
drop policy if exists "conversion_events por workspace" on conversion_events;
create policy "conversion_events por workspace" on conversion_events
  for select using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );
