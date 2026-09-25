import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  legacyMercadoLibreApp,
  mercadoLibreAppFor,
  mirrorsMercadoLibreNotification,
} from "./apps";

const RIVERZ = { clientId: "111", clientSecret: "riverz-secret" };
const LEGACY = { clientId: "222", clientSecret: "legacy-secret" };

beforeEach(() => {
  vi.stubEnv("MERCADOLIBRE_CLIENT_ID", RIVERZ.clientId);
  vi.stubEnv("MERCADOLIBRE_CLIENT_SECRET", RIVERZ.clientSecret);
  vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_ID", "");
  vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function withLegacy() {
  vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_ID", LEGACY.clientId);
  vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_SECRET", LEGACY.clientSecret);
}

describe("mercadoLibreAppFor", () => {
  it("uses Riverz's app when there is no previous app", () => {
    expect(mercadoLibreAppFor(undefined)).toEqual(RIVERZ);
    expect(mercadoLibreAppFor(LEGACY.clientId)).toEqual(RIVERZ);
  });

  it("refreshes each connection with the app that authorized it", () => {
    withLegacy();
    expect(mercadoLibreAppFor(RIVERZ.clientId)).toEqual(RIVERZ);
    expect(mercadoLibreAppFor(LEGACY.clientId)).toEqual(LEGACY);
    expect(mercadoLibreAppFor(Number(LEGACY.clientId))).toEqual(LEGACY);
  });

  it("treats connections without app_id as authorized by the previous app", () => {
    withLegacy();
    expect(mercadoLibreAppFor(undefined)).toEqual(LEGACY);
    expect(mercadoLibreAppFor(null)).toEqual(LEGACY);
    expect(mercadoLibreAppFor("")).toEqual(LEGACY);
  });

  it("ignores a previous app without its secret", () => {
    vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_ID", LEGACY.clientId);
    expect(legacyMercadoLibreApp()).toBeNull();
    expect(mercadoLibreAppFor(undefined)).toEqual(RIVERZ);
  });
});

describe("mirrorsMercadoLibreNotification", () => {
  it("mirrors every notification while there is a single app", () => {
    expect(mirrorsMercadoLibreNotification(RIVERZ.clientId)).toBe(true);
  });

  it("never mirrors notifications addressed to Riverz's app", () => {
    withLegacy();
    expect(mirrorsMercadoLibreNotification(Number(RIVERZ.clientId))).toBe(false);
    expect(mirrorsMercadoLibreNotification(undefined)).toBe(false);
    expect(mirrorsMercadoLibreNotification(Number(LEGACY.clientId))).toBe(true);
  });

  it("recognizes app ids that JSON.parse rounds", () => {
    vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_ID", "9876543210987655");
    vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_SECRET", LEGACY.clientSecret);
    const note = JSON.parse('{"application_id": 9876543210987655}') as { application_id: number };
    expect(mirrorsMercadoLibreNotification(note.application_id)).toBe(true);
  });
});
