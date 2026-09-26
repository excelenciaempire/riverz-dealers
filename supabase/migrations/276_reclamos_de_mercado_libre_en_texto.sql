-- ============================================================
-- 276 - Lo que escribe Mercado Libre en un reclamo, en texto
-- ============================================================
--
-- En un reclamo, los mensajes del equipo de Mercado Libre llegan en el HTML de
-- su editor (<p>, <span style=…>, &oacute;). `claims-poll` los guardaba tal
-- cual en `content_text` y la bandeja mostraba las etiquetas en vez del
-- mensaje: en la burbuja, en el resumen de la conversación y en el último
-- mensaje del reclamo que lee el asistente.
--
-- El código ya guarda el texto y deja el HTML original en `html_body`, como en
-- un correo (`claimMessageBody`). Esto convierte lo que entró antes con la
-- misma receta: cada enlace suma su destino entre paréntesis salvo el de la
-- portada de un sitio, cada párrafo queda separado por una línea en blanco y
-- las entidades vuelven a ser el carácter. El original queda en `html_body`.
--
-- Visto en producción el 2026-09-25: 16 mensajes de 6 reclamos.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.texto_de_html(h text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t text := h;
  e record;
BEGIN
  -- El enlace a la portada de un sitio (la firma) queda en su texto; los demás
  -- suman su destino.
  t := regexp_replace(t,
    '<a\s[^>]*href="https?://[^/?#"]+/?(?:[?#][^"]*)?"[^>]*>((?:[^<]|<(?!/a>))*)</a>',
    '\1', 'gi');
  t := regexp_replace(t,
    '<a\s[^>]*href="(https?://[^"]*)"[^>]*>((?:[^<]|<(?!/a>))*)</a>',
    '\2 (\1)', 'gi');

  -- Saltos y bordes de bloque pasan a saltos de línea; el resto de las
  -- etiquetas se va.
  t := regexp_replace(t, '<br\s*/?>', E'\n', 'gi');
  t := regexp_replace(t, '</(p|div|li|tr|h[1-6]|blockquote|table|ul|ol)>', E'\n', 'gi');
  t := regexp_replace(t, '<(p|div|blockquote|tr|li)(\s[^>]*)?>', E'\n', 'gi');
  t := regexp_replace(t, '<[^>]+>', '', 'g');

  -- Entidades. &amp; va al final para no decodificar dos veces.
  FOR e IN
    SELECT * FROM (VALUES
      ('&aacute;', 'á'), ('&eacute;', 'é'), ('&iacute;', 'í'),
      ('&oacute;', 'ó'), ('&uacute;', 'ú'), ('&Aacute;', 'Á'),
      ('&Eacute;', 'É'), ('&Iacute;', 'Í'), ('&Oacute;', 'Ó'),
      ('&Uacute;', 'Ú'), ('&ntilde;', 'ñ'), ('&Ntilde;', 'Ñ'),
      ('&uuml;', 'ü'), ('&Uuml;', 'Ü'), ('&iexcl;', '¡'),
      ('&iquest;', '¿'), ('&nbsp;', ' '), ('&lt;', '<'),
      ('&gt;', '>'), ('&quot;', '"'), ('&#39;', ''''),
      ('&amp;', '&')
    ) AS entidades(k, v)
  LOOP
    t := replace(t, e.k, e.v);
  END LOOP;

  -- Espacios colapsados sin tocar los saltos; como mucho una línea en blanco.
  t := regexp_replace(t, '[ \t\r\f' || chr(160) || ']+', ' ', 'g');
  t := regexp_replace(t, ' ?\n ?', E'\n', 'g');
  t := regexp_replace(t, '\n{3,}', E'\n\n', 'g');
  RETURN btrim(t, E' \n');
END $$;

-- 1) Los mensajes.
UPDATE messages m
   SET html_body = m.content_text,
       content_text = pg_temp.texto_de_html(m.content_text)
  FROM conversations c
 WHERE c.id = m.conversation_id
   AND m.channel = 'mercadolibre'
   AND c.thread_external_id LIKE 'claim:%'
   AND m.html_body IS NULL
   AND m.content_text ~* '</?(p|br|div|span|b|strong|i|em|u|a|ul|ol|li)\y[^>]*>';

-- 2) El resumen de cada conversación, desde su último mensaje.
UPDATE conversations c
   SET last_message_text = left(u.content_text, 200)
  FROM (
    SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.content_text
      FROM messages m
     WHERE m.channel = 'mercadolibre'
       AND m.deleted_at IS NULL
     ORDER BY m.conversation_id, m.created_at DESC
  ) u
 WHERE u.conversation_id = c.id
   AND c.channel = 'mercadolibre'
   AND c.last_message_text ~* '</?(p|br|div|span|b|strong|i|em|u|a|ul|ol|li)\y';

-- 3) El último mensaje de cada reclamo.
UPDATE ml_claims mc
   SET last_message = left(u.content_text, 500)
  FROM (
    SELECT DISTINCT ON (c.workspace_id, c.thread_external_id)
           c.workspace_id, c.thread_external_id, m.content_text
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
     WHERE m.channel = 'mercadolibre'
       AND c.thread_external_id LIKE 'claim:%'
     ORDER BY c.workspace_id, c.thread_external_id, m.created_at DESC
  ) u
 WHERE u.workspace_id = mc.workspace_id
   AND u.thread_external_id = 'claim:' || mc.claim_id
   AND mc.last_message ~* '</?(p|br|div|span|b|strong|i|em|u|a|ul|ol|li)\y';
