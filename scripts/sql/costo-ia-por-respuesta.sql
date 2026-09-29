-- Lo que cuesta cada respuesta de la IA, para medir los cambios de caché del
-- asistente. Solo lectura, sobre producción (proyecto ozurxrnujkgjqmilttln).
-- Se cambia `ventana` y se comparan dos ventanas del mismo largo.
--
-- Partida, con la caché de 1 h (medido el 2026-09-29):
--   2026-09-17 al 29   4,00 ¢ por petición cobrada (4,07 exacto), 1.412 peticiones
--                      4,95 ¢ por respuesta enviada, 788 respuestas, 67 % escribe caché
--   últimas 72 h       5,16 ¢ por petición cobrada (5,19 exacto), 513 peticiones
--                      6,70 ¢ por respuesta enviada, 303 respuestas, 69 % escribe caché
--   Los mismos datos con la caché de 5 min: 3,43 ¢ por respuesta enviada (−31 %);
--   sin caché, 4,49 ¢.
--
-- Una respuesta son una o más peticiones (el bucle de herramientas), y la
-- billetera cobra también las que no se envían: por eso la primera consulta
-- cuenta peticiones y la segunda, respuestas.

-- 1. Lo que se descuenta del saldo, por petición.
with ventana(desde, hasta) as (values (timestamptz '2026-09-17 00:00+00', now()))
select count(*) peticiones,
       round(sum(-m.centavos)::numeric / sum(m.cantidad), 2) centavos_por_peticion,
       round(avg(m.costo_centavos), 3) exacto,
       round(100.0 * avg(((m.detalle->'usage'->>'cache_creation_input_tokens')::int > 0)::int), 1) pct_escribe_cache,
       sum((m.detalle->'usage'->'cache_creation'->>'ephemeral_5m_input_tokens')::bigint) escritos_5m,
       sum((m.detalle->'usage'->'cache_creation'->>'ephemeral_1h_input_tokens')::bigint) escritos_1h
from ventana v
join wallet_movimientos m on m.creado_en >= v.desde and m.creado_en < v.hasta
where m.concepto = 'ia_respuesta' and m.tipo = 'consumo';

-- 2. Por respuesta enviada, separando la primera de cada chat de las
--    siguientes según cuánto tardaron. `ai_replies` no dice con qué TTL se
--    escribió: se toma de la fecha, igual que `ttlDeCacheDelAsistente`.
with ventana(desde, hasta) as (values (timestamptz '2026-09-17 00:00+00', now())),
r as (
  select a.created_at, a.prompt_tokens p, a.completion_tokens c,
         coalesce(a.cache_read_tokens, 0) cr, coalesce(a.cache_write_tokens, 0) cw,
         case when a.model like 'claude-haiku%' then 1 when a.model like 'claude-opus%' then 5 else 2 end tarifa,
         case when a.created_at >= '2026-09-17' and a.created_at < '2026-09-30' then 2 else 1.25 end escritura,
         a.created_at - lag(a.created_at) over (partition by a.conversation_id order by a.created_at) espera
  from ventana v
  join ai_replies a on a.created_at >= v.desde and a.created_at < v.hasta
  where a.status = 'sent' and a.prompt_tokens > 0
)
select coalesce(grupo, 'total') grupo, count(*) respuestas,
       round(avg(cw)) escritos, round(avg(cr)) leidos,
       round(100.0 * avg((cw > 0)::int), 1) pct_escribe_cache,
       round(avg((p + 5 * c + 0.1 * cr + escritura * cw) * tarifa / 1e4), 3) centavos_por_respuesta
from (
  select *, case when espera is null then '1 primera'
                 when espera < interval '5 minutes' then '2 menos de 5 min'
                 when espera < interval '60 minutes' then '3 de 5 a 60 min'
                 else '4 más de 60 min' end grupo
  from r
) g
group by rollup(grupo)
order by grupo nulls last;

-- 3. Desde el prompt por capas (2026-09-29): cada petición, qué escribió a una
--    hora (lo del agente, en frío), qué a cinco minutos (lo de la persona) y
--    cuánto leyó. En una cuenta con tráfico casi todas las primeras
--    peticiones de un chat leen lo del agente en vez de escribirlo.
with ventana(desde, hasta) as (values (timestamptz '2026-09-29 18:00+00', now()))
select left(m.workspace_id::text, 8) cuenta,
       count(*) peticiones,
       round(avg(m.costo_centavos), 3) centavos_por_peticion,
       count(*) filter (where (m.detalle->'usage'->'cache_creation'->>'ephemeral_1h_input_tokens')::int > 0) escribe_1h,
       round(avg((m.detalle->'usage'->'cache_creation'->>'ephemeral_1h_input_tokens')::int)) escritos_1h,
       round(avg((m.detalle->'usage'->'cache_creation'->>'ephemeral_5m_input_tokens')::int)) escritos_5m,
       round(avg((m.detalle->'usage'->>'cache_read_input_tokens')::int)) leidos
from ventana v
join wallet_movimientos m on m.creado_en >= v.desde and m.creado_en < v.hasta
where m.concepto = 'ia_respuesta' and m.tipo = 'consumo'
group by rollup(1)
order by 1 nulls last;
