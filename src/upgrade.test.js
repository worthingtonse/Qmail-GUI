// Tests for upgrade.cjs — the in-place launcher upgrade pipeline.
//
// The happy-path tests run the REAL pipeline (download -> SHA-256 verify ->
// rename swap) against a temp directory, with only global fetch stubbed.
// The "target" is an ordinary file, not a running exe, so the renames
// behave exactly as they do for the real portable launcher.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  parseSha256Sums,
  resolveUpgradeTarget,
  performUpgrade,
  cleanupLeftovers,
  cancelUpgrade,
  consumeInstalledLatch,
} from "../upgrade.cjs";
import { buildDate as LOCAL_BUILD_DATE } from "../version.json";

const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

// A version guaranteed newer than any real build date.
const NEW_VERSION = "2099-01-02";

let tempDir = null;
let savedPortable;
let savedAppImage;

beforeEach(() => {
  savedPortable = process.env.PORTABLE_EXECUTABLE_FILE;
  savedAppImage = process.env.APPIMAGE;
  delete process.env.PORTABLE_EXECUTABLE_FILE;
  delete process.env.APPIMAGE;
});

afterEach(() => {
  if (savedPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
  else process.env.PORTABLE_EXECUTABLE_FILE = savedPortable;
  if (savedAppImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = savedAppImage;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  consumeInstalledLatch(); // clear module state a successful run leaves behind
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

const makeTempTarget = () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qmail-upgrade-test-"));
  const target = path.join(tempDir, "QMail.exe");
  fs.writeFileSync(target, "OLD LAUNCHER BYTES");
  process.env.PORTABLE_EXECUTABLE_FILE = target;
  return target;
};

// Minimal fetch stub: responder(url) returns a string/Buffer body, a
// number (HTTP error status), or undefined (404).
const stubFetch = (responder) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const body = responder(String(url));
      if (body === undefined) return new Response("Not Found", { status: 404 });
      if (typeof body === "number") return new Response("", { status: body });
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
      return new Response(buffer, {
        status: 200,
        headers: { "content-length": String(buffer.length) },
      });
    }),
  );
};

describe("parseSha256Sums", () => {
  it("parses GNU sha256sum lines, including binary-mode markers", () => {
    const hex = "a".repeat(64);
    const sums = parseSha256Sums(
      `${hex}  QMail.exe\n${"b".repeat(64)} *QMail.AppImage\nnot a line\n`,
    );
    expect(sums.get("QMail.exe")).toBe(hex);
    expect(sums.get("QMail.AppImage")).toBe("b".repeat(64));
    expect(sums.size).toBe(2);
  });
});

describe("resolveUpgradeTarget", () => {
  it("is unsupported without a packaged launcher path", () => {
    const target = resolveUpgradeTarget();
    expect(target.supported).toBe(false);
    expect(target.targetPath).toBeNull();
  });

  it.runIf(process.platform === "win32")(
    "resolves the portable exe on Windows",
    () => {
      const targetPath = makeTempTarget();
      const target = resolveUpgradeTarget();
      expect(target.supported).toBe(true);
      expect(target.platformKey).toBe("windows");
      expect(path.normalize(target.targetPath)).toBe(path.normalize(targetPath));
    },
  );
});

describe("performUpgrade guards", () => {
  it("refuses when this build cannot self-replace", async () => {
    const result = await performUpgrade({ latestVersion: NEW_VERSION });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unsupported");
  });

  it.runIf(process.platform === "win32")(
    "refuses a malformed version",
    async () => {
      makeTempTarget();
      const result = await performUpgrade({ latestVersion: "latest" });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("bad-version");
    },
  );

  it.runIf(process.platform === "win32")(
    "refuses a downgrade or same-version reinstall",
    async () => {
      makeTempTarget();
      const result = await performUpgrade({ latestVersion: LOCAL_BUILD_DATE });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("not-newer");
    },
  );
});

describe.runIf(process.platform === "win32")("performUpgrade pipeline", () => {
  const NEW_BYTES = Buffer.from("NEW LAUNCHER BYTES v2");

  it("downloads, verifies, and swaps the launcher in place", async () => {
    const targetPath = makeTempTarget();
    stubFetch((url) => {
      if (url.endsWith("/SHA256SUMS")) {
        return `${sha256(NEW_BYTES)}  QMail.exe\n`;
      }
      if (url.endsWith("/QMail.exe")) return NEW_BYTES;
      return undefined;
    });

    const phases = [];
    const result = await performUpgrade({
      latestVersion: NEW_VERSION,
      onProgress: (p) => phases.push(p.phase),
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(targetPath)).toEqual(NEW_BYTES);
    // The renamed-away original survives as .old for the next-start sweep.
    expect(fs.readFileSync(targetPath + ".old", "utf8")).toBe(
      "OLD LAUNCHER BYTES",
    );
    expect(fs.existsSync(targetPath + ".new")).toBe(false);
    expect(phases).toContain("downloading");
    expect(phases).toContain("verifying");
    expect(phases).toContain("installing");
    expect(phases.at(-1)).toBe("ready");
  });

  it("retries the dated name when the canonical hash mismatches", async () => {
    // The mid-promotion race: SHA256SUMS was regenerated for a newer
    // canonical while we downloaded the older bytes. The dated entry
    // still matches what is actually served under the dated name.
    const targetPath = makeTempTarget();
    const staleBytes = Buffer.from("STALE CANONICAL BYTES");
    stubFetch((url) => {
      if (url.endsWith("/SHA256SUMS")) {
        return (
          `${sha256(NEW_BYTES)}  QMail.exe\n` +
          `${sha256(staleBytes)}  qmail-windows-${NEW_VERSION}.exe\n`
        );
      }
      if (url.endsWith("/QMail.exe")) return staleBytes; // mismatches its entry
      if (url.endsWith(`/qmail-windows-${NEW_VERSION}.exe`)) return staleBytes;
      return undefined;
    });

    const result = await performUpgrade({ latestVersion: NEW_VERSION });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(targetPath)).toEqual(staleBytes);
  });

  it("rejects the download when no hash matches, leaving the launcher intact", async () => {
    const targetPath = makeTempTarget();
    stubFetch((url) => {
      if (url.endsWith("/SHA256SUMS")) {
        return `${"c".repeat(64)}  QMail.exe\n`;
      }
      if (url.endsWith("/QMail.exe")) return NEW_BYTES; // wrong bytes
      return undefined;
    });

    const result = await performUpgrade({ latestVersion: NEW_VERSION });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("hash");
    expect(fs.readFileSync(targetPath, "utf8")).toBe("OLD LAUNCHER BYTES");
    expect(fs.existsSync(targetPath + ".new")).toBe(false);
    expect(fs.existsSync(targetPath + ".old")).toBe(false);
  });

  it("refuses to download when free space is too low", async () => {
    const targetPath = makeTempTarget();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/SHA256SUMS")) {
          return new Response(`${sha256(NEW_BYTES)}  QMail.exe\n`, {
            status: 200,
          });
        }
        // An announced size no disk can hold twice over.
        return new Response(NEW_BYTES, {
          status: 200,
          headers: { "content-length": String(2 ** 53) },
        });
      }),
    );

    const result = await performUpgrade({ latestVersion: NEW_VERSION });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("no-space");
    expect(fs.readFileSync(targetPath, "utf8")).toBe("OLD LAUNCHER BYTES");
    expect(fs.existsSync(targetPath + ".new")).toBe(false);
  });

  it("fails cleanly when SHA256SUMS is unreachable", async () => {
    const targetPath = makeTempTarget();
    stubFetch(() => undefined);

    const result = await performUpgrade({ latestVersion: NEW_VERSION });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("sums");
    expect(fs.readFileSync(targetPath, "utf8")).toBe("OLD LAUNCHER BYTES");
  });
});

describe.runIf(process.platform === "win32")("performUpgrade swap failures", () => {
  const NEW_BYTES = Buffer.from("NEW LAUNCHER BYTES v2");

  const stubGoodDownload = () =>
    stubFetch((url) => {
      if (url.endsWith("/SHA256SUMS")) return `${sha256(NEW_BYTES)}  QMail.exe\n`;
      if (url.endsWith("/QMail.exe")) return NEW_BYTES;
      return undefined;
    });

  const errWithCode = (code) => {
    const error = new Error(code);
    error.code = code;
    return error;
  };

  it(
    "EBUSY on the swap fails to manual without elevating, launcher restored",
    async () => {
      const targetPath = makeTempTarget();
      stubGoodDownload();

      const realRename = fs.promises.rename.bind(fs.promises);
      vi.spyOn(fs.promises, "rename").mockImplementation((from, to) => {
        // The install rename (staged -> target) is persistently EBUSY, as
        // under an antivirus scan; everything else behaves normally.
        if (String(from).endsWith(".new")) throw errWithCode("EBUSY");
        return realRename(from, to);
      });

      const result = await performUpgrade({ latestVersion: NEW_VERSION });

      expect(result.ok).toBe(false);
      // EBUSY is a transient lock, not "needs admin rights": the code must
      // be 'swap' (manual fallback), never 'permission' (UAC prompt).
      expect(result.code).toBe("swap");
      expect(fs.readFileSync(targetPath, "utf8")).toBe("OLD LAUNCHER BYTES");
      expect(fs.existsSync(targetPath + ".new")).toBe(false);
      expect(consumeInstalledLatch()).toBe(false);
    },
    30_000,
  );

  it(
    "a stranded swap keeps .old and .new as the only remaining copies",
    async () => {
      const targetPath = makeTempTarget();
      stubGoodDownload();

      const realRename = fs.promises.rename.bind(fs.promises);
      vi.spyOn(fs.promises, "rename").mockImplementation((from, to) => {
        // Second rename (staged -> target) fails AND the rollback
        // (old -> target) fails: the worst case the review flagged. The
        // pipeline must not "clean up" the user's only two copies, and
        // must not walk into an elevation prompt over a half-done swap.
        if (String(from).endsWith(".new")) throw errWithCode("EPERM");
        if (String(from).endsWith(".old")) throw errWithCode("EPERM");
        return realRename(from, to);
      });

      const result = await performUpgrade({ latestVersion: NEW_VERSION });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("swap");
      expect(fs.existsSync(targetPath)).toBe(false); // renamed away
      expect(fs.readFileSync(targetPath + ".old", "utf8")).toBe(
        "OLD LAUNCHER BYTES",
      );
      expect(fs.readFileSync(targetPath + ".new")).toEqual(NEW_BYTES);
    },
    60_000,
  );

  it("cancel during the download deletes .new and keeps the launcher", async () => {
    const targetPath = makeTempTarget();
    let sawFirstChunk;
    const firstChunk = new Promise((resolve) => {
      sawFirstChunk = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/SHA256SUMS")) {
          return new Response(`${sha256(NEW_BYTES)}  QMail.exe\n`, {
            status: 200,
            headers: { "content-length": "100" },
          });
        }
        // A download that sends one chunk and then hangs until aborted.
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(16));
              sawFirstChunk();
            },
          }),
          { status: 200, headers: { "content-length": "1000000" } },
        );
      }),
    );

    const resultPromise = performUpgrade({ latestVersion: NEW_VERSION });
    await firstChunk;
    expect(cancelUpgrade()).toBe(true);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.code).toBe("cancelled");
    expect(fs.readFileSync(targetPath, "utf8")).toBe("OLD LAUNCHER BYTES");
    expect(fs.existsSync(targetPath + ".new")).toBe(false);
  });

  it("refuses a download with no announced size", async () => {
    const targetPath = makeTempTarget();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/SHA256SUMS")) {
          return new Response(`${sha256(NEW_BYTES)}  QMail.exe\n`, {
            status: 200,
          });
        }
        return new Response(NEW_BYTES, { status: 200 }); // no content-length
      }),
    );

    const result = await performUpgrade({ latestVersion: NEW_VERSION });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("download");
    expect(fs.readFileSync(targetPath, "utf8")).toBe("OLD LAUNCHER BYTES");
  });

  it("arms the restart latch only after a completed swap", async () => {
    makeTempTarget();
    stubGoodDownload();

    expect(consumeInstalledLatch()).toBe(false);
    const result = await performUpgrade({ latestVersion: NEW_VERSION });
    expect(result.ok).toBe(true);
    // One-shot: armed by the swap, cleared by the first consume.
    expect(consumeInstalledLatch()).toBe(true);
    expect(consumeInstalledLatch()).toBe(false);
  });
});

describe("cleanupLeftovers", () => {
  it("removes .old and .new next to the target", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qmail-upgrade-test-"));
    const target = path.join(tempDir, "QMail.exe");
    fs.writeFileSync(target, "current");
    fs.writeFileSync(target + ".old", "previous");
    fs.writeFileSync(target + ".new", "orphaned download");

    cleanupLeftovers(target);

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(target + ".old")).toBe(false);
    expect(fs.existsSync(target + ".new")).toBe(false);
  });
});
