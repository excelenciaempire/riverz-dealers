import { describe, expect, it } from "vitest";

import { dueJobs, isDue, SCHEDULED_JOBS } from "./schedule";

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
  it("no repite nombres ni rutas", () => {
    const names = SCHEDULED_JOBS.map((j) => j.name);
    const paths = SCHEDULED_JOBS.map((j) => j.path);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(paths).size).toBe(paths.length);
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

  it("las rutas cuelgan de /api", () => {
    for (const job of SCHEDULED_JOBS) {
      expect(job.path.startsWith("/api/"), `${job.name}: ${job.path}`).toBe(true);
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
