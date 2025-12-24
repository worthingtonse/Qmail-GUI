// soundService.js - Glass Click Sound Management
class SoundService {
  constructor() {
    this.sounds = {};
    this.isEnabled = true;
    this.volume = 0.3; // Default volume (30%)
    this.preloadSounds();
  }

  // Preload all sound effects
  preloadSounds() {
    const soundFiles = {
      glassClick: '/sounds/ding-80828.mp3',
      glassHover: '/sounds/ding-80828.mp3',
      glassTab: '/sounds/ding-80828.mp3',
      glassSuccess: '/sounds/ding-80828.mp3',
      glassError: '/sounds/ding-80828.mp3'
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
  play(soundType) {
    if (!this.isEnabled) return;
    
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
  playGlassClick() {
    this.play('glassClick');
  }

  playGlassHover() {
    this.play('glassHover');
  }

  playGlassTab() {
    this.play('glassTab');
  }

  playGlassSuccess() {
    this.play('glassSuccess');
  }

  playGlassError() {
    this.play('glassError');
  }

  // Volume control (0.0 to 1.0)
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    Object.values(this.sounds).forEach(sound => {
      sound.volume = this.volume;
    });
  }

  // Enable/disable sounds
  setEnabled(enabled) {
    this.isEnabled = enabled;
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