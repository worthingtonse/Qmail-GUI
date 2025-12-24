import React, { useState } from 'react';
import './App.css';
import ServiceSelectionScreen from './screens/ServiceSelectionScreen';
import Wallet from './wallet/Wallet';
import QMail from './qmail/QMail';
import { NotificationProvider } from './components/common/notifications/NotificationContext';  // 👈 CHANGED: Added curly braces
import NotificationContainer from './components/common/notifications/NotificationContainer';

const SERVICES = {
  NONE: 'none',
  WALLET: 'wallet',
  QMAIL: 'qmail'
};

function App() {
  const [selectedService, setSelectedService] = useState(SERVICES.NONE);

  const handleSelectService = (service) => {
    setSelectedService(service);
  };

  const renderService = () => {
    switch (selectedService) {
      case SERVICES.WALLET:
        return <Wallet />;
      case SERVICES.QMAIL:
        return <QMail />;
      case SERVICES.NONE:
      default:
        return <ServiceSelectionScreen onSelectService={handleSelectService} />;
    }
  };

  return (
    <NotificationProvider>
      <div className="App">
        {renderService()}
      </div>
      <NotificationContainer />
    </NotificationProvider>
  );
}

export default App;