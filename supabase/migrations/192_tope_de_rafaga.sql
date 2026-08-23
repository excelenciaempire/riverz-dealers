-- El tope de ráfaga, configurable.
--
-- Es la red que impide que un bucle —dos bots hablándose, un webhook que
-- reentrega, un flujo mal armado— le mande cien mensajes a la misma persona.
-- Estaba escrito en el código (`BURST_MAX_REPLIES = 20`) y no había forma de
-- moverlo: un comercio con conversaciones largas de verdad se topaba con el
-- freno sin saber que existía, y otro que quisiera ser más prudente tampoco
-- podía bajarlo.
--
-- 20 por hora y por contacto sigue siendo el valor de siempre: esto no le
-- cambia la conducta a nadie hasta que alguien toque el número.

alter table ai_agents
  add column if not exists reply_burst_max integer not null default 20;

comment on column ai_agents.reply_burst_max is
  'Cuántas respuestas seguidas puede mandarle este agente a un mismo contacto en una hora antes de apagarse en ese hilo. 0 = sin tope.';

-- Acotado en la base y no sólo en la pantalla: el cuerpo de un PATCH lo arma un
-- cliente que no controlamos, y esto termina decidiendo cuántos mensajes recibe
-- una persona.
alter table ai_agents
  drop constraint if exists ai_agents_reply_burst_max_check;

alter table ai_agents
  add constraint ai_agents_reply_burst_max_check
  check (reply_burst_max >= 0 and reply_burst_max <= 200);
