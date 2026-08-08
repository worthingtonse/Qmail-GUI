import { afterEach, describe, expect, it, vi } from "vitest";

// Counts how many Audio elements the service constructs, so the tests can
// assert that importing the module does not touch the audio stack at all.
let audioInstances = [];

const stubAudio = () => {
  audioInstances = [];
  class FakeAudio {
    constructor() {
      this.src = "";
      this.volume = 1;
      this.currentTime = 0;
      audioInstances.push(this);
    }
    cloneNode() {
      return new FakeAudio();
    }
    play() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("Audio", FakeAudio);
};

const loadSoundService = async (storedValues = {}) => {
  vi.resetModules();
  stubAudio();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key) => (
        Object.prototype.hasOwnProperty.call(storedValues, key)
          ? storedValues[key]
          : null
      )),
      setItem: vi.fn(),
    },
    dispatchEvent: vi.fn(),
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

describe("soundService lazy audio allocation", () => {
  it("creates no Audio elements when the module is imported", async () => {
    await loadSoundService();

    expect(audioInstances).toHaveLength(0);
  });

  it("creates a single shared element on first play and reuses it", async () => {
    const soundService = await loadSoundService();

    soundService.playGlassClick();
    // One cached element plus the clone that actually plays.
    const afterFirstPlay = audioInstances.length;
    expect(afterFirstPlay).toBe(2);

    soundService.playGlassTab();
    soundService.playGlassSuccess();

    // Each later play adds only a clone — no second cached element per type.
    expect(audioInstances.length).toBe(afterFirstPlay + 2);
  });

  it("does not allocate audio while sound is disabled", async () => {
    const soundService = await loadSoundService({ "qmail.sound.enabled": "false" });

    soundService.playGlassClick();

    expect(audioInstances).toHaveLength(0);
  });

  it("applies volume changes to the cached element", async () => {
    const soundService = await loadSoundService();

    soundService.playGlassClick();
    soundService.setVolume(0.8);

    expect(audioInstances[0].volume).toBe(0.8);
  });
});
