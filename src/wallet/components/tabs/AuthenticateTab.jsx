import React, { useState, useRef } from 'react';
import { pollTaskUntilComplete, importCloudCoinFiles, runPostImportHealthChecks } from '../../../api/apiService';
import { useNotification } from '../../../components/common/notifications/NotificationContext';
import './AuthenticateTab.css';

const AuthenticateTab = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [memo, setMemo] = useState('');
  const [walletPath, setWalletPath] = useState('');
  const [fileDirectory, setFileDirectory] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [taskResult, setTaskResult] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const fileInputRef = useRef(null);

  // Use notifications directly (no wrapper functions)
  const { showSuccess, showError, showInfo, showWarning } = useNotification();

  // Handle file selection from file picker
  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  // Handle file input change
  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
  };

  // Add files to the selected files list
  const addFiles = (files) => {
    // Filter for valid CloudCoin file extensions
    const validExtensions = ['.bin', '.png'];
    const validFiles = files.filter(file => {
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      return validExtensions.includes(ext);
    });

    if (validFiles.length < files.length) {
      // Replace alert with notification
      showWarning(`Some files were skipped. Only .bin and .png files are supported.`);
    }

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      showInfo(`Added ${validFiles.length} file${validFiles.length > 1 ? 's' : ''} to import queue.`);
    }
  };

  // Remove a file from the selected list
  const removeFile = (index) => {
    const fileName = selectedFiles[index]?.name;
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    showInfo(`Removed "${fileName}" from import queue.`);
  };

  // Clear all selected files
  const clearFiles = () => {
    const fileCount = selectedFiles.length;
    setSelectedFiles([]);
    showInfo(`Cleared ${fileCount} file${fileCount > 1 ? 's' : ''} from import queue.`);
  };

  // Clear results and reset form
  const clearResults = () => {
    setTaskResult(null);
    setShowResults(false);
    setStatusMessage('');
    setProgress(0);
    showInfo('Results cleared.');
  };

  // Handle drag over event
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  // Handle drag leave event
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // Handle file drop event
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files || []);
    addFiles(files);
  };

  // Handle import process - KEEPING YOUR ORIGINAL STRUCTURE
  const handleImport = async () => {
    if (selectedFiles.length === 0) {
      // Replace alert with notification
      showWarning('Please select at least one file to import.');
      return;
    }

    try {
      setIsProcessing(true);
      setProgress(0);
      setStatusMessage('Starting import...');
      setTaskResult(null);

      // Get file paths from selected files
      // Note: Browser File API doesn't give full paths for security reasons
      // We use the user-specified directory combined with the file names
      const filePaths = selectedFiles.map(file => {
        // If your files have a path property (e.g., from Electron), use it
        // Otherwise, combine the directory path with the file name
        if (file.path) {
          return file.path;
        }
        
        // Smart path expansion will be handled by the API
        // Just combine directory with filename here
        let directory = fileDirectory.trim();
        if (!directory) {
          // Default to Downloads if no directory specified
          directory = 'Downloads';
        }
        
        // Ensure proper path separator for combining
        if (!directory.endsWith('\\') && !directory.endsWith('/')) {
          directory += '\\';
        }
        return `${directory}${file.name}`;
      });

      // Show info notification
      showInfo(`Starting import of ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}...`);

      // Call the import API - EXACT SAME AS YOUR ORIGINAL
      const finalWalletPath = walletPath.trim() || 'CloudCoin/Wallets/Default';
      const importResult = await importCloudCoinFiles(filePaths, memo, finalWalletPath);

      if (!importResult.success) {
        // Show API error message
        const apiError = importResult.error || 'Import operation failed';
        showError(apiError);
        throw new Error(apiError);
      }

      // Use API message if available
      const apiMessage = importResult.message || 
                        importResult.data?.message || 
                        `Import started - Task ID: ${importResult.data.task_id}`;
      setStatusMessage(apiMessage);
      console.log('Import started:', importResult);

      // Poll for task completion
      const pollResult = await pollTaskUntilComplete(
        importResult.data.task_id,
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
        // Show API error message
        const pollError = pollResult.error || pollResult.message || 'Task polling failed';
        showError(pollError);
        throw new Error(pollError);
      }

      // Task completed successfully
      setProgress(100);
      
      // Use API completion message
      const completionMessage = pollResult.message || 
                               pollResult.data?.message || 
                               'Import completed successfully!';
      setStatusMessage(completionMessage);
      setTaskResult(pollResult.data);
      setShowResults(true); // Show the results section
      
      // Show success notification with API message
      if (pollResult.data?.data?.pown_results) {
        const results = pollResult.data.data.pown_results;
        const totalAuthenticated = results.bank || 0;
        const totalProcessed = pollResult.data.data.total_processed || 0;
        
        showSuccess(`${completionMessage} - Processed: ${totalProcessed}, Authenticated: ${totalAuthenticated}`);
      } else {
        showSuccess(completionMessage);
      }

      // Run post-import health checks immediately after successful import
      try {
        setStatusMessage('Running post-import health checks...');
        showInfo('Running encryption health checks and repairs...');
        
        const healthResult = await runPostImportHealthChecks();
        
        console.log('Health check result:', healthResult);
        
        if (healthResult.success) {
          console.log('Post-import health checks completed successfully:', healthResult);
          
          // Check if both health check and repair were successful
          const healthSuccess = healthResult.data?.healthCheck?.success !== false;
          const repairSuccess = healthResult.data?.repair?.success !== false;
          
          if (healthSuccess && repairSuccess) {
            showSuccess('✅ Health checks and encryption repairs completed successfully!');
            setStatusMessage('Import and health checks completed successfully!');
          } else {
            const healthError = healthResult.data?.healthCheck?.error || '';
            const repairError = healthResult.data?.repair?.error || '';
            const combinedError = [healthError, repairError].filter(Boolean).join('; ');
            
            showWarning(`⚠️ Health checks completed with warnings: ${combinedError || 'Some operations failed'}`);
            setStatusMessage(`Import completed, but health checks had warnings: ${combinedError}`);
          }
        } else {
          console.error('Post-import health checks failed:', healthResult.error);
          showError(`❌ Health check failed: ${healthResult.error || 'Unknown error during health checks'}`);
          setStatusMessage(`Import completed, but health checks failed: ${healthResult.error}`);
        }
      } catch (healthError) {
        console.error('Exception during post-import health checks:', healthError);
        showError(`❌ Health check exception: ${healthError.message || 'Unknown error during health checks'}`);
        setStatusMessage(`Import completed, but health checks failed: ${healthError.message}`);
      }
      
      // Clear form immediately after successful import and health checks
      setSelectedFiles([]);
      setMemo('');
      setFileDirectory('');
      setWalletPath('');

    } catch (error) {
      console.error('Import failed:', error);
      setStatusMessage(`Error: ${error.message}`);
      setTaskResult(null);
      // Error notification already shown above
    } finally {
      setIsProcessing(false);
    }
  };

  // Format file size for display
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="tab-content">
      <h3>Authenticate CloudCoins</h3>
      <div className="feature-placeholder">
        <p>Upload CloudCoin files to authenticate them with RAIDA servers.</p>
        
        {/* Drag and Drop Area */}
        <div className="upload-area">
          <div 
            className={`upload-box ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <span className="upload-icon">☁️</span>
            <p className="upload-text">Drag and drop CloudCoin files here</p>
            <p className="upload-subtext">or</p>
            <button 
              className="browse-button" 
              onClick={handleFileSelect}
              disabled={isProcessing}
            >
              Browse Files
            </button>
            <p className="upload-info">Supported: .bin, .png</p>
          </div>
          
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".bin,.png"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />
        </div>

        {/* Selected Files List */}
        {selectedFiles.length > 0 && (
          <div className="selected-files">
            <div className="selected-files-header">
              <h4>Selected Files ({selectedFiles.length})</h4>
              <button 
                className="clear-button" 
                onClick={clearFiles}
                disabled={isProcessing}
              >
                Clear All
              </button>
            </div>
            <div className="files-list">
              {selectedFiles.map((file, index) => (
                <div key={index} className="file-item">
                  <div className="file-info">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatFileSize(file.size)}</span>
                  </div>
                  <button 
                    className="remove-button" 
                    onClick={() => removeFile(index)}
                    disabled={isProcessing}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File Directory Input */}
        {selectedFiles.length > 0 && (
          <div className="memo-section">
            <label htmlFor="file-directory-input">
              Files Directory:
              <small style={{ display: 'block', fontWeight: 'normal', color: '#666' }}>
                Where your CloudCoin files are located (e.g., Downloads, Documents, or C:\Your\Custom\Path)
              </small>
            </label>
            <input
              id="file-directory-input"
              type="text"
              value={fileDirectory}
              onChange={(e) => setFileDirectory(e.target.value)}
              placeholder="e.g., Downloads, testcoins, or C:\Your\Files\Path"
              disabled={isProcessing}
              className="memo-input"
            />
          </div>
        )}

        {/* Memo Input */}
        {selectedFiles.length > 0 && (
          <div className="memo-section">
            <label htmlFor="memo-input">Transaction Memo (Optional):</label>
            <input
              id="memo-input"
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Enter a memo for this import..."
              disabled={isProcessing}
              className="memo-input"
            />
          </div>
        )}

        {/* Wallet Path Input */}
        {selectedFiles.length > 0 && (
          <div className="memo-section">
            <label htmlFor="wallet-path-input">
              Wallet Path:
              <small style={{ display: 'block', fontWeight: 'normal', color: '#666' }}>
                Where to store authenticated coins (e.g., CloudCoin/Wallets/Default or C:\Your\Wallet\Path)
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
        )}

        {/* Import Button */}
        {selectedFiles.length > 0 && (
          <div className="import-actions">
            <button 
              className="import-button" 
              onClick={handleImport}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : `Import ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''}`}
            </button>
          </div>
        )}

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

        {/* Results Section */}
        {taskResult && !isProcessing && showResults && (
          <div className="results-section">
            <div className="results-header">
              <h4>Import Results</h4>
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
                      <span className="result-label">Total Processed:</span>
                      <span className="result-value">{taskResult.data.total_processed}</span>
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
      </div>
    </div>
  );
};

export default AuthenticateTab;