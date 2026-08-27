import { describe, expect, it } from "vitest";

import {
  describeSendPhase,
  scaleSendProgress,
  readPhaseProgress,
} from "./composeSendProgress.js";

// Mirrors the poll loop's monotonic clamp so a whole send can be replayed.
const replay = (samples) => {
  let shown = 0;
  return samples.map(([message, progress]) => {
    const scaled = scaleSendProgress(progress, describeSendPhase(message));
    shown = scaled > shown ? scaled : shown;
    return shown;
  });
};

const STAGING = "Staging attachment stripes";
const UPLOADING = "Uploading object-transfer stripes";

describe("describeSendPhase", () => {
  it("maps the two core phase messages to short labels", () => {
    expect(describeSendPhase(STAGING)).toBe("Staging\u2026");
    expect(describeSendPhase(UPLOADING)).toBe("Uploading\u2026");
  });

  it("passes an unrecognized message through verbatim", () => {
    expect(describeSendPhase("Verifying receipts")).toBe("Verifying receipts");
  });

  it("falls back when the message is empty or absent", () => {
    expect(describeSendPhase("")).toBe("Processing...");
    expect(describeSendPhase(null)).toBe("Processing...");
  });
});

describe("scaleSendProgress", () => {
  it("puts staging in the lower half and uploading in the upper half", () => {
    expect(scaleSendProgress("0", "Staging\u2026")).toBe(0);
    expect(scaleSendProgress("90", "Staging\u2026")).toBe(45);
    expect(scaleSendProgress("5", "Uploading\u2026")).toBe(53);
    expect(scaleSendProgress("100", "Uploading\u2026")).toBe(100);
  });

  it("passes the raw value through for an unknown phase", () => {
    expect(scaleSendProgress("42", "Verifying receipts")).toBe(42);
  });

  it("clamps junk and out-of-range values into 0-100", () => {
    expect(scaleSendProgress("not-a-number", "Staging\u2026")).toBe(0);
    expect(scaleSendProgress("-5", "Staging\u2026")).toBe(0);
    expect(scaleSendProgress("150", "Uploading\u2026")).toBe(100);
  });
});

describe("send progress never moves backwards", () => {
  it("absorbs the staging->network reset core reports", () => {
    // Core reuses one 0-100 band per phase: staging climbs to ~90, then the
    // network phase restarts at ~5. The bar must still read as one sweep.
    const shown = replay([
      [STAGING, "0"],
      [STAGING, "30"],
      [STAGING, "90"],
      [UPLOADING, "5"],
      [UPLOADING, "40"],
      [UPLOADING, "100"],
    ]);

    expect(shown).toEqual([0, 15, 45, 53, 70, 100]);
    shown.forEach((value, i) => {
      if (i > 0) expect(value).toBeGreaterThanOrEqual(shown[i - 1]);
    });
  });

  it("holds steady through a coarse commit-count plateau", () => {
    // Network progress advances by per-server COMMIT count, so it can repeat
    // the same value for minutes on a large stripe.
    expect(replay([
      [UPLOADING, "40"],
      [UPLOADING, "40"],
      [UPLOADING, "40"],
    ])).toEqual([70, 70, 70]);
  });

  it("does not regress when the phase message is unrecognized mid-send", () => {
    // An unknown message yields the raw value; the clamp must absorb it.
    expect(replay([
      [UPLOADING, "80"],
      ["Verifying receipts", "3"],
      [UPLOADING, "90"],
    ])).toEqual([90, 90, 95]);
  });
});

describe("readPhaseProgress", () => {
  const task = (data) => ({ result: data });

  it("parses the uploading phase with per-server rows", () => {
    const p = readPhaseProgress(
      task({
        phase: "uploading",
        stage_percent: 100,
        upload_percent: 13,
        file_index: 2,
        file_count: 3,
        servers: [
          {
            raida_id: 11,
            percent: 13,
            completed_bytes: "17825792",
            total_bytes: "134217728",
            retries: 0,
            state: "uploading",
            ok: false,
          },
        ],
      }),
    );

    expect(p.phase).toBe("uploading");
    expect(p.uploadPercent).toBe(13);
    expect(p.servers).toHaveLength(1);
    expect(p.servers[0].raidaId).toBe(11);
    // Byte counts stay STRINGS so a 160 GB count cannot lose precision.
    expect(p.servers[0].completedBytes).toBe("17825792");
    expect(p.servers[0].totalBytes).toBe("134217728");
  });

  it("keeps byte counts exact past Number.MAX_SAFE_INTEGER", () => {
    const p = readPhaseProgress(
      task({
        phase: "uploading",
        servers: [
          {
            raida_id: 0,
            percent: 50,
            completed_bytes: "9007199254740993",
            total_bytes: "18014398509481986",
            retries: 0,
            state: "uploading",
            ok: false,
          },
        ],
      }),
    );

    expect(p.servers[0].completedBytes).toBe("9007199254740993");
    expect(BigInt(p.servers[0].totalBytes)).toBe(18014398509481986n);
  });

  it("returns null when the backend omits the payload", () => {
    // Older core: the UI falls back to the single combined bar.
    expect(readPhaseProgress(task(null))).toBeNull();
    expect(readPhaseProgress(task({ some: "other" }))).toBeNull();
    expect(readPhaseProgress({})).toBeNull();
  });

  it("clamps out-of-range percentages and tolerates a missing array", () => {
    const p = readPhaseProgress(
      task({ phase: "staging", stage_percent: 140, upload_percent: -5 }),
    );
    expect(p.stagePercent).toBe(100);
    expect(p.uploadPercent).toBe(0);
    expect(p.servers).toEqual([]);
  });
});
