import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSentAttachmentMetadata,
  sanitizeReceiptAttachmentFiles,
} from "./qmailApiServices.js";

const EMAIL_ID = "00112233445566778899aabbccddeeff";

beforeEach(() => {
  globalThis.window = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.window;
  delete globalThis.fetch;
});

describe("sanitizeReceiptAttachmentFiles", () => {
  it("keeps only successful attachment-role entries and maps display fields", () => {
    const files = [
      { role: "body", source: "C:\\tmp\\body.cbdf", size_bytes: 900 },
      {
        role: "attachment",
        name: "report.pdf",
        source: "C:\\Docs\\report.pdf",
        size_bytes: 1234,
        status: "success",
      },
      {
        role: "attachment",
        source: "/home/user/failed.png",
        size_bytes: 50,
        status: "failed",
      },
      { role: "attachment", source: "/home/user/photo.jpg", size: 777 },
    ];

    const result = sanitizeReceiptAttachmentFiles(files);

    expect(result).toEqual([
      {
        attachmentId: "receipt-0",
        name: "report.pdf",
        fileExtension: "pdf",
        size: 1234,
        sourcePath: "C:\\Docs\\report.pdf",
        metadataOnly: true,
      },
      {
        attachmentId: "receipt-1",
        name: "photo.jpg",
        fileExtension: "jpg",
        size: 777,
        sourcePath: "/home/user/photo.jpg",
        metadataOnly: true,
      },
    ]);
  });

  it("returns an empty list for missing or non-array input", () => {
    expect(sanitizeReceiptAttachmentFiles(undefined)).toEqual([]);
    expect(sanitizeReceiptAttachmentFiles(null)).toEqual([]);
    expect(sanitizeReceiptAttachmentFiles({})).toEqual([]);
  });
});

describe("getSentAttachmentMetadata", () => {
  it("parses a wrapped receipt payload from the fetch fallback", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        receipt: {
          upload: {
            files: [
              {
                role: "attachment",
                name: "notes.txt",
                source: "C:\\Docs\\notes.txt",
                size_bytes: 42,
                status: "success",
              },
            ],
          },
        },
      }),
    });

    const result = await getSentAttachmentMetadata(EMAIL_ID);

    expect(result.success).toBe(true);
    expect(result.data.attachments).toHaveLength(1);
    expect(result.data.attachments[0]).toMatchObject({
      name: "notes.txt",
      size: 42,
      metadataOnly: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/qmail/receipts?guid=${EMAIL_ID}`),
    );
  });

  it("treats a missing receipt (404) as definitively empty", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const result = await getSentAttachmentMetadata(EMAIL_ID);

    expect(result).toEqual({ success: true, data: { attachments: [] } });
  });

  it("reports transport errors as retryable failures", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));

    const result = await getSentAttachmentMetadata(EMAIL_ID);

    expect(result.success).toBe(false);
  });

  it("prefers the sanitizing Electron main-process bridge when present", async () => {
    const bridged = {
      success: true,
      data: { attachments: [{ name: "a.txt", metadataOnly: true }] },
    };
    globalThis.window = {
      electronAPI: {
        getSentAttachmentMetadata: vi.fn().mockResolvedValue(bridged),
      },
    };
    globalThis.fetch = vi.fn();

    const result = await getSentAttachmentMetadata(EMAIL_ID);

    expect(result).toBe(bridged);
    expect(
      globalThis.window.electronAPI.getSentAttachmentMetadata,
    ).toHaveBeenCalledWith(expect.any(Number), EMAIL_ID);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
