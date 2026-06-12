// soundService.js - Shared sound effect management
const SOUND_ENABLED_STORAGE_KEY = "qmail.sound.enabled";
const SOUND_VOLUME_STORAGE_KEY = "qmail.sound.volume";
const SOUND_MAIL_FILE_STORAGE_KEY = "qmail.sound.mailFile";
const DEFAULT_MAIL_SOUND_FILE = "ding-80828.mp3";

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

const readStoredString = (key, fallback) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const stored = window.localStorage.getItem(key);
    return stored && stored.trim() ? stored.trim() : fallback;
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

class SoundService {
  constructor() {
    this.sounds = {};
    this.isEnabled = readStoredBoolean(SOUND_ENABLED_STORAGE_KEY, true);
    this.volume = readStoredVolume(0.3); // Default volume (30%)
    this.mailSoundFile = normalizeSoundFile(
      readStoredString(SOUND_MAIL_FILE_STORAGE_KEY, DEFAULT_MAIL_SOUND_FILE),
    );
    this.preloadSounds();
  }

  // Preload all sound effects
  preloadSounds() {
    if (typeof Audio === "undefined") return;

    const soundFiles = {
      glassClick: '/sounds/ding-80828.mp3',
      glassHover: '/sounds/ding-80828.mp3',
      glassTab: '/sounds/ding-80828.mp3',
      glassSuccess: '/sounds/ding-80828.mp3',
      glassError: '/sounds/ding-80828.mp3',
    };

    Object.entries(soundFiles).forEach(([key, src]) => {
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
    
    const sound = this.sounds[soundType];
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
    return this.mailSoundFile || DEFAULT_MAIL_SOUND_FILE;
  }

  getMailSoundSrc() {
    const filename = this.getMailSoundFile();
    if (!filename) return null;
    return `/sounds/${encodeURIComponent(filename)}`;
  }

  setMailSoundFile(filename) {
    this.mailSoundFile = normalizeSoundFile(filename) || DEFAULT_MAIL_SOUND_FILE;
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
