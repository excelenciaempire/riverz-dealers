import { describe, expect, it } from "vitest";
import type { InboundEvent } from "../types";
import {
  finishIfDone,
  HISTORY_DAYS,
  historyFlags,
  initialBackfillState,
  markPackHistory,
  MAX_PHASE_FAILURES,
  mlSearchDate,
  nextOrdersCursor,
  nextSearchOffset,
  readBackfillState,
  recordPhaseFailure,
  recordPhaseSuccess,
} from "./history-state";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const DAY = 86_400_000;

describe("estado de la importación histórica", () => {
  it("arranca con las tres fases abiertas y un año hacia atrás", () => {
    const s = initialBackfillState(NOW);
    expect(s.orders).toEqual({ before: "2026-09-26T12:00:00.000Z", offset: 0 });
    expect(s.questions).toEqual({ offset: 0 });
    expect(s.claims).toEqual({ offset: 0 });
    expect(Date.parse(s.horizon)).toBe(NOW - HISTORY_DAYS * DAY);
    expect(s.completed_at).toBeNull();
  });

  it("reinicia un estado ilegible en vez de abortar", () => {
    expect(readBackfillState(null, NOW)).toEqual(initialBackfillState(NOW));
    expect(readBackfillState({ v: 2 }, NOW)).toEqual(initialBackfillState(NOW));
    expect(readBackfillState({ v: 1, started_at: "no", horizon: "x" }, NOW)).toEqual(
      initialBackfillState(NOW),
    );
  });

  it("conserva el avance guardado y las fases ya terminadas", () => {
    const saved = {
      ...initialBackfillState(NOW - DAY),
      orders: { before: "2026-05-01T00:00:00.000Z", offset: 3 },
      questions: null,
      claims: { offset: 40 },
      packs: 12,
      abandoned: ["questions", "otra"],
    };
    const s = readBackfillState(JSON.parse(JSON.stringify(saved)), NOW);
    expect(s.orders).toEqual({ before: "2026-05-01T00:00:00.000Z", offset: 3 });
    expect(s.questions).toBeNull();
    expect(s.claims).toEqual({ offset: 40 });
    expect(s.packs).toBe(12);
    expect(s.abandoned).toEqual(["questions"]);
    expect(s.started_at).toBe(saved.started_at);
  });

  it("se marca completa sólo cuando no queda ninguna fase", () => {
    const s = { ...initialBackfillState(NOW), orders: null, questions: null };
    expect(finishIfDone(s, NOW).completed_at).toBeNull();
    const done = finishIfDone({ ...s, claims: null }, NOW);
    expect(done.completed_at).toBe(new Date(NOW).toISOString());
  });

  it("abandona una fase tras demasiados fallos seguidos y lo deja anotado", () => {
    let s = initialBackfillState(NOW);
    for (let i = 0; i < MAX_PHASE_FAILURES - 1; i++) {
      s = recordPhaseFailure(s, "questions", "HTTP 500");
    }
    expect(s.questions).toEqual({ offset: 0 });
    expect(s.last_error).toBe("questions: HTTP 500");

    // Un éxito en el medio reinicia la cuenta.
    expect(recordPhaseSuccess(s, "questions").fails.questions).toBe(0);

    s = recordPhaseFailure(s, "questions", "HTTP 500");
    expect(s.questions).toBeNull();
    expect(s.abandoned).toEqual(["questions"]);
    expect(finishIfDone({ ...s, orders: null, claims: null }, NOW).completed_at).not.toBeNull();
  });
});

describe("cursor de pedidos", () => {
  const cursor = { before: "2026-09-20T10:00:00.000Z", offset: 0 };

  it("avanza a la fecha del pedido más viejo consumido", () => {
    expect(
      nextOrdersCursor(cursor, [
        "2026-09-20T09:00:00.000-03:00",
        "2026-09-19T08:30:00.000-03:00",
      ]),
    ).toEqual({ before: "2026-09-19T11:30:00.000Z", offset: 0 });
  });

  it("no se queda en la misma página si todo comparte la fecha del cursor", () => {
    const same = Array(50).fill("2026-09-20T10:00:00.000Z");
    const next = nextOrdersCursor(cursor, same);
    expect(next).toEqual({ before: cursor.before, offset: 50 });
    expect(nextOrdersCursor(next, same.slice(0, 10))).toEqual({
      before: cursor.before,
      offset: 60,
    });
  });

  it("sin nada consumido no se mueve", () => {
    expect(nextOrdersCursor(cursor, [])).toEqual(cursor);
  });

  it("ignora fechas ilegibles o más nuevas que el cursor", () => {
    expect(nextOrdersCursor(cursor, ["", "2026-09-21T00:00:00.000Z"])).toEqual({
      before: cursor.before,
      offset: 2,
    });
  });

  it("formatea la fecha como la aceptan los filtros de Mercado Libre", () => {
    expect(mlSearchDate(Date.parse("2025-09-26T12:00:00.000Z"))).toBe(
      "2025-09-26T12:00:00.000-00:00",
    );
  });
});

describe("paginación por offset", () => {
  const base = { offset: 100, limit: 50, maxOffset: 1000 };

  it("sigue con la página siguiente cuando la actual vino llena", () => {
    expect(nextSearchOffset({ ...base, consumed: 50, pageLength: 50, total: 400 })).toBe(150);
  });

  it("retoma a mitad de página si la corrida se cortó", () => {
    expect(nextSearchOffset({ ...base, consumed: 7, pageLength: 50, total: 400 })).toBe(107);
  });

  it("termina con una página incompleta o vacía", () => {
    expect(nextSearchOffset({ ...base, consumed: 20, pageLength: 20, total: 400 })).toBeNull();
    expect(nextSearchOffset({ ...base, consumed: 0, pageLength: 0 })).toBeNull();
  });

  it("termina al alcanzar el total", () => {
    expect(nextSearchOffset({ ...base, consumed: 50, pageLength: 50, total: 150 })).toBeNull();
  });

  it("termina al pasar el tope de offset que admite la API", () => {
    expect(
      nextSearchOffset({ ...base, offset: 1000, consumed: 50, pageLength: 50, total: 5000 }),
    ).toBeNull();
    expect(
      nextSearchOffset({ ...base, offset: 950, consumed: 50, pageLength: 50, total: 5000 }),
    ).toBe(1000);
  });

  it("termina al llegar al horizonte aunque la página no se haya consumido entera", () => {
    expect(
      nextSearchOffset({ ...base, consumed: 12, pageLength: 50, total: 400, reachedHorizon: true }),
    ).toBeNull();
  });

  it("un total ausente no corta la paginación", () => {
    expect(nextSearchOffset({ ...base, consumed: 50, pageLength: 50 })).toBe(150);
  });
});

describe("cómo entra lo importado", () => {
  const ev = (receivedAt: string, outbound = false): InboundEvent =>
    ({
      channel: "mercadolibre",
      externalContactId: "buyer",
      externalMessageId: receivedAt,
      text: "hola",
      receivedAt,
      outbound,
    }) as InboundEvent;

  it("lo viejo o contestado es historia; lo reciente sin contestar, pendiente", () => {
    const recent = new Date(NOW - 2 * DAY).toISOString();
    const old = new Date(NOW - 30 * DAY).toISOString();
    expect(historyFlags(old, false, NOW)).toEqual({ historical: true });
    expect(historyFlags(recent, true, NOW)).toEqual({ historical: true });
    expect(historyFlags(recent, false, NOW)).toEqual({ suppressAutoReply: true });
    // Una fecha ilegible cae del lado seguro: historia, sin agente.
    expect(historyFlags("", false, NOW)).toEqual({ historical: true });
  });

  it("en un hilo, lo anterior a la última respuesta del vendedor ya está contestado", () => {
    const events = markPackHistory(
      [
        ev(new Date(NOW - 3 * DAY).toISOString()),
        ev(new Date(NOW - 2 * DAY).toISOString(), true),
        ev(new Date(NOW - DAY).toISOString()),
      ],
      NOW,
    );
    expect(events[0].historical).toBe(true);
    expect(events[1]).not.toHaveProperty("historical");
    expect(events[1].outbound).toBe(true);
    expect(events[2].historical).toBeUndefined();
    expect(events[2].suppressAutoReply).toBe(true);
  });
});
