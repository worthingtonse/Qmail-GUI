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
    const stored = Number(window.localStorage.getItem(SOUND_VOLUME_STORAGE_KEY));
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
    return stored === null ? fallback : normalizeSoundFile(stored);
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

const normalizeSoundFile = (filename) => String(filename || "").trim();
const buildSoundSrc = (filename) => {
  const normalized = normalizeSoundFile(filename);
  return normalized ? `./sounds/${encodeURIComponent(normalized)}` : null;
};

class SoundService {
  constructor() {
    this.sounds = {};
    this.isEnabled = readStoredBoolean(SOUND_ENABLED_STORAGE_KEY, true);
    this.volume = readStoredVolume(0.3); // Default volume (30%)
    this.mailSoundFile = normalizeSoundFile(
      readStoredSoundFile(DEFAULT_MAIL_SOUND_FILE),
    );
    this.preloadSounds();
  }

  // Preload all sound effects
  preloadSounds() {
    if (typeof Audio === "undefined") return;

    const soundFiles = {
      glassClick: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
      glassHover: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
      glassTab: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
      glassSuccess: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
      glassError: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
    };

    Object.entries(soundFiles).forEach(([key, src]) => {
      if (!src) return;
      const audio = new Audio();
      audio.src = src;
      audio.preload = 'auto';
      audio.volume = this.volume;
      
      // Handle loading errors gracefully
      audio.onerror = () => {
        console.warn(`Could not load sound: ${src}`);
      };
      
      this.sounds[key] = audio;
    });
  }

  // Play a specific sound
  play(soundType, { force = false } = {}) {
    if ((!this.isEnabled && !force) || typeof Audio === "undefined") return;

    let sound = this.sounds[soundType];

    // Lazy-load sound if not preloaded
    if (!sound) {
      const soundFiles = {
        glassClick: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
        glassHover: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
        glassTab: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
        glassSuccess: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
        glassError: buildSoundSrc(DEFAULT_MAIL_SOUND_FILE),
      };
      const src = soundFiles[soundType];
      if (!src) return;
      sound = new Audio();
      sound.src = src;
      sound.preload = 'auto';
      sound.volume = this.volume;
      sound.onerror = () => {
        console.warn(`Could not load sound: ${src}`);
      };
      this.sounds[soundType] = sound;
    }

    if (sound) {
      // Clone the audio to allow overlapping plays
      const audioClone = sound.cloneNode();
      audioClone.volume = this.volume;

      // Reset to beginning and play
      audioClone.currentTime = 0;
      audioClone.play().catch(error => {
        console.warn(`Could not play sound ${soundType}:`, error);
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

  getMailSoundFile() {
    return this.mailSoundFile;
  }

  getMailSoundSrc() {
    const filename = this.getMailSoundFile();
    if (!filename) return null;
    return buildSoundSrc(filename);
  }

  setMailSoundFile(filename) {
    this.mailSoundFile = normalizeSoundFile(filename);
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
    });
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
