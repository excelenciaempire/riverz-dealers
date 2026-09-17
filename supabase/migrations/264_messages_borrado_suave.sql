-- 264 — Borrar un mensaje de la bandeja lo esconde; no lo destruye.
--
-- Hasta ahora el tacho de la bandeja hacía DELETE de la fila. El agente de IA
-- arma su contexto leyendo `messages`, así que cada borrado le recortaba la
-- conversación: lo que el comercio sacó de la vista desaparecía también de la
-- memoria del agente, y el siguiente turno se respondía sin saber qué se
-- había dicho. El dueño lo pidió al revés (2026-09-17): la IA siempre tiene
-- toda la conversación; lo que se borra sólo deja de VERSE en la interfaz.
--
-- `deleted_at` marca el mensaje. La bandeja y el chat web filtran
-- `deleted_at is null`; el runner de IA, el Operador y las estadísticas leen
-- todo. `deleted_by_user_id` deja constancia de quién lo sacó.
--
-- Distinto de `is_hidden` (migración 095), que es "oculto EN la red" para un
-- comentario público y que el comercio puede revertir desde la barra.
-- `deleted_scope` dice hasta dónde llegó el borrado: 'me' (sólo la bandeja)
-- o 'everyone' (también del lado del cliente: el comentario borrado en la red,
-- o el chat web, que es nuestro). El chat web usa esto para decidir si el
-- visitante lo sigue viendo.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_scope text CHECK (deleted_scope IN ('me', 'everyone')),
  ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- El hilo pide "los últimos N visibles de esta conversación": el índice
-- parcial deja fuera lo borrado y sirve el ORDER BY sin ordenar aparte.
CREATE INDEX IF NOT EXISTS messages_conversation_visible_idx
  ON public.messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.messages.deleted_at IS
  'Borrado desde la bandeja: la interfaz no lo muestra, la IA sí lo sigue leyendo.';
