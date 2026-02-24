import React, { useState } from 'react';
import { Mail, ArrowRight, Lock, ShieldCheck, Download, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { importCredentials } from '../api/qmailApiServices';
import './ServiceSelectionScreen.css';

const ServiceSelectionScreen = ({ onSelectService }) => {
  const [currentStep, setCurrentStep] = useState('initial'); // initial, locker-input, address-input
  const [lockerCode, setLockerCode] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');

  
 const handleImport = async () => {
  setLoading(true);
  setError('');
  setLoadingMessage('Connecting to RAIDA servers...');

  try {
    const result = await importCredentials(lockerCode);
    
    if (result.success) {
      setLoadingMessage('Credentials imported successfully!');
      setTimeout(() => {
        // Pass 'qmail' as the service and the result.data for provisioning
        onSelectService('qmail', result.data); 
      }, 1000);
    } else {
      setError(result.error || 'Locker is empty or invalid');
      setLoading(false);
    }
  } catch (err) {
    setError(err.message || 'Failed to connect. Please try again.');
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

  const isValidLockerCode = () => {
    const cleaned = lockerCode.replace(/-/g, '');
    return cleaned.length >= 7 && cleaned.length <= 8;
  };

  const renderInitialScreen = () => (
    <div className="service-selection-buttons">
      <button onClick={() => setCurrentStep('locker-input')} className="service-button qmail">
        <div className="service-button-content">
          <Download className="service-button-icon" size={24} />
          <span>I Have a Locker Code</span>
        </div>
      </button>

      <button onClick={() => window.open('https://www.distributedmailsystem.com/register', '_blank')} className="service-button wallet">
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
        onKeyPress={(e) => e.key === 'Enter' && !loading && handleImport()}
        placeholder="XXX-XXXXX"
        maxLength={9}
        className="locker-code-input"
        disabled={loading}
        autoFocus
      />
      
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
          onClick={handleImport}
          disabled={loading || !isValidLockerCode()}
          className="service-button qmail"
        >
          <div className="service-button-content">
            {loading ? (
              <>
                <Loader2 className="service-button-icon spinning" size={24} />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <ArrowRight className="service-button-icon" size={24} />
                <span>Continue</span>
              </>
            )}
          </div>
        </button>
        
        <button onClick={() => { setCurrentStep('initial'); setLockerCode(''); setError(''); }} className="service-button secondary" disabled={loading}>
          Back
        </button>
      </div>
      <div className="locker-help-text">Standard format: ABC-1234</div>
    </div>
  );

  return (
    <div className="service-selection-screen">
      <div className="service-selection-container">
        <div className="service-icon-header">
          <Mail className="main-service-icon" size={64} />
        </div>
        <h1>Welcome to QMail</h1>
        <p>Experience the next generation of secure communication. Quantum-resistant encryption protecting your digital legacy.</p>
        {currentStep === 'initial' && renderInitialScreen()}
        {currentStep === 'locker-input' && renderLockerInput()}
      </div>

      <div className="encrypted-envelopes">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="envelope-3d">
            <div className="envelope-body"></div>
            <div className="envelope-flap"></div>
            <Lock className="envelope-lock" size={28} />
            <div className="encryption-badge"><ShieldCheck size={18} /></div>
            <div className="encryption-particles">{[...Array(5)].map((_, j) => <div key={j} className="particle"></div>)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ServiceSelectionScreen;