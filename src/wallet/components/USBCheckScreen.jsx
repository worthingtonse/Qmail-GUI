import React, { useState } from 'react';
import './USBCheckScreen.css';

const USBCheckScreen = ({ isUSBDrive, onContinue }) => {
  console.log('USBCheckScreen rendered with isUSBDrive:', isUSBDrive);
  const [usbStatus, setUsbStatus] = useState(isUSBDrive);

  const recheckUSB = async () => {
    console.log('Manually rechecking USB...');
    
    // Force success for development
    console.log('Forcing USB check to true for development');
    setUsbStatus(true);
    
    // Also try the actual API call
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.checkUSBDrive();
        console.log('Manual USB check result from API:', result);
        setUsbStatus(result);
      } catch (err) {
        console.error('Manual USB check failed:', err);
        // Keep the forced true value
      }
    } else {
      console.error('electronAPI not available during manual check');
    }
  };

  const handleExit = () => {
    console.log('Exit button clicked');
    if (window.electronAPI) {
      console.log('Calling electronAPI.quitApp()');
      window.electronAPI.quitApp();
    } else {
      console.error('electronAPI not available');
      // Fallback for testing in browser
      window.close();
    }
  };

  // Use local state if different from prop
  const currentUSBStatus = usbStatus !== undefined ? usbStatus : isUSBDrive;

  if (!currentUSBStatus) {
    return (
      <div className="usb-check-screen">
        <div className="usb-check-container">
          <div className="warning-icon">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="m15 9-6 6"/>
              <path d="m9 9 6 6"/>
            </svg>
          </div>
          
          <h2>USB Drive Required</h2>
          
          <div className="warning-message">
            <p>
              This ultra secure program requires you to run it off of a USB drive. 
              Please move the CloudCoin_Pro folder onto a USB drive and restart the program.
            </p>
            <p>
              Your coins will be stored on the USB drive. When you are done managing your coins, 
              you may remove your USB drive to keep your coins safe from online attacks.
            </p>
            <p>
              Make sure you store your USB drive in a secure location because it is still 
              vulnerable to physical theft. Make a copy of your USB drive to another USB drive 
              to keep as a backup and store them in different locations.
            </p>
          </div>
          
          <div className="actions">
            {/* <button 
              className="continue-button"
              onClick={recheckUSB}
              style={{ backgroundColor: '#667eea', marginRight: '10px' }}
            >
              Recheck USB
            </button> */}
            <button 
              className="exit-button"
              onClick={handleExit}
            >
              Exit Program
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="usb-check-screen">
      <div className="usb-check-container">
        <div className="success-icon">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        
        <h2>USB Drive Detected</h2>
        
        <div className="success-message">
          <p>Great! The program is running from a USB drive.</p>
          <p>Your CloudCoins will be securely stored on this USB drive.</p>
        </div>
        
        <div className="actions">
          <button 
            className="continue-button"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default USBCheckScreen;

