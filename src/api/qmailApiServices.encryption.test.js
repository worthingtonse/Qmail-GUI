import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptExistingCoinFiles,
  encryptExistingCoinFiles,
  getCoinEncryptionStatus,
  listRegisteredWalletPaths,
  setCoinEncryptionPassword,
  shutdownCore,
} from "./qmailApiServices.js";

const jsonResponse = (data, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Error",
  json: vi.fn().mockResolvedValue(data),
});

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("coin-file encryption APIs", () => {
  it("normalizes encryption status flags", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      key_set: false,
      encrypted_files_exist: true,
      login_required: true,
      state: "encrypted",
      key_state: "none",
      encrypted_count: 372,
      plaintext_count: 0,
      corrupt_type10: 2,
      salt_domains: 1,
    }));

    const result = await getCoinEncryptionStatus();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/system/encryption-status",
    );
    expect(result.data).toMatchObject({
      keySet: false,
      encryptedFilesExist: true,
      loginRequired: true,
      state: "encrypted",
      keyState: "none",
      encryptedCount: 372,
      plaintextCount: 0,
      corruptType10: 2,
      saltDomains: 1,
    });
  });

  it("posts the password in the body instead of the URL", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      key_set: true,
      key_state: "confirmed",
      raida: { pass: 25, fail: 0, usable: 25 },
    }));

    const result = await setCoinEncryptionPassword("¥CheeseCake£");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      keySet: true,
      keyState: "confirmed",
      confirmed: true,
      raida: { pass: 25, fail: 0, usable: 25 },
    });
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/system/load-password");
    expect(url).not.toContain("CheeseCake");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(URLSearchParams);
    expect(options.body.get("password")).toBe("¥CheeseCake£");
  });

  it("marks a 401 load-password response as a definitive bad password", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(
      {
        error: true,
        message: "bad password",
        detail: "(or coins are counterfeit)",
        key_state: "none",
        key_set: false,
      },
      { ok: false, status: 401 },
    ));

    await expect(setCoinEncryptionPassword("wrong")).resolves.toMatchObject({
      success: false,
      badPassword: true,
      httpStatus: 401,
      error: "Wrong password. Please try again.",
      detail: "(or coins are counterfeit)",
    });
  });

  it("marks a 503 load-password response as inconclusive", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(
      {
        error: true,
        message: "wallet scan failed",
        key_state: "none",
        key_set: false,
      },
      { ok: false, status: 503 },
    ));

    await expect(setCoinEncryptionPassword("maybe")).resolves.toMatchObject({
      success: false,
      inconclusive: true,
      httpStatus: 503,
      error:
        "The password could not be verified (network or file problem). Your coins are safe — please try again.",
    });
  });

  it("returns confirmed=false for a candidate key_state", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      key_set: true,
      key_state: "candidate",
      raida: { pass: 10, fail: 5, usable: 15 },
    }));

    const result = await setCoinEncryptionPassword("maybe-right");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      keySet: true,
      keyState: "candidate",
      confirmed: false,
    });
  });

  it("returns establishing_ready without treating it as confirmed", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      key_set: true,
      key_state: "establishing_ready",
      raida: { pass: 0, fail: 0, usable: 0 },
    }));

    const result = await setCoinEncryptionPassword("first-time");

    expect(result.success).toBe(true);
    expect(result.data.keyState).toBe("establishing_ready");
    expect(result.data.confirmed).toBe(false);
  });

  it("accepts a 200 with confirmed key_state even when key_set is missing", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      key_state: "confirmed",
      raida: { pass: 25, fail: 0, usable: 25 },
    }));

    const result = await setCoinEncryptionPassword("already-loaded");

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      keyState: "confirmed",
      confirmed: true,
    });
  });

  it("sanitizes non-401 errors that contain bad-password wording", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(
      {
        error: true,
        message: "bad password detected",
      },
      { ok: false, status: 400 },
    ));

    const result = await setCoinEncryptionPassword("oops");

    expect(result.success).toBe(false);
    expect(result.badPassword).toBeUndefined();
    expect(result.error).not.toMatch(/wrong password|bad password/i);
    expect(result.detail).toBe("bad password detected");
  });

  it("sends wallet_path when provided and never sends folders", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      task_id: "encrypt-task-1",
    }));

    const result = await encryptExistingCoinFiles(
      "D:\\Client_Data\\Wallets\\Default",
    );

    expect(result.data.taskId).toBe("encrypt-task-1");
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:8080/api/system/encrypt_existing_files",
    );
    expect(options.body.get("wallet_path")).toBe(
      "D:\\Client_Data\\Wallets\\Default",
    );
    expect(options.body.has("folders")).toBe(false);
  });

  it("omits wallet_path when none is supplied (core defaults to Default)", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      task_id: "encrypt-default-task",
    }));

    const result = await encryptExistingCoinFiles();

    expect(result).toMatchObject({
      success: true,
      data: { taskId: "encrypt-default-task" },
    });
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.body.has("wallet_path")).toBe(false);
    expect(options.body.has("folders")).toBe(false);
  });

  it("starts the symmetric per-wallet decryption task", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      task_id: "decrypt-all-task",
    }));

    const result = await decryptExistingCoinFiles();

    expect(result).toMatchObject({
      success: true,
      data: { taskId: "decrypt-all-task" },
    });
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:8080/api/system/decrypt_existing_files",
    );
    expect(options.method).toBe("POST");
    expect(options.body.has("wallet_path")).toBe(false);
    expect(options.body.has("folders")).toBe(false);
  });

  it("sends wallet_path on decrypt when provided", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      task_id: "decrypt-wallet-task",
    }));

    const result = await decryptExistingCoinFiles(
      "E:\\Wallets\\Mail",
    );

    expect(result.data.taskId).toBe("decrypt-wallet-task");
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.body.get("wallet_path")).toBe("E:\\Wallets\\Mail");
    expect(options.body.has("folders")).toBe(false);
  });

  it("lists registered wallet paths and normalizes field spellings", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      wallets: [
        {
          wallet_name: "Default",
          wallet_path: "E:\\Wallets\\Default",
        },
        {
          name: "Mail",
          path: "E:\\Wallets\\Mail",
        },
      ],
    }));

    const result = await listRegisteredWalletPaths();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/wallets/list",
    );
    expect(result).toEqual({
      success: true,
      data: {
        wallets: [
          { name: "Default", path: "E:\\Wallets\\Default" },
          { name: "Mail", path: "E:\\Wallets\\Mail" },
        ],
      },
    });
  });

  it("posts a clean core shutdown request", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      shutting_down: true,
    }));

    const result = await shutdownCore();

    expect(result).toMatchObject({
      success: true,
      data: { shutting_down: true },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/system/shutdown",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
