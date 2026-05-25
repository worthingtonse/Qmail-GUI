import { useState, useEffect } from 'react';
import { uploadToLocker, generateLockerCode, getWalletBalance } from '../../../api/apiService';
import { useNotification } from '../../../components/common/notifications/NotificationContext';
import './LockerTab.css';

const LockerUploadTab = () => {
  const [lockerKey, setLockerKey] = useState('');
  const [amount, setAmount] = useState('');
  const [walletPath, setWalletPath] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [taskResult, setTaskResult] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);

  // Use notifications directly
  const { showSuccess, showError, showInfo, showWarning } = useNotification();

  // Load wallet balance on component mount
  useEffect(() => {
    const loadBalance = async () => {
      try {
        const balanceResult = await getWalletBalance();
        if (balanceResult.success && balanceResult.data) {
          const totalBalance = balanceResult.data.total_balance || 0;
          setWalletBalance(totalBalance);
          showInfo(`Wallet balance loaded: ${totalBalance.toLocaleString()} CloudCoins`);
        } else {
          showWarning('Unable to load wallet balance. Using default value of 0.');
        }
      } catch (error) {
        console.error('Failed to load wallet balance:', error);
        showError(`Failed to load wallet balance: ${error.message}`);
      }
    };
    
    loadBalance();
  }, [showInfo, showWarning, showError]);

  // Generate a new locker key
  const handleGenerateKey = () => {
    setIsGeneratingKey(true);
    const newKey = generateLockerCode();
    setLockerKey(newKey);
    setStatusMessage(`New locker key generated: ${newKey}`);
    showInfo(`Generated new locker key: ${newKey}`);
    
    // BUG-13 FIX: Use functional updater to avoid stale closure
    setTimeout(() => {
      setStatusMessage((prev) => prev.includes('generated') ? '' : prev);
      setIsGeneratingKey(false);
    }, 3000);
  };

  // Clear results and reset form
  const clearResults = () => {
    setTaskResult(null);
    setShowResults(false);
    setStatusMessage('');
    setProgress(0);
    showInfo('Results cleared.');
  };

  // Quick amount buttons
  const handleQuickAmount = (value) => {
    if (typeof value === 'string') {
      if (value === 'all') {
        setAmount(walletBalance.toString());
        showInfo(`Set amount to all available balance: ${walletBalance.toLocaleString()}`);
      } else if (value === 'half') {
        const halfAmount = (walletBalance / 2).toFixed(2);
        setAmount(halfAmount);
        showInfo(`Set amount to half of balance: ${parseFloat(halfAmount).toLocaleString()}`);
      }
    } else {
      setAmount(value.toString());
      showInfo(`Set amount to ${value.toLocaleString()}`);
    }
  };

  // Validate amount input
  const validateAmount = (value) => {
    const num = parseFloat(value);
    return !isNaN(num) && num > 0 && num <= walletBalance;
  };

  // Handle upload process
  const handleUpload = async () => {
    if (!lockerKey.trim()) {
      showWarning('Please enter or generate a locker key.');
      return;
    }

    if (!amount.trim() || !validateAmount(amount)) {
      showWarning('Please enter a valid amount greater than 0 and not exceeding your wallet balance.');
      return;
    }

    try {
      setIsProcessing(true);
      setProgress(0);
      setStatusMessage('Starting upload to locker...');
      setTaskResult(null);
      setShowResults(false);

      const uploadAmount = parseFloat(amount);
      showInfo(`Starting upload of ${uploadAmount.toLocaleString()} coins to locker ${lockerKey.trim()}...`);

      // Call the upload API - PRESERVE ORIGINAL API CALL
      const finalWalletPath = walletPath.trim() || 'CloudCoin/Wallets/Default';
      const uploadResult = await uploadToLocker(lockerKey.trim(), uploadAmount, finalWalletPath);

      if (!uploadResult.success) {
        const apiError = uploadResult.error || uploadResult.message || 'Upload operation failed';
        showError(apiError);
        throw new Error(apiError);
      }

      setProgress(100);
      const completionMessage =
        uploadResult.data?.message || 'Upload completed successfully!';
      const normalizedResult = {
        data: {
          total_processed: uploadResult.data?.coins_uploaded,
          total_value: uploadResult.data?.amount_uploaded,
          receipt_id: uploadResult.data?.task_id || null,
          locker_key: uploadResult.data?.locker_key,
        },
      };

      setStatusMessage(completionMessage);
      setTaskResult(normalizedResult);
      setShowResults(true);

      if (normalizedResult.data.total_processed !== undefined) {
        const totalUploaded = normalizedResult.data.total_processed;
        showSuccess(`${completionMessage} - Uploaded ${totalUploaded} coins successfully!`);
      } else {
        showSuccess(completionMessage);
      }
      
      // Reload wallet balance
      try {
        const balanceResult = await getWalletBalance();
        if (balanceResult.success && balanceResult.data) {
          const newBalance = balanceResult.data.total_balance || 0;
          setWalletBalance(newBalance);
          showInfo(`Wallet balance updated: ${newBalance.toLocaleString()} CloudCoins`);
        }
      } catch (error) {
        console.error('Failed to reload wallet balance:', error);
      }
      
      // Clear form immediately after successful upload
      setAmount('');
      setWalletPath('');

    } catch (error) {
      console.error('Upload failed:', error);
      setStatusMessage(`Error: ${error.message}`);
      setTaskResult(null);
      // Error notification already shown above
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="tab-content">
      <h3>Upload to Locker</h3>
      <div className="feature-placeholder locker-tab">
        <p>Upload CloudCoins from your wallet to a RAIDA locker for secure transfer.</p>
        
        {/* Wallet Balance Display */}
        <div className="locker-tab__balance">
          <div className="locker-tab__balance-display">
            <span className="locker-tab__balance-label">Available Balance:</span>
            <span className="locker-tab__balance-value">{walletBalance.toLocaleString()} CloudCoins</span>
          </div>
        </div>

        {/* Locker Key Input */}
        <div className="locker-tab__field-group">
          <label htmlFor="locker-tab-key-input">
            Locker Key:
            <small className="locker-tab__field-hint">
              Generate a new key or enter your own 8-character key (ABC-1234 format)
            </small>
          </label>
          <div className="locker-tab__key-field">
            <input
              id="locker-tab-key-input"
              type="text"
              value={lockerKey}
              onChange={(e) => setLockerKey(e.target.value.toUpperCase())}
              placeholder="e.g., AFG-7YTB"
              disabled={isProcessing}
              className="locker-tab__key-input"
              maxLength={8}
              pattern="[A-Z]{3}-[A-Z0-9]{4}"
            />
            <button 
              className="btn btn--secondary locker-tab__generate-key-button"
              onClick={handleGenerateKey}
              disabled={isProcessing || isGeneratingKey}
              title="Generate a new random locker key"
            >
              {isGeneratingKey ? 'Generating...' : 'Generate New Key'}
            </button>
          </div>
          <small className="locker-tab__input-hint">
            Share this key with the recipient so they can download the coins
          </small>
        </div>

        {/* Amount Input */}
        <div className="locker-tab__field-group">
          <label htmlFor="amount-input">
            Amount to Upload:
            <small className="locker-tab__field-hint">
              Amount in CloudCoins (e.g., 100.25 or 1000)
            </small>
          </label>
          <div className="locker-tab__amount-field">
            <input
              id="amount-input"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g., 100.25"
              disabled={isProcessing}
              className="locker-tab__input"
              min="0.01"
              max={walletBalance}
              step="0.01"
            />
            <div className="locker-tab__quick-amounts">
              <button 
                className="locker-tab__quick-amount-button"
                onClick={() => handleQuickAmount(25)}
                disabled={isProcessing || walletBalance < 25}
                title="Set amount to 25"
              >
                25
              </button>
              <button 
                className="locker-tab__quick-amount-button"
                onClick={() => handleQuickAmount(100)}
                disabled={isProcessing || walletBalance < 100}
                title="Set amount to 100"
              >
                100
              </button>
              <button 
                className="locker-tab__quick-amount-button"
                onClick={() => handleQuickAmount(250)}
                disabled={isProcessing || walletBalance < 250}
                title="Set amount to 250"
              >
                250
              </button>
              <button 
                className="locker-tab__quick-amount-button"
                onClick={() => handleQuickAmount('half')}
                disabled={isProcessing || walletBalance <= 0}
                title="Set amount to half of balance"
              >
                Half
              </button>
              <button 
                className="locker-tab__quick-amount-button"
                onClick={() => handleQuickAmount('all')}
                disabled={isProcessing || walletBalance <= 0}
                title="Set amount to all available balance"
              >
                All
              </button>
            </div>
          </div>
          {amount && !validateAmount(amount) && (
            <small className="locker-tab__input-error">
              Amount must be between 0.01 and {walletBalance} CloudCoins
            </small>
          )}
        </div>

        {/* Source Wallet Path Input */}
        <div className="locker-tab__field-group">
          <label htmlFor="wallet-path-input">
            Source Wallet Path:
            <small className="locker-tab__field-hint">
              Where to take coins from (optional - defaults to CloudCoin/Wallets/Default)
            </small>
          </label>
          <input
            id="wallet-path-input"
            type="text"
            value={walletPath}
            onChange={(e) => setWalletPath(e.target.value)}
            placeholder="e.g., CloudCoin/Wallets/Default or C:\Your\Wallet\Path"
            disabled={isProcessing}
            className="locker-tab__input"
          />
        </div>

        {/* Upload Button */}
        <div className="locker-tab__actions">
          <button 
            className="btn btn--primary locker-tab__import-button locker-tab__import-button--upload"
            onClick={handleUpload}
            disabled={isProcessing || !lockerKey.trim() || !amount.trim() || !validateAmount(amount)}
          >
            {isProcessing ? 'Uploading...' : `Upload ${amount ? parseFloat(amount).toLocaleString() : '0'} CloudCoins`}
          </button>
        </div>

        {/* Progress Section */}
        {isProcessing && (
          <div className="locker-tab__progress">
            <div className="locker-tab__progress-track">
              <div 
                className="locker-tab__progress-bar"
                style={{ '--locker-tab-progress-width': `${progress}%` }}
              />
            </div>
            <p className="locker-tab__progress-text">{progress}%</p>
            <p className="locker-tab__status-message">{statusMessage}</p>
          </div>
        )}

        {/* Results Section with Close Button */}
        {taskResult && !isProcessing && showResults && (
          <div className="locker-tab__results">
            <div className="locker-tab__results-header">
              <h4>Upload Results</h4>
              <button 
                className="btn btn--danger locker-tab__close-button"
                onClick={clearResults}
                title="Close results"
              >
                ✕
              </button>
            </div>
            <div className="locker-tab__results-grid">
              {taskResult.data && (
                <>
                  <div className="locker-tab__result-item locker-tab__result-item--success">
                    <span className="locker-tab__result-label">Locker Key:</span>
                    <span className="locker-tab__result-value locker-tab__result-value--locker-key">{lockerKey}</span>
                  </div>
                  {taskResult.data.total_processed !== undefined && (
                    <div className="locker-tab__result-item">
                      <span className="locker-tab__result-label">Coins Uploaded:</span>
                      <span className="locker-tab__result-value">{taskResult.data.total_processed}</span>
                    </div>
                  )}
                  {taskResult.data.total_value !== undefined && (
                    <div className="locker-tab__result-item locker-tab__result-item--success">
                      <span className="locker-tab__result-label">Total Value:</span>
                      <span className="locker-tab__result-value">{taskResult.data.total_value} CloudCoins</span>
                    </div>
                  )}
                  {taskResult.data.receipt_id && (
                    <div className="locker-tab__result-item">
                      <span className="locker-tab__result-label">Receipt ID:</span>
                      <span className="locker-tab__result-value locker-tab__result-value--receipt">{taskResult.data.receipt_id}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="locker-tab__sharing">
              <h5>Share with Recipient:</h5>
              <div className="locker-tab__share-info">
                <p>Give this locker key to the person who should receive the coins:</p>
                <div className="locker-tab__share-key">
                  <code className="locker-tab__share-code">{lockerKey}</code>
                  <button 
                    className="btn btn--secondary locker-tab__copy-button"
                    onClick={() => {
                      navigator.clipboard.writeText(lockerKey);
                      showInfo(`Copied locker key ${lockerKey} to clipboard!`);
                    }}
                    title="Copy locker key to clipboard"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status Message (when not processing) */}
        {!isProcessing && statusMessage && !taskResult && (
          <div className="locker-tab__status">
            <p className="locker-tab__status-message locker-tab__status-message--error">{statusMessage}</p>
          </div>
        )}

        {/* Info Section */}
        <div className="locker-tab__info">
          <h4>How Locker Upload Works</h4>
          <ul>
            <li><strong>Secure Storage:</strong> Your CloudCoins are stored securely in the RAIDA network using your chosen locker key.</li>
            <li><strong>Share the Key:</strong> Give the locker key to the recipient so they can download the coins.</li>
            <li><strong>One-Time Use:</strong> Each locker key can only be used once. After download, the locker becomes empty.</li>
            <li><strong>No Expiration:</strong> Coins remain in the locker until downloaded or manually removed.</li>
            <li><strong>Key Format:</strong> Keys are 8 characters long in the format ABC-1234 for easy sharing.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LockerUploadTab;
