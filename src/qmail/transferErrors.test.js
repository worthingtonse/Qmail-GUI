import { describe, expect, it } from "vitest";

import {
  formatTransferErrorNotification,
  normalizeTransferError,
} from "./transferErrors";

describe("normalizeTransferError", () => {
  it("recognizes a payment-required status in a parent task message", () => {
    expect(
      normalizeTransferError({
        state: "failed",
        message: "Object Transfer upload failed (status 169)",
      }),
    ).toMatchObject({
      code: "payment_required",
      protocolStatus: 169,
      canRetry: false,
    });
  });

  it("reports object and quota capacity failures", () => {
    expect(
      normalizeTransferError({
        state: "failed",
        last_status: 220,
        error: "OBJECT_BEGIN rejected by RAIDA 3 (status 220)",
      }),
    ).toMatchObject({
      code: "capacity",
      protocolStatus: 220,
      canResume: false,
      canRetry: false,
    });

    expect(
      normalizeTransferError({
        state: "failed",
        last_status: 227,
      }),
    ).toMatchObject({
      code: "capacity",
      protocolStatus: 227,
    });
  });

  it("reports storage-full and generation-conflict statuses", () => {
    expect(
      normalizeTransferError({
        state: "failed",
        last_status: 230,
      }),
    ).toMatchObject({
      code: "storage_full",
      title: "Server storage is full",
      protocolStatus: 230,
    });

    expect(
      normalizeTransferError({
        state: "failed",
        last_status: 233,
      }),
    ).toMatchObject({
      code: "generation_conflict",
      title: "Message version changed",
      protocolStatus: 233,
    });
  });

  it("extracts a protocol status from the server task message", () => {
    const result = normalizeTransferError({
      state: "failed",
      message: "OBJECT_BEGIN rejected by RAIDA 12 (status 230)",
    });

    expect(result).toMatchObject({
      code: "storage_full",
      protocolStatus: 230,
    });
    expect(result.detail).toContain("RAIDA 12");
  });

  it("preserves an unknown terminal transfer error", () => {
    const result = normalizeTransferError({
      state: "failed",
      error: "Temporary file could not be renamed",
    });

    expect(result).toMatchObject({
      code: "terminal_transfer_error",
      title: "Transfer failed",
      message: "Temporary file could not be renamed",
      terminal: true,
      canResume: false,
    });
  });

  it("marks retryable server statuses as resumable", () => {
    expect(
      normalizeTransferError({
        state: "paused",
        last_status: 253,
      }),
    ).toMatchObject({
      code: "network_error",
      retryable: true,
      canResume: true,
      terminal: false,
    });
  });
});

describe("formatTransferErrorNotification", () => {
  it("includes the specific title and action", () => {
    const transferError = normalizeTransferError({
      state: "failed",
      last_status: 233,
    });

    expect(formatTransferErrorNotification(transferError)).toContain(
      "Message version changed:",
    );
  });
});
