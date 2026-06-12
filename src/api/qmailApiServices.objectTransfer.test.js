import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelObjectTransfer,
  getObjectTransferStatus,
  pollObjectTransferStatus,
  resumeObjectTransfer,
} from "./qmailApiServices.js";

const OPERATION_ID = "00112233445566778899aabbccddeeff";

const response = (body, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });

const transferStatus = (overrides = {}) => ({
  success: true,
  operation_id: OPERATION_ID,
  task_id: "task-123",
  direction: "upload",
  state: "uploading",
  transfer_id: "ffeeddccbbaa99887766554433221100",
  object_id: "0123456789abcdef0123456789abcdef",
  generation: "18446744073709551614",
  target_generation: "18446744073709551615",
  total_bytes: "25000000000",
  completed_bytes: "12500000000",
  progress: 50,
  chunk_bytes: 1048576,
  max_parallel: 4,
  expires_at: "18446744073709551615",
  cancel_requested: false,
  ...overrides,
});

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getObjectTransferStatus", () => {
  it("calls the status endpoint and preserves uint64 values as strings", async () => {
    globalThis.fetch.mockReturnValueOnce(response(transferStatus()));

    const result = await getObjectTransferStatus(OPERATION_ID);

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://localhost:8080/api/qmail/net/object-transfers/status?operation_id=${OPERATION_ID}`,
      { signal: undefined, headers: {} },
    );
    expect(result.data).toMatchObject({
      operationId: OPERATION_ID,
      taskId: "task-123",
      state: "uploading",
      totalBytes: "25000000000",
      completedBytes: "12500000000",
      generation: "18446744073709551614",
      targetGeneration: "18446744073709551615",
      expiresAt: "18446744073709551615",
      progress: 50,
      isFinished: false,
      isSuccessful: false,
    });
  });

  it("rejects malformed operation IDs without issuing a request", async () => {
    const result = await getObjectTransferStatus("not-an-operation-id");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/32-character hexadecimal/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reports storage-full status with an actionable structured error", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response(
        transferStatus({
          state: "failed",
          last_status: 230,
          last_result: 1,
          error: "OBJECT_BEGIN rejected by RAIDA 4 (status 230)",
        }),
      ),
    );

    const result = await getObjectTransferStatus(OPERATION_ID);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      state: "failed",
      lastStatus: 230,
      lastResult: 1,
      error:
        "The server does not have enough free storage for this transfer. Retry later or use another server.",
      transferError: {
        code: "storage_full",
        title: "Server storage is full",
        protocolStatus: 230,
        canResume: false,
      },
    });
    expect(result.data.transferError.detail).toContain("RAIDA 4");
  });

  it("reports generation conflicts as terminal transfer errors", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response(
        transferStatus({
          state: "failed",
          last_status: 233,
          error: "OBJECT_COMMIT rejected by RAIDA 8 (status 233)",
        }),
      ),
    );

    const result = await getObjectTransferStatus(OPERATION_ID);

    expect(result.data.transferError).toMatchObject({
      code: "generation_conflict",
      protocolStatus: 233,
      terminal: true,
      canResume: false,
    });
  });
});

describe("pollObjectTransferStatus", () => {
  it("reports updates until the transfer completes", async () => {
    globalThis.fetch
      .mockReturnValueOnce(response(transferStatus()))
      .mockReturnValueOnce(
        response(
          transferStatus({
            state: "completed",
            completed_bytes: "25000000000",
            progress: 100,
          }),
        ),
      );
    const onUpdate = vi.fn();

    const result = await pollObjectTransferStatus(OPERATION_ID, {
      intervalMs: 0,
      onUpdate,
    });

    expect(result.success).toBe(true);
    expect(result.data.state).toBe("completed");
    expect(result.data.isSuccessful).toBe(true);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("retries a transient status failure", async () => {
    globalThis.fetch
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockReturnValueOnce(
        response(
          transferStatus({
            state: "completed",
            completed_bytes: "25000000000",
            progress: 100,
          }),
        ),
      );
    const onPollError = vi.fn();

    const result = await pollObjectTransferStatus(OPERATION_ID, {
      intervalMs: 0,
      onPollError,
    });

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(onPollError).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, status: "error" }),
      1,
    );
  });

  it("returns the server error for a failed transfer", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response(
        transferStatus({
          state: "failed",
          error: "Whole-object hash mismatch",
        }),
      ),
    );

    const result = await pollObjectTransferStatus(OPERATION_ID, {
      intervalMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      status: "failed",
      transferError: {
        code: "hash_mismatch",
      },
    });
    expect(result.error).toMatch(/expected hash/i);
    expect(result.data.isFinished).toBe(true);
  });

  it("stops immediately when its AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await pollObjectTransferStatus(OPERATION_ID, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      success: false,
      status: "aborted",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not retry a permanent HTTP error", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response({ success: false, error: "Transfer not found" }, 404),
    );

    const result = await pollObjectTransferStatus(OPERATION_ID, {
      intervalMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      httpStatus: 404,
      transferError: {
        code: "transfer_not_found",
      },
    });
    expect(result.error).toMatch(/cannot find this transfer/i);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("object transfer controls", () => {
  it("requests cancellation and normalizes the returned state", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response(
        transferStatus({
          state: "cancelling",
          cancel_requested: true,
        }),
      ),
    );

    const result = await cancelObjectTransfer(OPERATION_ID);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://localhost:8080/api/qmail/net/object-transfers/cancel?operation_id=${OPERATION_ID}`,
      { method: "POST", signal: undefined, headers: {} },
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        state: "cancelling",
        cancelRequested: true,
      },
    });
  });

  it("resumes a paused transfer", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response(transferStatus({ state: "paused" })),
    );

    const result = await resumeObjectTransfer(OPERATION_ID);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://localhost:8080/api/qmail/net/object-transfers/resume?operation_id=${OPERATION_ID}`,
      { method: "POST", signal: undefined, headers: {} },
    );
    expect(result.success).toBe(true);
  });

  it("preserves structured errors returned by transfer controls", async () => {
    globalThis.fetch.mockReturnValueOnce(
      response(
        {
          success: false,
          error: "OBJECT_BEGIN rejected by RAIDA 1 (status 227)",
          last_status: 227,
        },
        409,
      ),
    );

    const result = await resumeObjectTransfer(OPERATION_ID);

    expect(result).toMatchObject({
      success: false,
      httpStatus: 409,
      transferError: {
        code: "capacity",
        protocolStatus: 227,
      },
    });
  });
});
