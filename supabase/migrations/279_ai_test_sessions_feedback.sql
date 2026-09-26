-- Lo que opina quien prueba, sobre cada respuesta y sobre la prueba entera.
--
-- `feedback` es una lista de {item, voto, nota, at}: `item` es la posición del
-- mensaje en `items` (null = comentario de la prueba entera), `voto` es
-- 'bien' o 'mal'. `propuestas` guarda lo último que la IA sugirió cambiar a
-- partir de ese feedback, para que se revise y se aplique con un clic.
ALTER TABLE public.ai_test_sessions
  ADD COLUMN IF NOT EXISTS feedback jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS propuestas jsonb;
