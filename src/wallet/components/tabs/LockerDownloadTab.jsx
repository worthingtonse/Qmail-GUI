import { useState } from 'react';
import { downloadFromLocker } from '../../../api/apiService';
import { useNotification } from '../../../components/common/notifications/NotificationContext';
import './LockerTab.css';

const LockerDownloadTab = () => {
  const [lockerKey, setLockerKey] = useState('');
  const [walletPath, setWalletPath] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [taskResult, setTaskResult] = useState(null);
  const [showResults, setShowResults] = useState(false);

  // Use notifications directly
  const { showSuccess, showError, showInfo, showWarning } = useNotification();

  // Clear results and reset form
  const clearResults = () => {
    setTaskResult(null);
    setShowResults(false);
    setStatusMessage('');
    setProgress(0);
    showInfo('Results cleared.');
  };

  // Handle download process
  const handleDownload = async () => {
    if (!lockerKey.trim()) {
      showWarning('Please enter a locker key.');
      return;
    }

    try {
      setIsProcessing(true);
      setProgress(0);
      setStatusMessage('Starting download from locker...');
      setTaskResult(null);
      setShowResults(false);

      showInfo(`Starting download from locker ${lockerKey.trim()}...`);

      // Call the download API - PRESERVE ORIGINAL API CALL
      const finalWalletPath = walletPath.trim() || 'CloudCoin/Wallets/Default';
      const downloadResult = await downloadFromLocker(lockerKey.trim(), finalWalletPath);

      if (!downloadResult.success) {
        const apiError = downloadResult.error || downloadResult.message || 'Download operation failed';
        showError(apiError);
        throw new Error(apiError);
      }

      setProgress(100);
      const completionMessage =
        downloadResult.data?.message || 'Download completed successfully!';
      const normalizedResult = {
        data: {
          total_processed: downloadResult.data?.coins_saved,
          total_value: downloadResult.data?.total_value,
          pown_results: {
            bank: downloadResult.data?.graded_to_bank || 0,
            fracked: downloadResult.data?.graded_to_fracked || 0,
            counterfeit: downloadResult.data?.graded_to_counterfeit || 0,
            limbo: 0,
          },
          receipt_id: downloadResult.data?.task_id || null,
          coins_found: downloadResult.data?.coins_found,
          raida_success: downloadResult.data?.raida_success,
        },
      };

      setStatusMessage(completionMessage);
      setTaskResult(normalizedResult);
      setShowResults(true);

      if (normalizedResult.data.total_processed !== undefined) {
        const totalDownloaded = normalizedResult.data.total_processed;
        showSuccess(`${completionMessage} - Downloaded ${totalDownloaded} coins successfully!`);
      } else {
        showSuccess(completionMessage);
      }
      
      // Clear form immediately after successful download
      setLockerKey('');
      setWalletPath('');

    } catch (error) {
      console.error('Download failed:', error);
      setStatusMessage(`Error: ${error.message}`);
      setTaskResult(null);
      // Error notification already shown above
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="tab-content">
      <h3>Download from Locker</h3>
      <div className="feature-placeholder locker-tab">
        <p>Download CloudCoins from a RAIDA locker using your locker key.</p>
        
        {/* Locker Key Input */}
        <div className="locker-tab__field-group">
          <label htmlFor="locker-tab-key-input">
            Locker Key:
            <small className="locker-tab__field-hint">
              8-character key in format ABC-1234 (e.g., AFG-7YTB)
            </small>
          </label>
          <input
            id="locker-tab-key-input"
            type="text"
            value={lockerKey}
            onChange={(e) => setLockerKey(e.target.value.toUpperCase())}
            placeholder="e.g., AFG-7YTB"
            disabled={isProcessing}
            className="locker-tab__input"
            maxLength={8}
            pattern="[A-Z]{3}-[A-Z0-9]{4}"
          />
          <small className="locker-tab__input-hint">
            Letters only: A-Z (excluding O, L, I), Numbers: 2-9 (excluding 0, 1)
          </small>
        </div>

        {/* Wallet Path Input */}
        <div className="locker-tab__field-group">
          <label htmlFor="wallet-path-input">
            Destination Wallet Path:
            <small className="locker-tab__field-hint">
              Where to store downloaded coins (optional - defaults to CloudCoin/Wallets/Default)
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

        {/* Download Button */}
        <div className="locker-tab__actions">
          <button 
            className="btn btn--success locker-tab__import-button"
            onClick={handleDownload}
            disabled={isProcessing || !lockerKey.trim()}
          >
            {isProcessing ? 'Downloading...' : 'Download CloudCoins'}
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
              <h4>Download Results</h4>
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
                  {taskResult.data.total_processed !== undefined && (
                    <div className="locker-tab__result-item">
                      <span className="locker-tab__result-label">Total Downloaded:</span>
                      <span className="locker-tab__result-value">{taskResult.data.total_processed}</span>
                    </div>
                  )}
                  {taskResult.data.total_value !== undefined && (
                    <div className="locker-tab__result-item locker-tab__result-item--success">
                      <span className="locker-tab__result-label">Total Value:</span>
                      <span className="locker-tab__result-value">{taskResult.data.total_value} CloudCoins</span>
                    </div>
                  )}
                  {taskResult.data.pown_results && (
                    <>
                      <div className="locker-tab__result-item locker-tab__result-item--success">
                        <span className="locker-tab__result-label">Authenticated (Bank):</span>
                        <span className="locker-tab__result-value">{taskResult.data.pown_results.bank}</span>
                      </div>
                      <div className="locker-tab__result-item locker-tab__result-item--warning">
                        <span className="locker-tab__result-label">Fracked:</span>
                        <span className="locker-tab__result-value">{taskResult.data.pown_results.fracked}</span>
                      </div>
                      <div className="locker-tab__result-item locker-tab__result-item--error">
                        <span className="locker-tab__result-label">Counterfeit:</span>
                        <span className="locker-tab__result-value">{taskResult.data.pown_results.counterfeit}</span>
                      </div>
                      {taskResult.data.pown_results.limbo > 0 && (
                        <div className="locker-tab__result-item">
                          <span className="locker-tab__result-label">Limbo:</span>
                          <span className="locker-tab__result-value">{taskResult.data.pown_results.limbo}</span>
                        </div>
                      )}
                    </>
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
          <h4>How Locker Download Works</h4>
          <ul>
            <li><strong>Two-Phase Process:</strong> The system first peeks into the locker to see what&apos;s available, then downloads the coins with new authentication numbers.</li>
            <li><strong>Secure Transfer:</strong> Downloaded coins receive new authentication numbers for security.</li>
            <li><strong>Key Format:</strong> Use 8-character keys like &quot;AFG-7YTB&quot; - 3 letters, hyphen, then 4 alphanumeric characters.</li>
            <li><strong>One-Time Use:</strong> Once downloaded, the locker becomes empty and the key cannot be reused.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LockerDownloadTab;
