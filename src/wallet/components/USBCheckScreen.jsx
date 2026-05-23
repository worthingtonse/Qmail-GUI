import { useState, useEffect } from 'react';
import './USBCheckScreen.css';

/* eslint-disable react/prop-types -- this screen receives simple parent-driven props and the project does not use prop-types. */

const USBCheckScreen = ({ isUSBDrive, onContinue }) => {
  console.log('USBCheckScreen rendered with isUSBDrive:', isUSBDrive);
  const [usbStatus, setUsbStatus] = useState(isUSBDrive);

  // BUG-10 FIX: Sync local state when the prop changes
  useEffect(() => {
    setUsbStatus(isUSBDrive);
  }, [isUSBDrive]);

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
  const isDetected = Boolean(currentUSBStatus);

  const title = isDetected ? 'USB Drive Detected' : 'USB Drive Required';
  const messageLines = isDetected
    ? [
        'Great! The program is running from a USB drive.',
        'Your CloudCoins will be securely stored on this USB drive.',
      ]
    : [
        'This ultra secure program requires you to run it off of a USB drive. Please move the CloudCoin_Pro folder onto a USB drive and restart the program.',
        'Your coins will be stored on the USB drive. When you are done managing your coins, you may remove your USB drive to keep your coins safe from online attacks.',
        'Make sure you store your USB drive in a secure location because it is still vulnerable to physical theft. Make a copy of your USB drive to another USB drive to keep as a backup and store them in different locations.',
      ];

  return (
    <main className="usb-check-screen">
      <section
        className="usb-check-screen__card"
        aria-labelledby="usb-check-screen-title"
      >
        <header className="usb-check-screen__header">
          <div
            className={`usb-check-screen__icon ${
              isDetected
                ? 'usb-check-screen__icon--success'
                : 'usb-check-screen__icon--warning'
            }`}
            aria-hidden="true"
          >
            <svg
              className="usb-check-screen__icon-svg"
              width="80"
              height="80"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              {isDetected ? (
                <path d="m9 12 2 2 4-4" />
              ) : (
                <>
                  <path d="m15 9-6 6" />
                  <path d="m9 9 6 6" />
                </>
              )}
            </svg>
          </div>

          <h1 id="usb-check-screen-title" className="usb-check-screen__title">
            {title}
          </h1>
        </header>

        <section
          className={`usb-check-screen__message ${
            isDetected
              ? 'usb-check-screen__message--success'
              : 'usb-check-screen__message--warning'
          }`}
        >
          {messageLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>

        <footer className="usb-check-screen__actions">
          <button
            className={`usb-check-screen__button ${
              isDetected
                ? 'usb-check-screen__button--continue'
                : 'usb-check-screen__button--exit'
            }`}
            onClick={isDetected ? onContinue : handleExit}
            type="button"
          >
            {isDetected ? 'Continue' : 'Exit Program'}
          </button>
        </footer>
      </section>
    </main>
  );
};

export default USBCheckScreen;
