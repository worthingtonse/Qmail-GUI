import { afterEach, describe, expect, it, vi } from "vitest";

const loadSoundService = async (storedValues = {}) => {
  vi.resetModules();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key) => (
        Object.prototype.hasOwnProperty.call(storedValues, key)
          ? storedValues[key]
          : null
      )),
      setItem: vi.fn(),
    },
  });

  const module = await import("./soundService.js");
  return module.default;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("soundService stored volume", () => {
  it("uses the 30% fallback when no volume has been stored", async () => {
    const soundService = await loadSoundService();

    expect(soundService.getSettings().volume).toBe(0.3);
  });

  it("uses the fallback for a blank or invalid stored volume", async () => {
    const blankService = await loadSoundService({ "qmail.sound.volume": "  " });
    expect(blankService.getSettings().volume).toBe(0.3);

    const invalidService = await loadSoundService({ "qmail.sound.volume": "loud" });
    expect(invalidService.getSettings().volume).toBe(0.3);
  });

  it("preserves an intentional stored mute", async () => {
    const soundService = await loadSoundService({ "qmail.sound.volume": "0" });

    expect(soundService.getSettings().volume).toBe(0);
  });

  it("loads and clamps an explicitly stored numeric volume", async () => {
    const normalService = await loadSoundService({ "qmail.sound.volume": "0.65" });
    expect(normalService.getSettings().volume).toBe(0.65);

    const clampedService = await loadSoundService({ "qmail.sound.volume": "4" });
    expect(clampedService.getSettings().volume).toBe(1);
  });
});
