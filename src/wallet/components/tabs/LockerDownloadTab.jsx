import React, { useState } from 'react';
import { pollTaskUntilComplete, downloadFromLocker } from '../../../api/apiService';
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

      // Use API message if available
      const apiMessage = downloadResult.message || 
                        downloadResult.data?.message || 
                        `Download started - Task ID: ${downloadResult.data.task_id}`;
      setStatusMessage(apiMessage);
      console.log('Download started:', downloadResult);

      // Poll for task completion
      const pollResult = await pollTaskUntilComplete(
        downloadResult.data.task_id,
        1000,
        (taskData) => {
          // Update progress during polling
          setProgress(taskData.progress || 0);
          // Use API status message if available
          const pollMessage = taskData.message || taskData.status || 'Processing...';
          setStatusMessage(pollMessage);
          console.log('Task progress:', taskData);
        }
      );

      if (!pollResult.success) {
        const pollError = pollResult.error || pollResult.message || 'Download polling failed';
        showError(pollError);
        throw new Error(pollError);
      }

      // Task completed successfully
      setProgress(100);
      
      // Use API completion message
      const completionMessage = pollResult.message || 
                               pollResult.data?.message || 
                               'Download completed successfully!';
      setStatusMessage(completionMessage);
      setTaskResult(pollResult.data);
      setShowResults(true);

      // Show success notification with API message
      if (pollResult.data?.data?.total_processed !== undefined) {
        const totalDownloaded = pollResult.data.data.total_processed;
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
      <div className="feature-placeholder">
        <p>Download CloudCoins from a RAIDA locker using your locker key.</p>
        
        {/* Locker Key Input */}
        <div className="memo-section">
          <label htmlFor="locker-key-input">
            Locker Key:
            <small style={{ display: 'block', fontWeight: 'normal', color: '#666' }}>
              8-character key in format ABC-1234 (e.g., AFG-7YTB)
            </small>
          </label>
          <input
            id="locker-key-input"
            type="text"
            value={lockerKey}
            onChange={(e) => setLockerKey(e.target.value.toUpperCase())}
            placeholder="e.g., AFG-7YTB"
            disabled={isProcessing}
            className="memo-input"
            maxLength={8}
            pattern="[A-Z]{3}-[A-Z0-9]{4}"
          />
          <small className="input-hint">
            Letters only: A-Z (excluding O, L, I), Numbers: 2-9 (excluding 0, 1)
          </small>
        </div>

        {/* Wallet Path Input */}
        <div className="memo-section">
          <label htmlFor="wallet-path-input">
            Destination Wallet Path:
            <small style={{ display: 'block', fontWeight: 'normal', color: '#666' }}>
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
            className="memo-input"
          />
        </div>

        {/* Download Button */}
        <div className="import-actions">
          <button 
            className="import-button" 
            onClick={handleDownload}
            disabled={isProcessing || !lockerKey.trim()}
          >
            {isProcessing ? 'Downloading...' : 'Download CloudCoins'}
          </button>
        </div>

        {/* Progress Section */}
        {isProcessing && (
          <div className="progress-section">
            <div className="progress-bar-container">
              <div 
                className="progress-bar" 
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="progress-text">{progress}%</p>
            <p className="status-message">{statusMessage}</p>
          </div>
        )}

        {/* Results Section with Close Button */}
        {taskResult && !isProcessing && showResults && (
          <div className="results-section">
            <div className="results-header">
              <h4>Download Results</h4>
              <button 
                className="results-close-button" 
                onClick={clearResults}
                title="Close results"
              >
                ✕
              </button>
            </div>
            <div className="results-grid">
              {taskResult.data && (
                <>
                  {taskResult.data.total_processed !== undefined && (
                    <div className="result-item">
                      <span className="result-label">Total Downloaded:</span>
                      <span className="result-value">{taskResult.data.total_processed}</span>
                    </div>
                  )}
                  {taskResult.data.total_value !== undefined && (
                    <div className="result-item success">
                      <span className="result-label">Total Value:</span>
                      <span className="result-value">{taskResult.data.total_value} CloudCoins</span>
                    </div>
                  )}
                  {taskResult.data.pown_results && (
                    <>
                      <div className="result-item success">
                        <span className="result-label">Authenticated (Bank):</span>
                        <span className="result-value">{taskResult.data.pown_results.bank}</span>
                      </div>
                      <div className="result-item warning">
                        <span className="result-label">Fracked:</span>
                        <span className="result-value">{taskResult.data.pown_results.fracked}</span>
                      </div>
                      <div className="result-item error">
                        <span className="result-label">Counterfeit:</span>
                        <span className="result-value">{taskResult.data.pown_results.counterfeit}</span>
                      </div>
                      {taskResult.data.pown_results.limbo > 0 && (
                        <div className="result-item">
                          <span className="result-label">Limbo:</span>
                          <span className="result-value">{taskResult.data.pown_results.limbo}</span>
                        </div>
                      )}
                    </>
                  )}
                  {taskResult.data.receipt_id && (
                    <div className="result-item">
                      <span className="result-label">Receipt ID:</span>
                      <span className="result-value receipt-id">{taskResult.data.receipt_id}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Status Message (when not processing) */}
        {!isProcessing && statusMessage && !taskResult && (
          <div className="status-section">
            <p className="status-message">{statusMessage}</p>
          </div>
        )}

        {/* Info Section */}
        <div className="info-section">
          <h4>How Locker Download Works</h4>
          <ul>
            <li><strong>Two-Phase Process:</strong> The system first peeks into the locker to see what's available, then downloads the coins with new authentication numbers.</li>
            <li><strong>Secure Transfer:</strong> Downloaded coins receive new authentication numbers for security.</li>
            <li><strong>Key Format:</strong> Use 8-character keys like "AFG-7YTB" - 3 letters, hyphen, then 4 alphanumeric characters.</li>
            <li><strong>One-Time Use:</strong> Once downloaded, the locker becomes empty and the key cannot be reused.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default LockerDownloadTab;