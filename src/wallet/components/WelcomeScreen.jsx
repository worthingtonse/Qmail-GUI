import React from 'react';
import './WelcomeScreen.css';

const WelcomeScreen = ({ onAgree }) => {
  return (
    <div className="welcome-screen">
      <div className="welcome-container">
        <div className="header">
          <h1>CloudCoin Pro Edition</h1>
          <h2>Version: July 30 2025</h2>
        </div>
        
        <div className="description">
          <p>Used to Authenticate, Store and Payout CloudCoins</p>
        </div>
        
        <div className="disclaimer">
          <p>
            This Software is provided as is with all faults, defects and errors, 
            and without warranty of any kind.
          </p>
          <p>
            Free from the CloudCoin Consortium.
          </p>
        </div>
        
        <div className="actions">
          <button 
            className="agree-button"
            onClick={onAgree}
          >
            I Agree
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;

