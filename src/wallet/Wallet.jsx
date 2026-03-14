import React, { useState, useEffect } from 'react';
import '../App.css';
import WelcomeScreen from './components/WelcomeScreen';
import USBCheckScreen from './components/USBCheckScreen';
import PasswordScreen from './components/PasswordScreen';
import MainDashboard from './components/MainDashboard';
import { checkUsbDrive } from '../api/apiService';

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

// BUG-10 FIX (review): Call REST API directly instead of IPC middleman
useEffect(() => {
const checkUSB = async () => {
  console.log('Starting USB check...');
  try {
    const result = await checkUsbDrive();
    console.log('USB check result:', result);
    // Pass if on USB, or if USB is not required
    setIsUSBDrive(result.onUsb || !result.required);
  } catch (err) {
    console.error('USB check error:', err);
    setIsUSBDrive(false);
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