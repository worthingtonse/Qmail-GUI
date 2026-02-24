// screens/WalletSetupScreen.jsx
import React, { useState } from 'react';
import { ShieldAlert, CheckCircle, ArrowRight, RefreshCw, Coins, User } from 'lucide-react';
import { healWallet, prepareChange } from '../../api/qmailApiServices';

const WalletSetupScreen = ({ accountData, onProceed }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState(accountData?.needs_healing ? 'fracked' : 'healthy');

  const handleHeal = async () => {
    setIsProcessing(true);
    const result = await healWallet();
    if (result.status === "success") setStatus('healthy');
    setIsProcessing(false);
  };

  const handleMakeChange = async () => {
    setIsProcessing(true);
    await prepareChange();
    setIsProcessing(false);
  };

  return (
    <div className="wallet-setup-screen">
      <div className="setup-container glass-container">
        <header className="setup-header">
          <User size={48} className="text-primary" />
          <h1>Welcome, {accountData?.email_address?.split('@')[0]}!</h1>
          <p className="address-badge">{accountData?.pretty_address}</p>
        </header>

        <div className="status-box">
          {status === 'fracked' ? (
            <div className="status-message warning">
              <ShieldAlert size={20} />
              <p>Warning: Identity Coin is fracked. You can heal it now or proceed anyway.</p>
            </div>
          ) : (
            <div className="status-message success">
              <CheckCircle size={20} />
              <p>Your identity is healthy and verified.</p>
            </div>
          )}
        </div>

        <div className="setup-actions">
          <div className="action-row">
            <button className="action-btn secondary" onClick={handleHeal} disabled={isProcessing}>
              <RefreshCw className={isProcessing ? 'spinning' : ''} /> Heal Identity
            </button>
            <button className="action-btn secondary" onClick={handleMakeChange} disabled={isProcessing}>
              <Coins /> Make Change
            </button>
          </div>
          
          <button className="action-btn primary proceed" onClick={onProceed}>
            Go to Dashboard <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletSetupScreen;
