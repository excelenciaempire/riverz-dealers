-- 220 — Lo que la IA gastaba y nadie descontaba
--
-- Seis caminos llamaban al modelo con la llave de Riverz sin pasar por la
-- billetera: ni se frenaban sin saldo ni descontaban un centavo. Eran, en
-- orden de plata: el Operador (el más caro de todos, entre 5 y 15 centavos por
-- turno), el seguimiento automático, el resumen de la conversación, el resumen
-- del cliente, la respuesta al que comenta en público, y las dos
-- clasificaciones —la rama del flujo y la etiqueta del contacto—.
--
-- El Operador ya tenía su tarifa. Los otros necesitan la suya, y sin ella
-- `cobrar` devuelve null en silencio: la tarifa es lo que autoriza el cobro,
-- así que una fila que falta no rompe nada, simplemente no cobra. Que es
-- exactamente el agujero que esto cierra.
--
-- Los precios son ~2x el costo de lista del proveedor, igual que el resto de
-- la tabla. La cuenta que paga a costo no los mira: a ella se le descuenta lo
-- que su consumo costó de verdad, medido sobre sus propios tokens.
INSERT INTO wallet_tarifas (concepto, nombre_es, nombre_en, unidad, precio_milicentavos, orden)
VALUES
  ('ia_seguimiento',  'Seguimientos de la IA',      'AI follow-ups',      'seguimiento', 2000, 9),
  ('ia_resumen',      'Memoria de tus conversaciones', 'Conversation memory', 'resumen',  1200, 10),
  ('ia_clasificacion','Entender qué te pidieron',   'Understanding what was asked', 'consulta', 300, 11)
ON CONFLICT (concepto) DO UPDATE SET activo = TRUE;
