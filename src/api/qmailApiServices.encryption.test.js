import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptExistingCoinFiles,
  encryptExistingCoinFiles,
  getCoinEncryptionStatus,
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
    }));

    const result = await getCoinEncryptionStatus();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/system/encryption-status",
    );
    expect(result.data).toMatchObject({
      keySet: false,
      encryptedFilesExist: true,
      loginRequired: true,
    });
  });

  it("posts the password in the body instead of the URL", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      key_set: true,
      password_verified: true,
      verifier_created: false,
    }));

    const result = await setCoinEncryptionPassword("¥CheeseCake£");

    expect(result.success).toBe(true);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/system/load-password");
    expect(url).not.toContain("CheeseCake");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(URLSearchParams);
    expect(options.body.get("password")).toBe("¥CheeseCake£");
  });

  it("preserves the backend's incorrect-password message", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(
      { error: true, message: "Incorrect password", code: 401 },
      { ok: false, status: 401 },
    ));

    await expect(setCoinEncryptionPassword("wrong")).resolves.toMatchObject({
      success: false,
      error: "Incorrect password",
      httpStatus: 401,
    });
  });

  it("restricts encryption to the requested wallet and supported folders", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      task_id: "encrypt-task-1",
    }));

    const result = await encryptExistingCoinFiles(
      "D:\\Client_Data\\Wallets\\Default",
      ["Bank", "Other", "Fracked", "Bank"],
    );

    expect(result.data.taskId).toBe("encrypt-task-1");
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:8080/api/system/encrypt_existing_files",
    );
    expect(options.body.get("wallet_path")).toBe(
      "D:\\Client_Data\\Wallets\\Default",
    );
    expect(options.body.get("folders")).toBe("Bank,Fracked");
  });

  it("uses the documented all-wallet scope when no wallet path is supplied", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      success: true,
      task_id: "encrypt-all-task",
    }));

    const result = await encryptExistingCoinFiles();

    expect(result).toMatchObject({
      success: true,
      data: { taskId: "encrypt-all-task" },
    });
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.body.has("wallet_path")).toBe(false);
    expect(options.body.get("folders")).toBe("Bank,Fracked");
  });

  it("starts the symmetric all-wallet decryption task", async () => {
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
    expect(options.body.get("folders")).toBe("Bank,Fracked");
  });

  it("reports the decrypt endpoint's temporary 501 clearly", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(
      { success: false, message: "Not implemented" },
      { ok: false, status: 501 },
    ));

    const result = await decryptExistingCoinFiles();

    expect(result).toMatchObject({
      success: false,
      error: "Coin decryption is not available in this core build yet.",
      httpStatus: 501,
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
