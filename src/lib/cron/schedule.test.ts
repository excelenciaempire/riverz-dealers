import { describe, expect, it } from "vitest";

import {
  dueJobs,
  expectedIntervalMs,
  isDue,
  isStale,
  SCHEDULED_JOBS,
} from "./schedule";

/** Fecha UTC a partir de sus partes, para no depender de la zona local. */
function utc(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));
}

describe("isDue", () => {
  it("dispara cada minuto con '* * * * *'", () => {
    expect(isDue("* * * * *", utc(2026, 8, 3, 14, 37))).toBe(true);
    expect(isDue("* * * * *", utc(2026, 8, 3, 0, 0))).toBe(true);
  });

  it("respeta los pasos '*/n' en los minutos", () => {
    expect(isDue("*/10 * * * *", utc(2026, 8, 3, 14, 0))).toBe(true);
    expect(isDue("*/10 * * * *", utc(2026, 8, 3, 14, 30))).toBe(true);
    expect(isDue("*/10 * * * *", utc(2026, 8, 3, 14, 31))).toBe(false);
    expect(isDue("*/2 * * * *", utc(2026, 8, 3, 14, 13))).toBe(false);
  });

  it("respeta minuto fijo con hora libre", () => {
    expect(isDue("30 * * * *", utc(2026, 8, 3, 9, 30))).toBe(true);
    expect(isDue("30 * * * *", utc(2026, 8, 3, 9, 29))).toBe(false);
  });

  it("respeta los pasos de hora", () => {
    expect(isDue("0 */6 * * *", utc(2026, 8, 3, 0, 0))).toBe(true);
    expect(isDue("0 */6 * * *", utc(2026, 8, 3, 6, 0))).toBe(true);
    expect(isDue("0 */6 * * *", utc(2026, 8, 3, 7, 0))).toBe(false);
    expect(isDue("0 */12 * * *", utc(2026, 8, 3, 12, 0))).toBe(true);
  });

  it("dispara los diarios sólo en su hora", () => {
    expect(isDue("0 3 * * *", utc(2026, 8, 3, 3, 0))).toBe(true);
    expect(isDue("0 3 * * *", utc(2026, 8, 3, 3, 1))).toBe(false);
    expect(isDue("0 14 * * *", utc(2026, 8, 3, 14, 0))).toBe(true);
    expect(isDue("0 14 * * *", utc(2026, 8, 3, 15, 0))).toBe(false);
  });

  it("evalúa en UTC y no en la zona local", () => {
    // "0 3" es a las 3 UTC, no a las 3 de ningún huso local: las 03:00 de
    // Buenos Aires son las 06:00 UTC y no le tocan.
    expect(isDue("0 3 * * *", new Date("2026-08-03T03:00:00Z"))).toBe(true);
    expect(isDue("0 3 * * *", new Date("2026-08-03T03:00:00-03:00"))).toBe(false);
    expect(isDue("0 6 * * *", new Date("2026-08-03T03:00:00-03:00"))).toBe(true);
  });

  it("entiende listas y rangos", () => {
    expect(isDue("0,30 * * * *", utc(2026, 8, 3, 9, 30))).toBe(true);
    expect(isDue("0,30 * * * *", utc(2026, 8, 3, 9, 15))).toBe(false);
    expect(isDue("0 9-17 * * *", utc(2026, 8, 3, 12, 0))).toBe(true);
    expect(isDue("0 9-17 * * *", utc(2026, 8, 3, 18, 0))).toBe(false);
  });

  it("combina día-del-mes y día-de-semana con OR", () => {
    // 2026-08-03 cae lunes (dow 1).
    expect(isDue("0 0 1 * 1", utc(2026, 8, 3, 0, 0))).toBe(true); // por dow
    expect(isDue("0 0 3 * 5", utc(2026, 8, 3, 0, 0))).toBe(true); // por dom
    expect(isDue("0 0 4 * 5", utc(2026, 8, 3, 0, 0))).toBe(false);
  });

  it("acepta 7 como domingo", () => {
    // 2026-08-02 cae domingo.
    expect(isDue("0 0 * * 7", utc(2026, 8, 2, 0, 0))).toBe(true);
    expect(isDue("0 0 * * 0", utc(2026, 8, 2, 0, 0))).toBe(true);
  });

  it("rechaza expresiones inválidas en vez de dispararlas", () => {
    expect(isDue("* * * *", utc(2026, 8, 3, 0, 0))).toBe(false);
    expect(isDue("", utc(2026, 8, 3, 0, 0))).toBe(false);
    expect(isDue("*/0 * * * *", utc(2026, 8, 3, 0, 0))).toBe(false);
    expect(isDue("abc * * * *", utc(2026, 8, 3, 0, 0))).toBe(false);
    expect(isDue("70 * * * *", utc(2026, 8, 3, 0, 0))).toBe(false);
  });
});

describe("SCHEDULED_JOBS", () => {
  it("no repite nombres, ni rutas entre los que dispara el reloj", () => {
    const names = SCHEDULED_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);

    // Las rutas sólo tienen que ser únicas entre los trabajos que dispara el
    // reloj: dos apuntando al mismo endpoint serían la misma corrida dos veces.
    // Un sub-trabajo COMPARTE la ruta de su padre a propósito — es el mismo
    // handler, con su propio ritmo interno y su propio nombre en `cron_runs`.
    const disparados = SCHEDULED_JOBS.filter((j) => !j.parent).map((j) => j.path);
    expect(new Set(disparados).size).toBe(disparados.length);
  });

  it("cada sub-trabajo apunta a un padre que existe", () => {
    const names = new Set(SCHEDULED_JOBS.map((j) => j.name));
    for (const job of SCHEDULED_JOBS) {
      if (job.parent) expect(names.has(job.parent)).toBe(true);
    }
  });

  it("el reloj no dispara sub-trabajos", () => {
    // Si los disparara, correrían dos veces: una por su padre y otra por acá.
    const subs = new Set(
      SCHEDULED_JOBS.filter((j) => j.parent).map((j) => j.name),
    );
    for (let m = 0; m < 60; m++) {
      for (const job of dueJobs(utc(2026, 8, 3, 0, m))) {
        expect(subs.has(job.name)).toBe(false);
      }
    }
  });

  it("todo trabajo declara qué hace, con una clave i18n del panel", () => {
    for (const job of SCHEDULED_JOBS) {
      expect(job.whatKey).toMatch(/^admin\./);
    }
  });

  it("todo trabajo se puede marcar atrasado", () => {
    // La regresión que esto fija: en el catálogo viejo del panel había tres
    // trabajos con `schedule: null`, y sin schedule no hay intervalo esperado,
    // así que `isStale` devolvía false SIEMPRE. Se podían morir en silencio.
    for (const job of SCHEDULED_JOBS) {
      expect(expectedIntervalMs(job.schedule)).toBeGreaterThan(0);
      expect(isStale(job.schedule, null)).toBe(true);
    }
  });
});

describe("isStale", () => {
  const ahora = Date.UTC(2026, 7, 15, 12, 0);

  it("da margen de tres intervalos antes de gritar", () => {
    const hace2min = new Date(ahora - 2 * 60_000).toISOString();
    const hace10min = new Date(ahora - 10 * 60_000).toISOString();
    expect(isStale("* * * * *", hace2min, ahora)).toBe(false);
    expect(isStale("* * * * *", hace10min, ahora)).toBe(true);
  });

  it("sin ninguna corrida está atrasado, no sano", () => {
    expect(isStale("0 3 * * *", null, ahora)).toBe(true);
  });

  it("un trabajo diario tolera más de un día", () => {
    const ayer = new Date(ahora - 25 * 3_600_000).toISOString();
    expect(isStale("0 3 * * *", ayer, ahora)).toBe(false);
  });

  it("todos los horarios son expresiones que el matcher entiende", () => {
    // Un horario que no se entiende nunca dispararía: se verifica que cada
    // trabajo tenga al menos un minuto de la hora en el que le toque.
    for (const job of SCHEDULED_JOBS) {
      const fires = Array.from({ length: 60 }, (_, m) =>
        isDue(job.schedule, utc(2026, 8, 3, 0, m)),
      ).some(Boolean);
      const firesLaterInTheDay = Array.from({ length: 24 }, (_, h) =>
        Array.from({ length: 60 }, (_, m) => isDue(job.schedule, utc(2026, 8, 3, h, m))).some(
          Boolean,
        ),
      ).some(Boolean);
      expect(fires || firesLaterInTheDay, `${job.name} nunca dispara`).toBe(true);
    }
  });

  it("el backfill de DMs corre por tramos, sin apilarse", () => {
    // Barría todos los contactos de una vez (~22 min medidos en prod el
    // 2026-08-04) y con schedule horario se apilaba encima de sí mismo. Ahora
    // el handler procesa un lote fijo por conexión y guarda cursor, así que
    // puede correr seguido — pero nunca tan seguido como para pisarse: el
    // techo de reloj del handler es de 8 min.
    const backfill = SCHEDULED_JOBS.find((j) => j.name === "meta-dm-backfill");
    expect(backfill).toBeDefined();
    const veces = Array.from({ length: 24 }, (_, h) =>
      Array.from({ length: 60 }, (_, m) => isDue(backfill!.schedule, utc(2026, 8, 3, h, m))),
    )
      .flat()
      .filter(Boolean).length;
    expect(veces).toBeGreaterThan(1);
    expect(veces).toBeLessThanOrEqual(24);
    // Holgura sobre el techo de 8 min del handler: tiene que poder terminar y
    // dejar su fila en cron_runs en vez de que el reloj le corte el fetch.
    expect(backfill!.timeoutMs).toBeGreaterThan(8 * 60 * 1000);
  });

  it("la conciliación de comentarios termina antes de su siguiente ventana", () => {
    const comments = SCHEDULED_JOBS.find((j) => j.name === "comment-sync");
    expect(comments?.timeoutMs).toBe(8 * 60_000);
    expect(comments?.timeoutMs).toBeLessThan(expectedIntervalMs(comments!.schedule)!);
  });

  it("todo trabajo que el reloj llama cuelga de /api", () => {
    for (const job of SCHEDULED_JOBS) {
      // `voice-worker` no tiene ruta a propósito: es un proceso de otro
      // servicio que late contra /api/internal/voice/heartbeat, y está en el
      // catálogo sólo para tener umbral de atraso y aparecer en el panel. El
      // reloj no lo llama nunca (lo filtra `parent`), así que exigirle una ruta
      // era pedirle una puerta a algo que no se abre desde acá.
      if (!job.path) {
        expect(job.parent, `${job.name}: sin ruta y sin padre`).toBeTruthy();
        continue;
      }
      expect(job.path.startsWith("/api/"), `${job.name}: ${job.path}`).toBe(true);
    }
  });

  it("dueJobs nunca devuelve un trabajo sin ruta", () => {
    // La red de contención de lo de arriba: si alguien le saca el `parent` a
    // una fila sin ruta, el reloj intentaría hacer fetch("") cada minuto.
    for (let h = 0; h < 24; h++) {
      for (const job of dueJobs(utc(2026, 8, 3, h, 0))) {
        expect(job.path, `${job.name} sale sin ruta`).toBeTruthy();
      }
    }
  });
});

describe("dueJobs", () => {
  it("a medianoche en punto trae los de cada minuto y los horarios", () => {
    const names = dueJobs(utc(2026, 8, 3, 0, 0)).map((j) => j.name);
    expect(names).toContain("flows-resume");
    expect(names).toContain("broadcasts");
    expect(names).toContain("shopify-cart-recovery");
    expect(names).not.toContain("shopify-feedback"); // corre en el minuto 30
  });

  it("en un minuto impar sólo trae los de cada minuto", () => {
    const names = dueJobs(utc(2026, 8, 3, 10, 7)).map((j) => j.name);
    expect(names).toContain("flows-resume");
    expect(names).not.toContain("instagram-agent"); // */2
    expect(names).not.toContain("comment-sync"); // */10
  });
});
