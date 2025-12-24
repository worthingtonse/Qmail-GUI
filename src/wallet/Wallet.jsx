import React, { useState, useEffect } from 'react';
import '../App.css';
import WelcomeScreen from './components/WelcomeScreen';
import USBCheckScreen from './components/USBCheckScreen';
import PasswordScreen from './components/PasswordScreen';
import MainDashboard from './components/MainDashboard';

const SCREENS = {
WELCOME: 'welcome',
USB_CHECK: 'usb_check',
PASSWORD: 'password',
DASHBOARD: 'dashboard'
};

function Wallet() {
const [currentScreen, setCurrentScreen] = useState(SCREENS.WELCOME);
const [isUSBDrive, setIsUSBDrive] = useState(false);
const [isAuthenticated, setIsAuthenticated] = useState(false);

useEffect(() => {
const checkUSB = async () => {
console.log('Starting USB check...');
await new Promise(resolve => setTimeout(resolve, 100));

  if (window.electronAPI) {
    console.log('electronAPI is available');
    try {
      const result = await window.electronAPI.checkUSBDrive();
      console.log('USB check result:', result);
      setIsUSBDrive(result);
    } catch (err) {
      console.error('USB check error:', err);
      setIsUSBDrive(false);
    }
  } else {
    console.error('electronAPI not available - this might be running in browser');
    setIsUSBDrive(true); // Default for browser testing
  }
};

checkUSB();


}, []);

const handleWelcomeAgree = () => {
setCurrentScreen(SCREENS.USB_CHECK);
};

const handleUSBCheckContinue = () => {
if (isUSBDrive) {
setCurrentScreen(SCREENS.PASSWORD);
}
};

const handlePasswordSuccess = () => {
setIsAuthenticated(true);
setCurrentScreen(SCREENS.DASHBOARD);
};

const renderCurrentScreen = () => {
switch (currentScreen) {
case SCREENS.WELCOME:
return <WelcomeScreen onAgree={handleWelcomeAgree} />;
case SCREENS.USB_CHECK:
return (
<USBCheckScreen
isUSBDrive={isUSBDrive}
onContinue={handleUSBCheckContinue}
/>
);
case SCREENS.PASSWORD:
return <PasswordScreen onSuccess={handlePasswordSuccess} />;
case SCREENS.DASHBOARD:
return <MainDashboard />;
default:
return <WelcomeScreen onAgree={handleWelcomeAgree} />;
}
};

return (
<div className="App">
{renderCurrentScreen()}
</div>
);
}

export default Wallet;