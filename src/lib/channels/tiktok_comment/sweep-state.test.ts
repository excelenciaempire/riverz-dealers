import { describe, expect, it } from "vitest";
import { nextDeepSweepState, readDeepSweepState } from "./sweep-state";

// Ids reales de TikTok: números de 19 cifras. Importa para el orden de las
// claves del objeto (los ids chicos se ordenarían como índices).
const V1 = "7400000000000000001";
const V2 = "7400000000000000002";
const V3 = "7400000000000000003";

describe("estado del barrido profundo de TikTok", () => {
  it("lee lo guardado y descarta lo que no es un cursor", () => {
    expect(readDeepSweepState(undefined)).toEqual({ video_cursor: null, comment_cursors: {} });
    expect(
      readDeepSweepState({
        video_cursor: 1726000000,
        comment_cursors: { [V1]: "abc", [V2]: "", [V3]: null },
      }),
    ).toEqual({ video_cursor: 1726000000, comment_cursors: { [V1]: "abc" } });
    expect(readDeepSweepState({ video_cursor: Number.NaN }).video_cursor).toBeNull();
  });

  it("guarda dónde sigue cada video y olvida los que se terminaron de leer", () => {
    const prev = { video_cursor: null, comment_cursors: { [V1]: 10, [V2]: 20 } };
    const next = nextDeepSweepState(prev, {
      videoCursor: 15,
      comments: [
        { videoId: V1, next: null },
        { videoId: V3, next: 40 },
      ],
    });
    expect(next).toEqual({ video_cursor: 15, comment_cursors: { [V2]: 20, [V3]: 40 } });
  });

  it("un video que falló conserva su cursor para reintentar desde el mismo punto", () => {
    const prev = { video_cursor: 5, comment_cursors: { [V1]: 10 } };
    // V1 no viene en la lista: falló en esta corrida.
    const next = nextDeepSweepState(prev, { videoCursor: null, comments: [] });
    expect(next).toEqual({ video_cursor: null, comment_cursors: { [V1]: 10 } });
  });

  it("poda los cursores más viejos para que config no crezca sin fin", () => {
    const prev = { video_cursor: null, comment_cursors: { [V1]: 1, [V2]: 2 } };
    const next = nextDeepSweepState(prev, { videoCursor: null, comments: [{ videoId: V3, next: 3 }] }, 2);
    expect(next.comment_cursors).toEqual({ [V2]: 2, [V3]: 3 });
  });
});
