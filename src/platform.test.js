import { describe, expect, it } from "vitest";

import { detectPlatformKey, PLATFORM_KEYS } from "./platform.js";

// Real user agent strings — Electron 25 on each host OS, plus the mobile
// browsers whose UA strings overlap with desktop ones.
const UA = {
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) QMail/1.0.55 Chrome/114.0.5735.289 Electron/25.9.8 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) QMail/1.0.55 Chrome/114.0.5735.289 Electron/25.9.8 Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) QMail/1.0.55 Chrome/114.0.5735.289 Electron/25.9.8 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

describe("detectPlatformKey", () => {
  it("identifies each desktop platform QMail ships on", () => {
    expect(detectPlatformKey(UA.windows)).toBe("windows");
    expect(detectPlatformKey(UA.mac)).toBe("mac");
    expect(detectPlatformKey(UA.linux)).toBe("linux-app");
  });

  it("does not mistake Android for Linux", () => {
    // Every Android UA contains "Linux"; ordering in detectPlatformKey is
    // what keeps this from resolving to linux-app.
    expect(detectPlatformKey(UA.android)).toBe("android");
  });

  it("does not mistake iOS for macOS", () => {
    // iPhone and iPad UAs both contain "Mac OS X".
    expect(detectPlatformKey(UA.iphone)).toBe("iphone");
    expect(detectPlatformKey(UA.ipad)).toBe("iphone");
  });

  it("returns null rather than guessing when the OS is unknown", () => {
    expect(detectPlatformKey("")).toBeNull();
    expect(detectPlatformKey("some-unknown-runtime/1.0")).toBeNull();
  });

  it("only ever returns keys the manifest defines", () => {
    Object.values(UA).forEach((ua) => {
      const key = detectPlatformKey(ua);
      expect(PLATFORM_KEYS).toContain(key);
    });
  });
});
