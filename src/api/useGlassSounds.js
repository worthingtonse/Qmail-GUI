// useGlassSounds.js - React Hook for Glass Click Sounds
import { useCallback, useEffect } from 'react';
import soundService from './soundService';

const useGlassSounds = () => {
  // Add click sound to any element
  const addGlassClickSound = useCallback((element, soundType = 'glassClick') => {
    if (!element) return;

    const handleClick = (e) => {
      soundService.play(soundType);
      
      // Add visual ripple effect
      const ripple = document.createElement('span');
      ripple.classList.add('glass-ripple');
      
      const rect = element.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        left: ${x}px;
        top: ${y}px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
        pointer-events: none;
        animation: glass-ripple 0.6s ease-out;
        z-index: 1000;
      `;
      
      element.style.position = 'relative';
      element.style.overflow = 'hidden';
      element.appendChild(ripple);
      
      // Remove ripple after animation
      setTimeout(() => {
        if (ripple.parentNode) {
          ripple.parentNode.removeChild(ripple);
        }
      }, 600);
    };

    element.addEventListener('click', handleClick);
    
    // Return cleanup function
    return () => {
      element.removeEventListener('click', handleClick);
    };
  }, []);

  // Add hover sound to any element
  const addGlassHoverSound = useCallback((element) => {
    if (!element) return;

    let hoverTimeout;
    
    const handleMouseEnter = () => {
      // Debounce hover sounds
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        soundService.playGlassHover();
      }, 100);
    };

    const handleMouseLeave = () => {
      clearTimeout(hoverTimeout);
    };

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);
    
    // Return cleanup function
    return () => {
      clearTimeout(hoverTimeout);
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  // Convenience functions for specific sound types
  const playGlassClick = useCallback(() => soundService.playGlassClick(), []);
  const playGlassTab = useCallback(() => soundService.playGlassTab(), []);
  const playGlassSuccess = useCallback(() => soundService.playGlassSuccess(), []);
  const playGlassError = useCallback(() => soundService.playGlassError(), []);

  // Settings management
  const setSoundVolume = useCallback((volume) => soundService.setVolume(volume), []);
  const setSoundsEnabled = useCallback((enabled) => soundService.setEnabled(enabled), []);

  return {
    addGlassClickSound,
    addGlassHoverSound,
    playGlassClick,
    playGlassTab,
    playGlassSuccess,
    playGlassError,
    setSoundVolume,
    setSoundsEnabled,
    soundSettings: soundService.getSettings()
  };
};

export default useGlassSounds;