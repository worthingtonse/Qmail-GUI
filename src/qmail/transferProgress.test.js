import { describe, expect, it } from "vitest";

import {
  calculateBytePercentage,
  deriveUploadByteProgress,
  extractTransferOperationIds,
  extractTransferState,
  formatByteCount,
  formatByteProgress,
  normalizeByteCount,
} from "./transferProgress.js";

describe("transfer progress formatting", () => {
  it("preserves byte counts above Number.MAX_SAFE_INTEGER", () => {
    expect(normalizeByteCount("18446744073709551615")).toBe(
      18446744073709551615n,
    );
    expect(formatByteCount("18446744073709551615")).toBe("15.9 EB");
  });

  it("formats byte and percentage progress", () => {
    expect(
      formatByteProgress({
        completedBytes: "524288",
        totalBytes: "1048576",
      }),
    ).toBe("512 KB / 1 MB (50%)");
    expect(calculateBytePercentage("1", "3")).toBe(33.3);
  });

  it("prefers exact transfer byte fields from task data", () => {
    expect(
      deriveUploadByteProgress(
        {
          progress: 20,
          result: {
            completed_bytes: "12500000000",
            total_bytes: "25000000000",
          },
        },
        10,
      ),
    ).toEqual({
      completedBytes: "12500000000",
      totalBytes: "25000000000",
      percentage: 50,
      estimated: false,
    });
  });

  it("derives an estimated upload count from the orchestration phase", () => {
    expect(
      deriveUploadByteProgress({ progress: 47.5 }, 1048576),
    ).toEqual({
      completedBytes: "524288",
      totalBytes: "1048576",
      percentage: 50,
      estimated: true,
    });
  });

  it("extracts unique operation IDs from nested task data", () => {
    expect(
      extractTransferOperationIds({
        operation_id: "00112233445566778899AABBCCDDEEFF",
        result: {
          operation_ids: [
            "00112233445566778899aabbccddeeff",
            "ffeeddccbbaa99887766554433221100",
          ],
        },
      }),
    ).toEqual([
      "00112233445566778899aabbccddeeff",
      "ffeeddccbbaa99887766554433221100",
    ]);
    expect(extractTransferState({ result: { state: "Paused" } })).toBe(
      "paused",
    );
  });
});
