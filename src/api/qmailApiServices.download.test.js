import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadMailAttachment } from "./qmailApiServices.js";

const EMAIL_ID = "00112233445566778899aabbccddeeff";

beforeEach(() => {
  const anchor = {
    style: {},
    click: vi.fn(),
  };
  globalThis.window = {
    URL: {
      createObjectURL: vi.fn(() => "blob:qmail-download"),
      revokeObjectURL: vi.fn(),
    },
  };
  globalThis.document = {
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    createElement: vi.fn(() => anchor),
  };
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
    callback();
    return 1;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

describe("downloadMailAttachment", () => {
  it("uses Chromium blob storage and reports completion", async () => {
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6, 7, 8]),
    ];
    const blob = new Blob(chunks, { type: "application/octet-stream" });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name) => {
          const normalized = name.toLowerCase();
          if (normalized === "content-length") return "8";
          if (normalized === "content-type") {
            return "application/octet-stream";
          }
          if (normalized === "content-disposition") {
            return 'attachment; filename="example.bin"';
          }
          return null;
        },
      },
      blob: vi.fn().mockResolvedValue(blob),
    });
    const onProgress = vi.fn();

    const result = await downloadMailAttachment(
      EMAIL_ID,
      12,
      "fallback.bin",
      { expectedBytes: 8, onProgress },
    );

    expect(result).toEqual({
      success: true,
      data: {
        filename: "example.bin",
        sizeBytes: "8",
        operationId: null,
      },
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      completedBytes: "8",
      totalBytes: "8",
      percentage: 100,
      done: true,
      operationId: null,
    });
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("reports a storage-full response without discarding server detail", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 507,
      json: async () => ({
        success: false,
        error: "OBJECT_BEGIN rejected by RAIDA 7 (status 230)",
        last_status: 230,
      }),
    });

    const result = await downloadMailAttachment(
      EMAIL_ID,
      12,
      "fallback.bin",
    );

    expect(result).toMatchObject({
      success: false,
      httpStatus: 507,
      transferError: {
        code: "storage_full",
        protocolStatus: 230,
      },
    });
    expect(result.transferError.detail).toContain("RAIDA 7");
  });
});
