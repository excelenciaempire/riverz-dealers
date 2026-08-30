-- 226 — Lo que faltaba cobrar, y que el comercio lo vea
--
-- La 225 dejó dicho que lo que cobra el proveedor es lo que se le carga al
-- comercio. Faltaban cuatro consumos que corren con llaves de Riverz y no
-- llegaban a la billetera por ningún lado. No aparecían como gratis: no
-- aparecían.
--
--   1. **La ayuda de la IA en el panel.** Mejorar un texto, escribir un
--      borrador, probar un agente, leer una web para armar el conocimiento,
--      redactar una plantilla, armar un plan de campaña. Siete rutas que ya
--      frenaban sin saldo — o sea, ya sabían que costaba plata — y ninguna
--      descontaba un centavo. Son llamadas a Sonnet y Opus, no baratas.
--
--   2. **La transcripción de audios.** La nota de voz que manda un cliente y el
--      video de TikTok cuyo contenido el agente necesita para poder contestar
--      el comentario. Corre en Whisper (Groq u OpenAI).
--
--   3. **Leer una página web.** Firecrawl, cuando se arma el conocimiento del
--      agente desde una URL o se enriquece la ficha de un producto.
--
--   4. **Consultar un perfil público.** Apify, para saber de qué habla la
--      persona que comentó antes de escribirle.
--
-- Las cuatro tarifas son el PISO —lo que se cobra de verdad es el costo
-- medido—, pero tienen que existir: sin fila en `wallet_tarifas`, `cobrar`
-- devuelve null EN SILENCIO y el consumo vuelve a salir gratis. Es el agujero
-- más fácil de reabrir.
--
-- Y tienen que existir por una segunda razón, que es la que pidió el dueño:
-- la pantalla de la billetera lista los conceptos de esta tabla. Un consumo sin
-- fila acá es un consumo que el comercio NO VE.

INSERT INTO wallet_tarifas (concepto, nombre_es, nombre_en, unidad, precio_milicentavos, activo, orden)
VALUES
  ('ia_asistencia', 'Ayuda de la IA en el panel', 'AI help in the app', 'uso', 2000, TRUE, 10),
  ('transcripcion', 'Pasar audio a texto', 'Audio to text', 'minuto', 600, TRUE, 11),
  ('lectura_de_pagina', 'Leer una página web', 'Reading a web page', 'página', 200, TRUE, 12),
  ('perfil_externo', 'Consultar un perfil público', 'Looking up a public profile', 'perfil', 300, TRUE, 13)
ON CONFLICT (concepto) DO UPDATE
  SET nombre_es = EXCLUDED.nombre_es,
      nombre_en = EXCLUDED.nombre_en,
      unidad = EXCLUDED.unidad,
      activo = TRUE;
