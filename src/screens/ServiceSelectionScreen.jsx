import React from 'react';
import { Wallet, Mail } from 'lucide-react';
import './ServiceSelectionScreen.css';

const ServiceSelectionScreen = ({ onSelectService }) => {
  return (
    <div className="service-selection-screen">
      <div className="service-selection-container">
        <h1>Welcome to CloudCoin Pro</h1>
        <p>Please select a service to continue.</p>
        <div className="service-selection-buttons">
          <button
            onClick={() => onSelectService('wallet')}
            className="service-button wallet"
          >
            <div className="service-button-content">
              <Wallet className="service-button-icon" size={38} />
              <span>Wallet Services</span>
            </div>
          </button>
          <button
            onClick={() => onSelectService('qmail')}
            className="service-button qmail"
          >
            <div className="service-button-content">
              <Mail className="service-button-icon" size={38} />
              <span>QMail Services</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServiceSelectionScreen;