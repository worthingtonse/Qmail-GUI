import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  depositCloudCoinFiles,
  downloadLockerToDefaultWallet,
  getQMailIdentityProvisionStatus,
  provisionQMailIdentityFromDefault,
} from "./qmailApiServices.js";

const jsonResponse = (data, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Error",
  json: vi.fn().mockResolvedValue(data),
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("first-run CloudCoin import APIs", () => {
  it("preserves an arbitrary non-empty locker key", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        wallets: [{ wallet_name: "Default", wallet_path: "D:\\Wallets\\Default" }],
      }))
      .mockResolvedValueOnce(jsonResponse({ status: "success", coins_saved: 2 }));

    const result = await downloadLockerToDefaultWallet("  Case-Sensitive/key  ");

    expect(result.success).toBe(true);
    const requestUrl = new URL(globalThis.fetch.mock.calls[1][0]);
    expect(requestUrl.searchParams.get("locker_key")).toBe("Case-Sensitive/key");
    expect(requestUrl.searchParams.get("wallet_path")).toBe("D:\\Wallets\\Default");
  });

  it("rejects zip and png before calling the backend", async () => {
    globalThis.fetch = vi.fn();

    const zipResult = await depositCloudCoinFiles(["D:\\Coins\\wallet.zip"]);
    const pngResult = await depositCloudCoinFiles(["D:\\Coins\\coin.png"]);

    expect(zipResult.success).toBe(false);
    expect(pngResult.success).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("asks rest_core to provision the identity from Default", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      status: "success",
      serial_number: 1234,
      denomination: 100,
      folder: "Bank",
    }));

    const result = await provisionQMailIdentityFromDefault();

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/qmail/local/identity/provision-from-default",
      { method: "POST" },
    );
    expect(result.data.serial_number).toBe(1234);
  });

  it("returns the backend conflict when Mail already has an identity", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(
      { success: false, error: "Mail already contains an identity coin" },
      { ok: false, status: 409 },
    ));

    const result = await provisionQMailIdentityFromDefault();

    expect(result).toEqual({
      success: false,
      error: "Mail already contains an identity coin",
    });
  });

  it("detects a resumable identity setup without moving a coin", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      status: "success",
      identity_exists: false,
      can_finish: true,
      serial_number: 4321,
    }));

    const result = await getQMailIdentityProvisionStatus();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/qmail/local/identity/provision-status",
    );
    expect(result.data).toMatchObject({
      canFinish: true,
      identityExists: false,
      serial_number: 4321,
    });
  });

  it("reports an existing Mail identity as non-resumable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      status: "success",
      identity_exists: true,
      can_finish: false,
    }));

    const result = await getQMailIdentityProvisionStatus();

    expect(result.data.canFinish).toBe(false);
    expect(result.data.identityExists).toBe(true);
  });
});
