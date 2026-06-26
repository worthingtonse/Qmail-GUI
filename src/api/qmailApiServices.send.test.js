import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./qmailApiServices.js";

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

describe("sendEmail", () => {
  it("posts the registered Default wallet path to upload_and_tell", async () => {
    const walletPath = "D:\\Wallets\\Default";

    globalThis.fetch
      .mockReturnValueOnce(
        response({
          wallets: [
            {
              wallet_name: "Default",
              wallet_path: walletPath,
            },
          ],
        }),
      )
      .mockReturnValueOnce(
        response({
          success: true,
          message: "Email sent successfully",
          task_id: "task-123",
          operation_id: "00112233445566778899aabbccddeeff",
          operation_ids: ["00112233445566778899aabbccddeeff"],
        }),
      );

    const result = await sendEmail({
      to: ["25.1@byte"],
      subject: "Test subject",
      body: "Test body",
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        taskId: "task-123",
      },
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/wallets/list",
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[1][0]).toBe(
      "http://localhost:8080/api/qmail/net/messages/upload_and_tell",
    );

    const request = globalThis.fetch.mock.calls[1][1];
    expect(request.method).toBe("POST");
    const params = new URLSearchParams(request.body);
    expect(params.get("wallet_path")).toBe(walletPath);
    expect(params.getAll("to")).toEqual(["25.1@byte"]);
    expect(params.get("subject")).toBe("Test subject");
    expect(params.get("body")).toBe("Test body");
    expect(params.get("duration")).toBe("4");
  });

  it("uses an explicit wallet path without resolving the default wallet", async () => {
    const walletPath = "D:\\Wallets\\Explicit";

    globalThis.fetch.mockReturnValueOnce(
      response({
        success: true,
        file_guid: "00112233445566778899aabbccddeeff",
      }),
    );

    const result = await sendEmail({
      walletPath,
      to: ["25.1@byte"],
      body: "Test body",
    });

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      "http://localhost:8080/api/qmail/net/messages/upload_and_tell",
    );

    const request = globalThis.fetch.mock.calls[0][1];
    const params = new URLSearchParams(request.body);
    expect(params.get("wallet_path")).toBe(walletPath);
  });
});
