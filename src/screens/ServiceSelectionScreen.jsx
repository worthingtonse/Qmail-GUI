import React, { useState } from 'react';
import { Mail, ArrowRight, Lock, ShieldCheck, Download, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { downloadLockerCoins, createMailbox } from '../api/qmailApiServices';
import './ServiceSelectionScreen.css';

const ServiceSelectionScreen = ({ onSelectService }) => {
  const [currentStep, setCurrentStep] = useState('initial'); // initial, locker-input, address-input
  const [lockerCode, setLockerCode] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');

  const handleLockerDownload = async () => {
    setLoading(true);
    setError('');
    setProgress(0);
    setLoadingMessage('Connecting to RAIDA servers...');

    try {
      const result = await downloadLockerCoins(lockerCode, (prog) => {
        setProgress(prog);
        setLoadingMessage(`Downloading coins... ${Math.round(prog)}%`);
      });
      
      if (result.status === 'success' || result.status === 'completed') {
        if (result.coins_downloaded === 0) {
          setError('No coins found in this locker');
          setLoading(false);
        } else {
          // Move to address selection
          setLoadingMessage('Coins downloaded successfully!');
          setTimeout(() => {
            setCurrentStep('address-input');
            setLoading(false);
            setLoadingMessage('');
          }, 1000);
        }
      } else if (result.status === 'error') {
        setError(result.error || result.details || 'Invalid locker code');
        setLoading(false);
      } else {
        setError('Invalid locker code');
        setLoading(false);
      }
    } catch (err) {
      let errorMsg = 'Failed to connect. Please try again.';
      
      if (err.message.includes('Invalid locker_code format')) {
        errorMsg = 'Invalid locker code format';
      } else if (err.message.includes('hexadecimal')) {
        errorMsg = 'Invalid characters in locker code';
      } else if (err.message.includes('timeout')) {
        errorMsg = 'Request timed out. Please try again.';
      } else if (err.message.includes('No coins found')) {
        errorMsg = 'No coins found in this locker';
      } else if (err.message) {
        errorMsg = err.message;
      }
      
      setError(errorMsg);
      setLoading(false);
      setProgress(0);
    }
  };

  const handleCreateMailbox = async () => {
    setLoading(true);
    setError('');
    setLoadingMessage('Creating your mailbox...');

    try {
      const result = await createMailbox(
        emailAddress,
        'qmail.giga',
        lockerCode,
        null
      );

      if (result.status === 'success') {
        setLoadingMessage('Mailbox created successfully!');
        setTimeout(() => {
          onSelectService('qmail');
        }, 1000);
      } else {
        setError(result.error || 'Failed to create mailbox');
        setLoading(false);
      }
    } catch (err) {
      let errorMsg = 'Failed to create mailbox. Please try again.';
      
      if (err.message.includes('already exists')) {
        errorMsg = 'This email address is already taken';
      } else if (err.message.includes('insufficient')) {
        errorMsg = 'Insufficient coins to create mailbox';
      } else if (err.message) {
        errorMsg = err.message;
      }
      
      setError(errorMsg);
      setLoading(false);
    }
  };

  const formatLockerCode = (value) => {
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleaned.length <= 3) return cleaned;
    return cleaned.slice(0, 3) + '-' + cleaned.slice(3, 8);
  };

  const handleLockerInputChange = (e) => {
    const formatted = formatLockerCode(e.target.value);
    setLockerCode(formatted);
    setError('');
  };

  const handleAddressInputChange = (e) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    setEmailAddress(value);
    setError('');
  };

  const isValidLockerCode = () => {
    const cleaned = lockerCode.replace(/-/g, '');
    return cleaned.length >= 7 && cleaned.length <= 8;
  };

  const isValidEmailAddress = () => {
    return emailAddress.length >= 3 && emailAddress.length <= 32;
  };

  const handleKeyPress = (e, action) => {
    if (e.key === 'Enter' && !loading) {
      action();
    }
  };

  const renderInitialScreen = () => (
    <div className="service-selection-buttons">
      <button
        onClick={() => setCurrentStep('locker-input')}
        className="service-button qmail"
      >
        <div className="service-button-content">
          <Download className="service-button-icon" size={24} />
          <span>I Have a Locker Code</span>
        </div>
      </button>

      <button
        onClick={() => window.open('https://www.distributedmailsystem.com/register', '_blank')}
        className="service-button wallet"
      >
        <div className="service-button-content">
          <ExternalLink className="service-button-icon" size={24} />
          <span>Buy Locker Code</span>
        </div>
      </button>
    </div>
  );

  const renderLockerInput = () => (
    <div className="locker-input-section">
      <div className="locker-code-label">Enter Your Locker Code</div>
      <input
        type="text"
        value={lockerCode}
        onChange={handleLockerInputChange}
        onKeyPress={(e) => handleKeyPress(e, handleLockerDownload)}
        placeholder="XXX-XXXXX"
        maxLength={9}
        className="locker-code-input"
        disabled={loading}
        autoFocus
      />
      
      {loading && (
        <div className="locker-progress">
          {progress > 0 && (
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          <span className="progress-text">{loadingMessage}</span>
        </div>
      )}
      
      {error && (
        <div className="locker-error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      
      <div className="locker-actions">
        <button
          onClick={handleLockerDownload}
          disabled={loading || !isValidLockerCode()}
          className="service-button qmail"
        >
          <div className="service-button-content">
            {loading ? (
              <>
                <Loader2 className="service-button-icon spinning" size={24} />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <ArrowRight className="service-button-icon" size={24} />
                <span>Continue</span>
              </>
            )}
          </div>
        </button>
        
        <button
          onClick={() => {
            setCurrentStep('initial');
            setLockerCode('');
            setError('');
            setProgress(0);
          }}
          className="service-button secondary"
          disabled={loading}
        >
          Back
        </button>
      </div>

      <div className="locker-help-text">
        Standard format: ABC-1234
      </div>
    </div>
  );

  const renderAddressInput = () => (
    <div className="locker-input-section">
      <div className="locker-code-label">Choose Your Email Address</div>
      <div className="email-input-wrapper">
        <input
          type="text"
          value={emailAddress}
          onChange={handleAddressInputChange}
          onKeyPress={(e) => handleKeyPress(e, handleCreateMailbox)}
          placeholder="yourname"
          maxLength={32}
          className="email-address-input"
          disabled={loading}
          autoFocus
        />
        <span className="email-domain">@qmail.giga</span>
      </div>
      
      {loading && (
        <div className="locker-progress">
          <span className="progress-text">{loadingMessage}</span>
        </div>
      )}
      
      {error && (
        <div className="locker-error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      
      <div className="locker-actions">
        <button
          onClick={handleCreateMailbox}
          disabled={loading || !isValidEmailAddress()}
          className="service-button qmail"
        >
          <div className="service-button-content">
            {loading ? (
              <>
                <Loader2 className="service-button-icon spinning" size={24} />
                <span>Creating...</span>
              </>
            ) : (
              <>
                <ArrowRight className="service-button-icon" size={24} />
                <span>Create Mailbox</span>
              </>
            )}
          </div>
        </button>
        
        <button
          onClick={() => {
            setCurrentStep('locker-input');
            setEmailAddress('');
            setError('');
          }}
          className="service-button secondary"
          disabled={loading}
        >
          Back
        </button>
      </div>

      <div className="locker-help-text">
        3-32 characters, letters, numbers, dots, underscores allowed
      </div>
    </div>
  );

  return (
    <div className="service-selection-screen">
      <div className="service-selection-container">
        <div className="service-icon-header">
          <Mail className="main-service-icon" size={64} />
        </div>
        
        <h1>Welcome to QMail</h1>
        <p>
          Experience the next generation of secure communication. 
          Quantum-resistant encryption protecting your digital legacy.
        </p>

        {currentStep === 'initial' && renderInitialScreen()}
        {currentStep === 'locker-input' && renderLockerInput()}
        {currentStep === 'address-input' && renderAddressInput()}
      </div>

      <div className="encrypted-envelopes">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="envelope-3d">
            <div className="envelope-body"></div>
            <div className="envelope-flap"></div>
            <Lock className="envelope-lock" size={28} />
            <div className="encryption-badge">
              <ShieldCheck size={18} />
            </div>
            <div className="encryption-particles">
              {[...Array(5)].map((_, j) => <div key={j} className="particle"></div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ServiceSelectionScreen;