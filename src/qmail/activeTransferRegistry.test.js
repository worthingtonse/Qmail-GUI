import { describe, expect, it } from "vitest";

import {
  ACTIVE_TRANSFER_STORAGE_KEY,
  clearActiveTransferRegistry,
  forgetActiveTransfer,
  readActiveTransferRegistry,
  rememberActiveTransfer,
} from "./activeTransferRegistry";

const OPERATION_ID = "00112233445566778899aabbccddeeff";

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

describe("activeTransferRegistry", () => {
  it("stores only the non-secret context needed to restore a display", () => {
    const storage = createStorage();

    rememberActiveTransfer(
      {
        operationId: OPERATION_ID.toUpperCase(),
        direction: "download",
        label: "archive.zip",
        emailId: "mail-123",
        attachmentId: 4,
        totalBytes: "25000000000",
        secret: "must-not-be-saved",
      },
      storage,
    );

    expect(readActiveTransferRegistry(storage)).toEqual([
      expect.objectContaining({
        operationId: OPERATION_ID,
        direction: "download",
        label: "archive.zip",
        emailId: "mail-123",
        attachmentId: "4",
        totalBytes: "25000000000",
      }),
    ]);
    expect(storage.getItem(ACTIVE_TRANSFER_STORAGE_KEY)).not.toContain(
      "must-not-be-saved",
    );
  });

  it("merges progress into an existing operation", () => {
    const storage = createStorage();
    rememberActiveTransfer(
      {
        operationId: OPERATION_ID,
        direction: "upload",
        label: "2 attachments",
        totalBytes: "1000",
      },
      storage,
    );
    rememberActiveTransfer(
      {
        operationId: OPERATION_ID,
        completedBytes: "600",
        state: "uploading",
      },
      storage,
    );

    expect(readActiveTransferRegistry(storage)[0]).toMatchObject({
      label: "2 attachments",
      totalBytes: "1000",
      completedBytes: "600",
      state: "uploading",
    });
  });

  it("removes one operation or clears the registry", () => {
    const storage = createStorage();
    rememberActiveTransfer({ operationId: OPERATION_ID }, storage);

    expect(forgetActiveTransfer(OPERATION_ID, storage)).toBe(true);
    expect(readActiveTransferRegistry(storage)).toEqual([]);

    rememberActiveTransfer({ operationId: OPERATION_ID }, storage);
    expect(clearActiveTransferRegistry(storage)).toBe(true);
    expect(storage.getItem(ACTIVE_TRANSFER_STORAGE_KEY)).toBeNull();
  });

  it("ignores malformed persisted records", () => {
    const storage = createStorage();
    storage.setItem(
      ACTIVE_TRANSFER_STORAGE_KEY,
      JSON.stringify([
        { operationId: "bad" },
        { operationId: OPERATION_ID, direction: "download" },
      ]),
    );

    expect(readActiveTransferRegistry(storage)).toHaveLength(1);
  });
});
