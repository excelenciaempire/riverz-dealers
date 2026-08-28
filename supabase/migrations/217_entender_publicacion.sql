-- 217 — Entender la publicación, que se cobraba a nadie
--
-- Cuando alguien comenta una foto de Instagram o Facebook, el agente no
-- contesta a ciegas: primero MIRA la publicación —qué producto se ve, qué dice
-- el texto sobreimpreso— con una llamada de visión al modelo. Es la clave de
-- Riverz pagando, exactamente igual que una respuesta, y no estaba en la tabla
-- de tarifas ni descontaba nada.
--
-- El VIDEO no entra acá y es a propósito: se transcribe con Whisper en Groq,
-- que sale una fracción de centavo por hora. Cobrarlo agregaría una línea al
-- libro por cada video para mover menos de lo que cuesta redondearlo — el piso
-- de un movimiento es un centavo, catorce veces lo que cuesta el trabajo.
INSERT INTO wallet_tarifas (concepto, nombre_es, nombre_en, unidad, precio_milicentavos, orden)
VALUES ('entender_publicacion', 'Entender una publicación', 'Understanding a post', 'publicación', 1500, 5)
ON CONFLICT (concepto) DO UPDATE SET activo = TRUE;
