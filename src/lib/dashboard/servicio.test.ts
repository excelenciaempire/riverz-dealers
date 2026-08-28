import { describe, expect, it } from 'vitest';
import {
  escalacionesPorMotivo,
  fueraDeHorario,
  mediana,
  primeraRespuesta,
  type Horario,
  type Mensaje,
} from './servicio';

const AR = 'America/Argentina/Buenos_Aires';

/** Lunes a viernes, 9 a 18, hora de Buenos Aires. */
const COMERCIO: Horario = {
  inicio: '09:00:00',
  fin: '18:00:00',
  dias: [1, 2, 3, 4, 5],
  tz: AR,
};

describe('fueraDeHorario', () => {
  it('un martes al mediodia esta abierto', () => {
    // 2026-08-25 es martes. 15:00 UTC = 12:00 en Buenos Aires.
    expect(fueraDeHorario('2026-08-25T15:00:00Z', COMERCIO)).toBe(false);
  });

  it('un martes a las tres de la manana esta cerrado', () => {
    // 06:00 UTC = 03:00 en Buenos Aires.
    expect(fueraDeHorario('2026-08-25T06:00:00Z', COMERCIO)).toBe(true);
  });

  it('el domingo esta cerrado aunque sea mediodia', () => {
    // 2026-08-23 es domingo.
    expect(fueraDeHorario('2026-08-23T15:00:00Z', COMERCIO)).toBe(true);
  });

  it('mide en la zona del comercio, no en UTC', () => {
    // 2026-08-25T23:00Z es martes en UTC pero ya son las 20:00 del martes en
    // Buenos Aires: cerrado. Con la cuenta hecha en UTC daria "abierto".
    expect(fueraDeHorario('2026-08-25T23:00:00Z', COMERCIO)).toBe(true);
    // Y 11:00Z son las 08:00 alla: todavia cerrado, aunque en UTC ya abrio.
    expect(fueraDeHorario('2026-08-25T11:00:00Z', COMERCIO)).toBe(true);
  });

  it('aguanta un horario que cruza la medianoche', () => {
    const nocturno: Horario = { ...COMERCIO, inicio: '22:00:00', fin: '06:00:00' };
    // 03:00 en Buenos Aires: DENTRO del turno noche.
    expect(fueraDeHorario('2026-08-25T06:00:00Z', nocturno)).toBe(false);
    // 12:00 alla: fuera.
    expect(fueraDeHorario('2026-08-25T15:00:00Z', nocturno)).toBe(true);
  });

  it('un horario de 24 h nunca esta cerrado en sus dias', () => {
    const siempre: Horario = { ...COMERCIO, inicio: '00:00:00', fin: '00:00:00' };
    expect(fueraDeHorario('2026-08-25T06:00:00Z', siempre)).toBe(false);
    // Pero el domingo sigue sin estar en la lista de dias.
    expect(fueraDeHorario('2026-08-23T06:00:00Z', siempre)).toBe(true);
  });

  it('sin horario cargado responde "no se", no "no"', () => {
    // Es la diferencia que evita inflar la metrica con el silencio.
    expect(fueraDeHorario('2026-08-25T06:00:00Z', { ...COMERCIO, inicio: null })).toBeNull();
    expect(fueraDeHorario('2026-08-25T06:00:00Z', { ...COMERCIO, dias: [] })).toBeNull();
    expect(fueraDeHorario('no-es-fecha', COMERCIO)).toBeNull();
  });
});

describe('mediana', () => {
  it('no se deja arrastrar por un caso extremo', () => {
    // Un hilo que quedo 3 dias abierto no puede mover el numero.
    expect(mediana([5, 7, 9, 11, 300000])).toBe(9);
  });

  it('promedia los dos del medio cuando son pares', () => {
    expect(mediana([10, 20, 30, 40])).toBe(25);
  });

  it('sin muestras devuelve null, no cero', () => {
    expect(mediana([])).toBeNull();
  });
});

describe('primeraRespuesta', () => {
  const msg = (
    conv: string,
    tipo: string,
    iso: string,
    origin?: string,
  ): Mensaje => ({
    conversation_id: conv,
    sender_type: tipo,
    created_at: iso,
    origin: origin ?? null,
  });

  it('separa lo que tardo la IA de lo que tardo una persona', () => {
    const r = primeraRespuesta([
      // Conversacion A: contesta el asistente a los 10 s.
      msg('a', 'customer', '2026-08-25T10:00:00Z'),
      msg('a', 'bot', '2026-08-25T10:00:10Z', 'ai_agent'),
      // Conversacion B: contesta una persona a las 2 h.
      msg('b', 'customer', '2026-08-25T10:00:00Z'),
      msg('b', 'agent', '2026-08-25T12:00:00Z'),
    ]);
    expect(r.ia).toBe(10);
    expect(r.humano).toBe(7200);
    expect(r.muestrasIa).toBe(1);
    expect(r.muestrasHumano).toBe(1);
  });

  it('una automatizacion NO cuenta como la IA', () => {
    // Dispara en segundos porque es un disparador. Meterla con el asistente
    // era lo que hacia decir "la IA contesta en 25 s" sin que la IA hubiera
    // contestado nada.
    const r = primeraRespuesta([
      msg('a', 'customer', '2026-08-25T10:00:00Z'),
      msg('a', 'bot', '2026-08-25T10:00:03Z', 'automation'),
      msg('b', 'customer', '2026-08-25T10:00:00Z'),
      msg('b', 'bot', '2026-08-25T10:00:40Z', 'ai_agent'),
    ]);
    expect(r.automatico).toBe(3);
    expect(r.muestrasAutomatico).toBe(1);
    expect(r.ia).toBe(40);
    expect(r.muestrasIa).toBe(1);
  });

  it('cuenta a quien llego PRIMERO, no a los dos', () => {
    // La IA contesta y despues entra una persona: la conversacion cuenta para
    // la IA, que es lo que vivio el cliente.
    const r = primeraRespuesta([
      msg('a', 'customer', '2026-08-25T10:00:00Z'),
      msg('a', 'bot', '2026-08-25T10:00:05Z', 'ai_agent'),
      msg('a', 'agent', '2026-08-25T11:00:00Z'),
    ]);
    expect(r.ia).toBe(5);
    expect(r.muestrasHumano).toBe(0);
  });

  it('ignora un saliente anterior al mensaje del cliente', () => {
    // Una campana enviada antes no es "responder rapido".
    const r = primeraRespuesta([
      msg('a', 'bot', '2026-08-25T09:00:00Z', 'ai_agent'),
      msg('a', 'customer', '2026-08-25T10:00:00Z'),
      msg('a', 'bot', '2026-08-25T10:00:30Z', 'ai_agent'),
    ]);
    expect(r.ia).toBe(30);
  });

  it('una conversacion sin respuesta no aporta a nadie', () => {
    const r = primeraRespuesta([msg('a', 'customer', '2026-08-25T10:00:00Z')]);
    expect(r.ia).toBeNull();
    expect(r.humano).toBeNull();
  });

  it('aguanta mensajes desordenados', () => {
    const r = primeraRespuesta([
      msg('a', 'bot', '2026-08-25T10:00:20Z', 'ai_agent'),
      msg('a', 'customer', '2026-08-25T10:00:00Z'),
    ]);
    expect(r.ia).toBe(20);
  });
});

describe('escalacionesPorMotivo', () => {
  it('cuenta solo las que de verdad escalaron, y ordena por peso', () => {
    const r = escalacionesPorMotivo([
      { needs_human_at: 'x', needs_human_reason: 'escalation_keyword' },
      { needs_human_at: 'x', needs_human_reason: 'escalation_keyword' },
      { needs_human_at: 'x', needs_human_reason: 'flow_handoff' },
      // Sin fecha de escalada: no escalo, por mas que tenga motivo viejo.
      { needs_human_at: null, needs_human_reason: 'escalation_keyword' },
    ]);
    expect(r).toEqual([
      { motivo: 'escalation_keyword', n: 2 },
      { motivo: 'flow_handoff', n: 1 },
    ]);
  });

  it('agrupa las que escalaron sin motivo registrado', () => {
    const r = escalacionesPorMotivo([{ needs_human_at: 'x', needs_human_reason: null }]);
    expect(r).toEqual([{ motivo: 'sin_motivo', n: 1 }]);
  });
});
