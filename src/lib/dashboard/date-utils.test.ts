import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOW_SHORT_MON_FIRST,
  bucketGranularity,
  dayKey,
  daysAgoStart,
  lastNDayKeys,
  mondayIndex,
  previousRange,
  rangeBucketKeys,
  rangeForPreset,
  startOfDay,
} from "./date-utils";

// America/Bogota is UTC-05:00 year-round (no DST), so midnight there is
// always 05:00:00Z on the same date. Using it keeps these expectations
// deterministic regardless of the machine the tests run on — and the whole
// point of the rewrite is that results no longer depend on the local clock.
const BOGOTA = "America/Bogota";

describe("startOfDay", () => {
  it("returns the UTC instant of midnight in the tz", () => {
    const out = startOfDay(BOGOTA, new Date("2026-05-18T13:45:22.000Z"));
    expect(out.toISOString()).toBe("2026-05-18T05:00:00.000Z");
  });

  it("uses the tz calendar day, not UTC's (pre-dawn UTC, prior day in Bogota)", () => {
    // 03:00Z on the 18th is 22:00 on the 17th in Bogota.
    const out = startOfDay(BOGOTA, new Date("2026-05-18T03:00:00.000Z"));
    expect(out.toISOString()).toBe("2026-05-17T05:00:00.000Z");
  });

  it("does not mutate the input", () => {
    const d = new Date("2026-05-18T13:45:22.500Z");
    const before = d.getTime();
    startOfDay(BOGOTA, d);
    expect(d.getTime()).toBe(before);
  });
});

describe("daysAgoStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:45:22.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns midnight (in tz) N days before today", () => {
    expect(daysAgoStart(BOGOTA, 3).toISOString()).toBe(
      "2026-05-15T05:00:00.000Z",
    );
  });

  it("daysAgoStart(0) is today at midnight in the tz", () => {
    expect(daysAgoStart(BOGOTA, 0).toISOString()).toBe(
      "2026-05-18T05:00:00.000Z",
    );
  });

  it("crosses month boundaries cleanly", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00.000Z"));
    expect(daysAgoStart(BOGOTA, 5).toISOString()).toBe(
      "2026-04-27T05:00:00.000Z",
    );
  });

  it("anchors 'today' to the tz, not UTC (late-night UTC is prior day in Bogota)", () => {
    // 02:00Z on the 18th is 21:00 on the 17th in Bogota → today = the 17th.
    vi.setSystemTime(new Date("2026-05-18T02:00:00.000Z"));
    expect(daysAgoStart(BOGOTA, 0).toISOString()).toBe(
      "2026-05-17T05:00:00.000Z",
    );
  });
});

describe("dayKey", () => {
  it("emits YYYY-MM-DD in the tz", () => {
    expect(dayKey(BOGOTA, "2026-12-31T23:00:00.000Z")).toBe("2026-12-31");
  });

  it("shifts the date when the tz crosses midnight", () => {
    // 02:00Z on Jan 10 is 21:00 Jan 9 in Bogota.
    expect(dayKey(BOGOTA, "2026-01-10T02:00:00.000Z")).toBe("2026-01-09");
  });

  it("accepts Date inputs", () => {
    expect(dayKey(BOGOTA, new Date("2026-09-05T17:00:00.000Z"))).toBe(
      "2026-09-05",
    );
  });

  it("handles positive-offset zones across midnight", () => {
    // Madrid is UTC+2 in summer (CEST): 23:30Z Jun 30 → 01:30 Jul 1.
    expect(dayKey("Europe/Madrid", "2026-06-30T23:30:00.000Z")).toBe(
      "2026-07-01",
    );
  });
});

describe("lastNDayKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T08:30:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns n consecutive chronological keys ending today", () => {
    expect(lastNDayKeys(BOGOTA, 3)).toEqual([
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
    ]);
  });

  it("returns just today for n=1", () => {
    expect(lastNDayKeys(BOGOTA, 1)).toEqual(["2026-05-18"]);
  });

  it("rolls back across a month boundary", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00.000Z"));
    expect(lastNDayKeys(BOGOTA, 4)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });

  it("uses the tz day for 'today'", () => {
    // 21:00 on the 17th in Bogota, even though UTC has ticked to the 18th.
    vi.setSystemTime(new Date("2026-05-18T02:00:00.000Z"));
    expect(lastNDayKeys(BOGOTA, 1)).toEqual(["2026-05-17"]);
  });
});

describe("mondayIndex", () => {
  it("maps Monday → 0 and Sunday → 6 (in tz)", () => {
    expect(mondayIndex(BOGOTA, new Date("2026-05-18T12:00:00.000Z"))).toBe(0); // Mon
    expect(mondayIndex(BOGOTA, new Date("2026-05-19T12:00:00.000Z"))).toBe(1); // Tue
    expect(mondayIndex(BOGOTA, new Date("2026-05-23T12:00:00.000Z"))).toBe(5); // Sat
    expect(mondayIndex(BOGOTA, new Date("2026-05-24T12:00:00.000Z"))).toBe(6); // Sun
  });

  it("respects the tz when the instant is near midnight", () => {
    // 02:00Z Mon the 18th is 21:00 Sun the 17th in Bogota.
    expect(mondayIndex(BOGOTA, new Date("2026-05-18T02:00:00.000Z"))).toBe(6);
  });

  it("aligns with DOW_SHORT_MON_FIRST labels", () => {
    expect(
      DOW_SHORT_MON_FIRST[
        mondayIndex(BOGOTA, new Date("2026-05-18T12:00:00.000Z"))
      ],
    ).toBe("Mon");
    expect(
      DOW_SHORT_MON_FIRST[
        mondayIndex(BOGOTA, new Date("2026-05-24T12:00:00.000Z"))
      ],
    ).toBe("Sun");
  });
});

describe("rangeForPreset", () => {
  // 2026-05-18T13:45:22Z = 08:45:22 in Bogota; today-midnight = 05:00:00Z.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:45:22.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("today = [tz-midnight, now)", () => {
    const r = rangeForPreset(BOGOTA, "today");
    expect(r.start.toISOString()).toBe("2026-05-18T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-18T13:45:22.000Z");
  });

  it("yesterday = full prior day [d-1 00:00, d 00:00)", () => {
    const r = rangeForPreset(BOGOTA, "yesterday");
    expect(r.start.toISOString()).toBe("2026-05-17T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-18T05:00:00.000Z");
  });

  it("7d = [6 days ago midnight, now)", () => {
    const r = rangeForPreset(BOGOTA, "7d");
    expect(r.start.toISOString()).toBe("2026-05-12T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-18T13:45:22.000Z");
  });

  it("30d = [29 days ago midnight, now)", () => {
    const r = rangeForPreset(BOGOTA, "30d");
    expect(r.start.toISOString()).toBe("2026-04-19T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-18T13:45:22.000Z");
  });

  it("custom spans whole days, end-day inclusive (exclusive midnight after)", () => {
    const r = rangeForPreset(BOGOTA, "custom", { start: "2026-05-01", end: "2026-05-10" });
    expect(r.start.toISOString()).toBe("2026-05-01T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-11T05:00:00.000Z");
  });

  it("custom normalises a reversed start/end", () => {
    const r = rangeForPreset(BOGOTA, "custom", { start: "2026-05-10", end: "2026-05-01" });
    expect(r.start.toISOString()).toBe("2026-05-01T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-11T05:00:00.000Z");
  });

  it("custom with missing dates falls back to 7d", () => {
    const r = rangeForPreset(BOGOTA, "custom", null);
    expect(r.start.toISOString()).toBe("2026-05-12T05:00:00.000Z");
  });
});

describe("previousRange", () => {
  it("abuts the current window with equal duration (no gap, no overlap)", () => {
    const range = {
      start: new Date("2026-05-12T05:00:00.000Z"),
      end: new Date("2026-05-18T13:45:22.000Z"),
    };
    const prev = previousRange(range);
    // prev.end === range.start exactly (abutting; boundary belongs to current
    // via .gte(start)/.lt(prevEnd)).
    expect(prev.end.toISOString()).toBe(range.start.toISOString());
    // Equal duration.
    expect(prev.end.getTime() - prev.start.getTime()).toBe(
      range.end.getTime() - range.start.getTime(),
    );
  });
});

describe("bucketGranularity", () => {
  const range = (h: number) => {
    const s = new Date("2026-05-10T00:00:00.000Z");
    return { start: s, end: new Date(s.getTime() + h * 3600_000) };
  };
  it("uses hourly for ≤ 2 days (today, yesterday, 1–2 day custom)", () => {
    expect(bucketGranularity(range(8))).toBe("hour"); // today-ish
    expect(bucketGranularity(range(24))).toBe("hour"); // yesterday
    expect(bucketGranularity(range(48))).toBe("hour"); // exactly 2 days
  });
  it("uses daily for 3+ days", () => {
    expect(bucketGranularity(range(72))).toBe("day");
    expect(bucketGranularity(range(7 * 24))).toBe("day");
  });
});

describe("rangeBucketKeys", () => {
  it("daily: one key per calendar day, end-day inclusive", () => {
    const range = {
      start: new Date("2026-05-12T05:00:00.000Z"), // May 12 00:00 Bogota
      end: new Date("2026-05-18T13:45:22.000Z"), // May 18 08:45 Bogota
    };
    expect(rangeBucketKeys(BOGOTA, range, "day")).toEqual([
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
    ]);
  });

  it("hourly: one key per hour of the day in tz", () => {
    const range = {
      start: new Date("2026-05-18T05:00:00.000Z"), // 00:00 Bogota
      end: new Date("2026-05-18T13:45:22.000Z"), // 08:45 Bogota
    };
    const keys = rangeBucketKeys(BOGOTA, range, "hour");
    expect(keys[0]).toBe("2026-05-18T00");
    expect(keys[keys.length - 1]).toBe("2026-05-18T08");
    expect(keys).toHaveLength(9); // hours 00..08
  });
});
