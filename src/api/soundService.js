// soundService.js - Shared sound effect management
const SOUND_ENABLED_STORAGE_KEY = "qmail.sound.enabled";
const SOUND_VOLUME_STORAGE_KEY = "qmail.sound.volume";
const SOUND_MAIL_FILE_STORAGE_KEY = "qmail.sound.mailFile";
const DEFAULT_MAIL_SOUND_FILE = "default.mp3";

const readStoredBoolean = (key, fallback) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const stored = window.localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
};

const readStoredVolume = (fallback) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(SOUND_VOLUME_STORAGE_KEY);
    if (raw === null || String(raw).trim() === "") return fallback;

    const stored = Number(raw);
    if (Number.isFinite(stored)) {
      return Math.max(0, Math.min(1, stored));
    }
  } catch {
    /* ignore */
  }
  return fallback;
};

const readStoredSoundFile = (fallback) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const stored = window.localStorage.getItem(SOUND_MAIL_FILE_STORAGE_KEY);
    return stored === null ? fallback : normalizeSoundValue(stored);
  } catch {
    /* ignore */
  }
  return fallback;
};

const persistSetting = (key, value) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
};

const normalizeSoundValue = (value) => String(value || "").trim();
const isExternalSoundValue = (value) => /^file:\/\//i.test(String(value || "").trim());
const buildSoundSrc = (value) => {
  const normalized = normalizeSoundValue(value);
  if (isExternalSoundValue(normalized)) return normalized;
  return normalized ? `./sounds/${encodeURIComponent(normalized)}` : null;
};
const isPlaybackBlockedError = (error) => {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  return (
    name === "NotAllowedError" ||
    /user gesture|user activation|interact|not allowed|autoplay/i.test(message)
  );
};

const dispatchSoundPlaybackBlocked = (src, error) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("qmail-sound-playback-blocked", {
      detail: {
        src,
        errorName: error?.name || "",
        errorMessage: error?.message || "",
      },
    }),
  );
};

// Every glass effect plays the same file, so they share one lazily-created
// Audio element rather than one per effect name.
const GLASS_SOUND_TYPES = new Set([
  "glassClick",
  "glassHover",
  "glassTab",
  "glassSuccess",
  "glassError",
]);

class SoundService {
  constructor() {
    this.sounds = {};
    this.isEnabled = readStoredBoolean(SOUND_ENABLED_STORAGE_KEY, true);
    this.volume = readStoredVolume(0.3); // Default volume (30%)
    this.mailSoundFile = normalizeSoundValue(
      readStoredSoundFile(DEFAULT_MAIL_SOUND_FILE),
    );
    // Deliberately no preloading here. Constructing Audio elements at import
    // time spins up Chromium's out-of-process AudioService and decodes the
    // mp3 before the user has done anything, costing tens of MB in a session
    // that may never play a sound. play() creates the element on first use.
  }

  // Play a specific sound
  play(soundType, { force = false } = {}) {
    if ((!this.isEnabled && !force) || typeof Audio === "undefined") return;
    if (!GLASS_SOUND_TYPES.has(soundType)) return;

    let sound = this.sounds.glass;

    // Created on first play, then reused; cloneNode below allows overlap.
    if (!sound) {
      const src = buildSoundSrc(DEFAULT_MAIL_SOUND_FILE);
      if (!src) return;
      sound = new Audio();
      sound.src = src;
      sound.preload = 'auto';
      sound.volume = this.volume;
      sound.onerror = () => {
        console.warn(`Could not load sound: ${src}`);
      };
      this.sounds.glass = sound;
    }

    if (sound) {
      // Clone the audio to allow overlapping plays
      const audioClone = sound.cloneNode();
      audioClone.volume = this.volume;

      // Reset to beginning and play
      audioClone.currentTime = 0;
      audioClone.play().catch(error => {
        console.warn(`Could not play sound ${soundType}:`, error);
        if (isPlaybackBlockedError(error)) {
          dispatchSoundPlaybackBlocked(audioClone.currentSrc || audioClone.src, error);
        }
      });
    }
  }

  // Specific sound methods for different interactions
  playGlassClick(options) {
    this.play('glassClick', options);
  }

  playGlassHover(options) {
    this.play('glassHover', options);
  }

  playGlassTab(options) {
    this.play('glassTab', options);
  }

  playGlassSuccess(options) {
    this.play('glassSuccess', options);
  }

  playGlassError(options) {
    this.play('glassError', options);
  }

  playMailReceived(options) {
    const src = this.getMailSoundSrc();
    if (!src) return;
    this.playSource(src, options);
  }

  previewMailReceived() {
    const src = this.getMailSoundSrc() || buildSoundSrc(DEFAULT_MAIL_SOUND_FILE);
    if (!src) return;
    this.playSource(src, { force: true });
  }

  getMailSoundFile() {
    return this.mailSoundFile;
  }

  getMailSoundSrc() {
    const filename = this.getMailSoundFile();
    if (!filename) return null;
    return buildSoundSrc(filename);
  }

  setMailSoundFile(filename) {
    this.mailSoundFile = normalizeSoundValue(filename);
    persistSetting(SOUND_MAIL_FILE_STORAGE_KEY, this.mailSoundFile);
  }

  playSource(src, { force = false } = {}) {
    if ((!this.isEnabled && !force) || typeof Audio === "undefined") return;

    const audio = new Audio();
    audio.src = src;
    audio.preload = "auto";
    audio.volume = this.volume;
    audio.currentTime = 0;
    audio.play().catch((error) => {
      console.warn(`Could not play sound source ${src}:`, error);
      if (isPlaybackBlockedError(error)) {
        dispatchSoundPlaybackBlocked(src, error);
      }
    });
  }

  async enablePlayback() {
    if (typeof Audio === "undefined") return false;
    this.setEnabled(true);
    if (this.volume <= 0) {
      this.setVolume(0.3);
    }

    const src = this.getMailSoundSrc() || buildSoundSrc(DEFAULT_MAIL_SOUND_FILE);
    if (!src) return false;

    const audio = new Audio();
    audio.src = src;
    audio.preload = "auto";
    audio.volume = this.volume;
    audio.currentTime = 0;
    try {
      await audio.play();
      return true;
    } catch (error) {
      console.warn(`Could not enable sound playback with ${src}:`, error);
      if (isPlaybackBlockedError(error)) {
        dispatchSoundPlaybackBlocked(src, error);
      }
      return false;
    }
  }

  // Volume control (0.0 to 1.0)
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    persistSetting(SOUND_VOLUME_STORAGE_KEY, this.volume);
    Object.values(this.sounds).forEach(sound => {
      sound.volume = this.volume;
    });
  }

  // Enable/disable sounds
  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    persistSetting(SOUND_ENABLED_STORAGE_KEY, this.isEnabled);
  }

  // Get current settings
  getSettings() {
    return {
      isEnabled: this.isEnabled,
      volume: this.volume
    };
  }
}

// Create and export a singleton instance
const soundService = new SoundService();
export default soundService;
