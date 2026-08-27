import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getQMailObjectCapabilities } from "./qmailApiServices.js";

const response = (body, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("getQMailObjectCapabilities", () => {
  it("keeps a 160 GiB limit exact as a BigInt", async () => {
    // 160 GiB = 171798691840, plus a value past MAX_SAFE_INTEGER to prove
    // the parse never routes through Number().
    globalThis.fetch.mockReturnValueOnce(
      response({
        max_object_bytes: "171798691840",
        max_chunk_bytes: "9007199254740993",
        max_active_transfers: 4,
      }),
    );

    const result = await getQMailObjectCapabilities();

    expect(result.success).toBe(true);
    expect(result.data.maxObjectBytes).toBe(171798691840n);
    // Would round to ...992 if it had passed through a JS number.
    expect(result.data.maxChunkBytes).toBe(9007199254740993n);
    expect(result.data.maxActiveTransfers).toBe(4);
  });

  it("parses storage classes and their byte counts", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response({
        max_object_bytes: "171798691840",
        storage_classes: [
          {
            class_id: 1,
            max_object_bytes: "171798691840",
            capacity_bytes: "400000000000",
            available_bytes: "350000000000",
            max_retention_seconds: 31536000,
          },
        ],
      }),
    );

    const result = await getQMailObjectCapabilities();

    expect(result.success).toBe(true);
    expect(result.data.storageClasses).toHaveLength(1);
    expect(result.data.storageClasses[0].availableBytes).toBe(350000000000n);
    expect(result.data.storageClasses[0].maxRetentionSeconds).toBe(31536000);
  });

  it("reports failure without throwing when the endpoint is absent", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response({ error: true, message: "Method not allowed" }, 405),
    );

    const result = await getQMailObjectCapabilities();

    // Callers treat this as "proceed anyway" - core enforces the real cap.
    expect(result.success).toBe(false);
    expect(result.error).toBe("Method not allowed");
  });

  it("yields null for missing or unparseable byte fields", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response({ max_object_bytes: "", max_chunk_bytes: "not-a-number" }),
    );

    const result = await getQMailObjectCapabilities();

    expect(result.success).toBe(true);
    expect(result.data.maxObjectBytes).toBeNull();
    expect(result.data.maxChunkBytes).toBeNull();
    expect(result.data.storageClasses).toEqual([]);
  });
});
