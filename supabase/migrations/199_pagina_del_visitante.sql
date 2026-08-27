-- ============================================================
-- 199: qué página está mirando quien escribe por el chat web
-- ============================================================
-- El cargador ya mandaba la URL y el título de la página al abrir la sesión, y
-- el servidor los declaraba en el cuerpo y NUNCA los leía. Es el dato más
-- barato y más caro de perder del canal: la diferencia entre "hola, ¿tienen
-- talle M?" a secas y la misma pregunta sabiendo que la persona está parada en
-- la ficha de un producto concreto.
--
-- Va en la conversación y no en cada mensaje: lo que hace falta es dónde está
-- AHORA, no un historial de navegación. Se pisa en cada mensaje, así que quien
-- pasa del producto al carrito y vuelve a escribir se lee con la página nueva.
-- Guardar una fila por mensaje sería un registro de navegación de gente que no
-- lo pidió, y no hace falta para contestar mejor.
--
-- Sin RLS propia: `conversations` ya la tiene y estas columnas viajan con la
-- fila.
--
-- Idempotente. Se aplica a mano por la Management API.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS page_url TEXT,
  ADD COLUMN IF NOT EXISTS page_title TEXT;

COMMENT ON COLUMN conversations.page_url IS
  'Chat web: la página de la tienda desde la que se escribió el último mensaje. Se pisa en cada mensaje.';
COMMENT ON COLUMN conversations.page_title IS
  'Chat web: el título de esa página, que suele ser el nombre del producto.';
