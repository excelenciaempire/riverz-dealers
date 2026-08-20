-- Si el comercio le puso "me gusta" a un comentario, la bandeja tiene que saberlo.
--
-- El botón de me gusta de la barra de moderación nacía siempre apagado: el
-- estado vivía sólo en la memoria del componente, así que al recargar la página
-- (o al abrir el hilo en otra pestaña) un comentario ya likeado se veía sin
-- likear, y volver a tocarlo mandaba LIKE sobre algo que ya lo estaba.
--
-- TikTok devuelve el estado real (`liked`) en cada lectura de comentarios, así
-- que ahora se guarda y la barra lo refleja. La columna es de comentarios en
-- general: cuando Meta exponga lo mismo, ya está el lugar.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_liked boolean;

COMMENT ON COLUMN messages.is_liked IS
  'Comentarios: si la cuenta del comercio le puso me gusta. NULL = desconocido.';
