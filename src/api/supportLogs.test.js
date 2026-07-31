import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", {
  electronAPI: undefined,
  localStorage: (() => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
    };
  })(),
  location: { search: "" },
});

const { createSupportZip, sendSupportLogs, pollSupportSendUntilTerminal } =
  await import("./qmailApiServices.js");
const { SUPPORT_QMAIL_ADDRESS } = await import("../qmail/supportConstants.js");
const {
  buildSupportMessageBody,
  formatSupportProgressNotification,
  interpretSupportSendTaskResult,
  isAbsoluteZipPath,
  normalizeSupportZipResponse,
  shouldNotifySupportProgress,
} = await import("../qmail/supportLogsFlow.js");
const {
  forgetPendingSupportSend,
  readPendingSupportSend,
  rememberPendingSupportSend,
  SUPPORT_SEND_STORAGE_KEY_PREFIX,
} = await import("../qmail/supportSendRegistry.js");

const SUPPORT_SEND_KEY_8080 = `${SUPPORT_SEND_STORAGE_KEY_PREFIX}:8080`;
const SUPPORT_SEND_KEY_8081 = `${SUPPORT_SEND_STORAGE_KEY_PREFIX}:8081`;

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
  window.localStorage.clear?.();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("isAbsoluteZipPath", () => {
  it("accepts Windows and POSIX absolute .zip paths", () => {
    expect(isAbsoluteZipPath("D:\\App\\Client_Data\\Zipped Logs\\a.zip")).toBe(
      true,
    );
    expect(isAbsoluteZipPath("/tmp/support.zip")).toBe(true);
  });

  it("rejects relative or non-zip paths", () => {
    expect(isAbsoluteZipPath("relative/a.zip")).toBe(false);
    expect(isAbsoluteZipPath("D:\\logs\\a.txt")).toBe(false);
  });
});

describe("normalizeSupportZipResponse", () => {
  const fullPath =
    "D:\\App\\Client_Data\\Zipped Logs\\ForSupport.2026-07-29_15-30-45.zip";

  it("requires explicit success status", () => {
    expect(
      normalizeSupportZipResponse({
        full_path: fullPath,
        files_added: 3,
      }).success,
    ).toBe(false);

    expect(
      normalizeSupportZipResponse({
        status: "success",
        full_path: fullPath,
        files_added: 3,
      }).success,
    ).toBe(true);
  });

  it("requires absolute zip path and files_added > 0", () => {
    expect(
      normalizeSupportZipResponse({
        status: "success",
        full_path: fullPath,
        files_added: 0,
      }).success,
    ).toBe(false);

    expect(
      normalizeSupportZipResponse({
        status: "success",
        full_path: "relative.zip",
        files_added: 2,
      }).success,
    ).toBe(false);
  });
});

describe("createSupportZip", () => {
  it("calls tools/support-zip on the shared API base", async () => {
    const fullPath =
      "D:\\App\\Client_Data\\Zipped Logs\\ForSupport.2026-07-29_15-30-45.zip";
    globalThis.fetch.mockReturnValueOnce(
      response({
        status: "success",
        filename: "ForSupport.2026-07-29_15-30-45.zip",
        full_path: fullPath,
        files_added: 8,
      }),
    );

    const result = await createSupportZip();
    expect(result.success).toBe(true);
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(
      /\/api\/tools\/support-zip$/,
    );
  });
});

describe("createSupportZip dynamic port", () => {
  it("uses ?backendPort= from the location query string", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {
      electronAPI: undefined,
      location: { search: "?backendPort=8123" },
      localStorage: window.localStorage,
    });

    const { createSupportZip: createOnPort } = await import(
      "./qmailApiServices.js"
    );
    const fullPath =
      "D:\\App\\Client_Data\\Zipped Logs\\ForSupport.2026-07-29_15-30-45.zip";
    globalThis.fetch = vi.fn().mockReturnValueOnce(
      response({
        status: "success",
        full_path: fullPath,
        files_added: 2,
        filename: "ForSupport.2026-07-29_15-30-45.zip",
      }),
    );

    const result = await createOnPort();
    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8123/api/tools/support-zip",
    );

    // Restore default window stub for remaining tests in this file.
    vi.resetModules();
    vi.stubGlobal("window", {
      electronAPI: undefined,
      location: { search: "" },
      localStorage: window.localStorage,
    });
  });
});

describe("sendSupportLogs", () => {
  it("posts to support address without absolute path in body", async () => {
    const walletPath = "D:\\Wallets\\Default";
    const zipPath =
      "D:\\App\\Client_Data\\Zipped Logs\\ForSupport.2026-07-29_15-30-45.zip";

    globalThis.fetch
      .mockReturnValueOnce(
        response({
          wallets: [{ wallet_name: "Default", wallet_path: walletPath }],
        }),
      )
      .mockReturnValueOnce(
        response({
          success: true,
          task_id: "support-task-1",
          file_guid: "aabbccddeeff00112233445566778899",
        }),
      );

    const result = await sendSupportLogs({
      zipPath,
      filename: "ForSupport.2026-07-29_15-30-45.zip",
    });
    expect(result.success).toBe(true);
    expect(result.data.taskId).toBe("support-task-1");

    const params = new URLSearchParams(globalThis.fetch.mock.calls[1][1].body);
    expect(params.getAll("to")).toEqual([SUPPORT_QMAIL_ADDRESS]);
    expect(params.getAll("attachment_file_path")).toEqual([zipPath]);
    const body = params.get("body") || "";
    expect(body).toContain("ForSupport.2026-07-29_15-30-45.zip");
    expect(body).not.toContain("D:\\App\\Client_Data");
  });
});

describe("interpretSupportSendTaskResult", () => {
  it("requires explicit full-delivery fields", () => {
    const full = interpretSupportSendTaskResult({
      isFinished: true,
      isSuccessful: true,
      result: {
        all_accepted: true,
        tell_failures: 0,
        tell_retries_queued: 0,
      },
    });
    expect(full.outcome).toBe("full");

    const missing = interpretSupportSendTaskResult({
      isFinished: true,
      isSuccessful: true,
      result: {},
    });
    expect(missing.outcome).toBe("indeterminate");

    const noResult = interpretSupportSendTaskResult({
      isFinished: true,
      isSuccessful: true,
      result: null,
    });
    expect(noResult.outcome).toBe("indeterminate");

    const partial = interpretSupportSendTaskResult({
      isFinished: true,
      isSuccessful: true,
      result: {
        all_accepted: false,
        tell_failures: 2,
        tell_retries_queued: 2,
      },
    });
    expect(partial.outcome).toBe("partial");

    const failed = interpretSupportSendTaskResult({
      isFinished: true,
      isSuccessful: false,
      error: "boom",
    });
    expect(failed.outcome).toBe("failed");

    const fractionalCount = interpretSupportSendTaskResult({
      isFinished: true,
      isSuccessful: true,
      result: {
        all_accepted: true,
        tell_failures: 0.9,
        tell_retries_queued: 0,
      },
    });
    expect(fractionalCount.outcome).toBe("indeterminate");
  });
});

describe("shouldNotifySupportProgress / format", () => {
  it("throttles and surfaces connectivity loss", () => {
    const a = { message: "Uploading", progress: 12 };
    const b = { message: "Uploading", progress: 15 };
    expect(shouldNotifySupportProgress(a, b)).toBe(false);
    expect(
      shouldNotifySupportProgress(a, { ...a, connectivityLost: true }),
    ).toBe(true);
    expect(
      formatSupportProgressNotification({ connectivityLost: true }),
    ).toMatch(/Lost contact|do not start another/i);
  });
});

describe("supportSendRegistry", () => {
  it("persists and clears pending task ids for one backend port", () => {
    expect(
      rememberPendingSupportSend(
        {
          taskId: "task-abc",
          zipPath: "D:\\z\\a.zip",
          filename: "a.zip",
        },
        SUPPORT_SEND_KEY_8080,
      ),
    ).toBe(true);
    expect(readPendingSupportSend(SUPPORT_SEND_KEY_8080)?.taskId).toBe(
      "task-abc",
    );
    forgetPendingSupportSend(SUPPORT_SEND_KEY_8080);
    expect(readPendingSupportSend(SUPPORT_SEND_KEY_8080)).toBeNull();
  });

  it("does not expose one backend port's task to another port", () => {
    rememberPendingSupportSend(
      { taskId: "task-on-8080" },
      SUPPORT_SEND_KEY_8080,
    );
    expect(readPendingSupportSend(SUPPORT_SEND_KEY_8080)?.taskId).toBe(
      "task-on-8080",
    );
    expect(readPendingSupportSend(SUPPORT_SEND_KEY_8081)).toBeNull();
  });

  it("reports storage failure instead of pretending persistence succeeded", () => {
    const failingStorage = {
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    expect(
      rememberPendingSupportSend(
        { taskId: "task-abc" },
        SUPPORT_SEND_KEY_8080,
        failingStorage,
      ),
    ).toBe(false);
  });
});

describe("pollSupportSendUntilTerminal", () => {
  it("does not exit as failure on status fetch errors; waits for terminal", async () => {
    const fail = () => Promise.reject(new Error("network down"));
    globalThis.fetch
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail)
      .mockReturnValueOnce(
        response({
          payload: {
            id: "t1",
            status: "success",
            progress: 100,
            message: "Done",
            data: {
              all_accepted: true,
              tell_failures: 0,
              tell_retries_queued: 0,
            },
          },
        }),
      );

    const updates = [];
    const result = await pollSupportSendUntilTerminal("t1", {
      intervalMs: 1,
      softTimeoutMs: 600000,
      onUpdate: (t) => updates.push(t),
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("terminal");
    expect(result.data.isFinished).toBe(true);
    // May or may not have connectivityLost depending on error threshold (5);
    // with only 2 failures before success, no connectivity toast required.
  });

  it("notifies connectivityLost after repeated status failures then recovers", async () => {
    const fail = () => Promise.reject(new Error("down"));
    // 5 failures → connectivity notify, then success
    globalThis.fetch
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail)
      .mockReturnValueOnce(
        response({
          payload: {
            id: "t2",
            status: "success",
            progress: 100,
            data: {
              all_accepted: true,
              tell_failures: 0,
              tell_retries_queued: 0,
            },
          },
        }),
      );

    const updates = [];
    const result = await pollSupportSendUntilTerminal("t2", {
      intervalMs: 1,
      onUpdate: (t) => updates.push(t),
    });
    expect(result.success).toBe(true);
    expect(updates.some((u) => u.connectivityLost)).toBe(true);
  });

  it("returns not_found after a reachable core repeatedly reports 404", async () => {
    const missingTask = {
      status: "error",
      message: "Task not found",
    };
    globalThis.fetch
      .mockReturnValueOnce(response(missingTask, 404))
      .mockReturnValueOnce(response(missingTask, 404))
      .mockReturnValueOnce(response(missingTask, 404));

    const result = await pollSupportSendUntilTerminal("stale-task", {
      intervalMs: 1,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("not_found");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("can abort a renderer poll without reporting the core task failed", async () => {
    const controller = new AbortController();
    globalThis.fetch.mockReturnValueOnce(
      response({
        payload: {
          id: "still-running",
          status: "running",
          progress: 10,
          message: "Uploading",
          data: {},
        },
      }),
    );

    const result = await pollSupportSendUntilTerminal("still-running", {
      intervalMs: 1000,
      signal: controller.signal,
      onUpdate: () => controller.abort(),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("aborted");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes cancellation through an in-flight task-status fetch", async () => {
    const controller = new AbortController();
    globalThis.fetch.mockImplementationOnce((_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
    );

    const pollPromise = pollSupportSendUntilTerminal("in-flight", {
      signal: controller.signal,
    });
    controller.abort();
    const result = await pollPromise;

    expect(result.success).toBe(false);
    expect(result.status).toBe("aborted");
  });
});

describe("buildSupportMessageBody", () => {
  it("includes filename not absolute path", () => {
    const body = buildSupportMessageBody({
      filename: "ForSupport.zip",
      buildDate: "2026-07-29",
      buildNumber: 1,
      sentAt: "2026-07-29T00:00:00.000Z",
    });
    expect(body).toContain("Attachment: ForSupport.zip");
    expect(body).not.toMatch(/[A-Za-z]:\\/);
  });
});
