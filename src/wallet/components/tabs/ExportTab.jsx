import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Wrench, X, Info } from 'lucide-react';
import { exportCloudCoins, getWalletBalance, fixFrackedCoins, getDropdownData, saveExportLocation, listWallets } from '../../../api/apiService';
import { useNotification } from '../../../components/common/notifications/NotificationContext';
import './ExportTab.css';

const ExportTab = () => {
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [exportLocations, setExportLocations] = useState([
    'Downloads', 
    'Documents',
    'Desktop',
    'Export'
  ]);
  const [availableWallets, setAvailableWallets] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [taskResult, setTaskResult] = useState(null);
  const [showResults, setShowResults] = useState(false);
  
  // Fix modal state
  const [showFixModal, setShowFixModal] = useState(false);
  const [frackedCount, setFrackedCount] = useState(0);
  const [isFixing, setIsFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);

  // Use notifications directly
  const { showSuccess, showError, showInfo, showWarning } = useNotification();

  // Load export locations and available wallets when component mounts
  useEffect(() => {
    loadExportLocations();
    loadAvailableWallets();
    checkForFrackedCoins();
    // Export tab bootstrap intentionally runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle click outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownOpen && !event.target.closest('.export-tab__dropdown')) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);

  // Clear results and reset form
  const clearResults = () => {
    setTaskResult(null);
    setShowResults(false);
    setStatusMessage('');
    setProgress(0);
    showInfo('Results cleared.');
  };

  // Load available wallets
  const loadAvailableWallets = async () => {
    try {
      setWalletsLoading(true);
      
      const result = await listWallets();
      
      if (result.success && result.data && Array.isArray(result.data)) {
        const processedWallets = result.data.map(wallet => {
          const walletName = wallet.name || wallet.wallet_name || 'Unknown';
          const walletPath = wallet.path || `./Data/Wallets/${walletName}`;
          
          return {
            name: walletName,
            path: walletPath
          };
        });
        
        setAvailableWallets(processedWallets);
        
        if (processedWallets.length > 0) {
          setSelectedWallet(processedWallets[0]);
        }

        // Only show notification if there are multiple wallets or user explicitly requests it
        // Remove automatic notification to prevent duplicates
        // showInfo(`Loaded ${processedWallets.length} wallet${processedWallets.length > 1 ? 's' : ''}.`);
      } else {
        const fallbackWallet = {
          name: 'Default',
          path: './Data/Wallets/Default'
        };
        setAvailableWallets([fallbackWallet]);
        setSelectedWallet(fallbackWallet);
        showWarning('No wallets found, using default wallet.');
      }
    } catch (error) {
      console.error('Error loading wallets:', error);
      const fallbackWallet = {
        name: 'Default',
        path: './Data/Wallets/Default'
      };
      setAvailableWallets([fallbackWallet]);
      setSelectedWallet(fallbackWallet);
      showError(`Error loading wallets: ${error.message}`);
    } finally {
      setWalletsLoading(false);
    }
  };

  // Load export locations from configuration
  const loadExportLocations = async () => {
    try {
      const result = await getDropdownData('export-locations.txt');
      if (result.success && result.data.items) {
        // Common folder suggestions that users can modify
        const commonPaths = [
          'Downloads', 
          'Documents',
          'Desktop',
          'CloudCoin',
          'Export'
        ];
        const locations = result.data.items.length > 0 ? result.data.items : commonPaths;
        setExportLocations(locations);
        
        // Set the first location as default if available
        if (locations.length > 0) {
          setDestination(locations[0]);
        }
      }
    } catch (error) {
      console.error('Error loading export locations:', error);
      // Fallback to default common folder names
      setExportLocations([
        'Downloads', 
        'Documents',
        'Desktop',
        'CloudCoin',
        'Export'
      ]);
    }
  };

  // Save export location if it's new
  const saveCurrentExportLocation = async (location) => {
    try {
      if (location && location.trim() && !exportLocations.includes(location)) {
        const result = await saveExportLocation(location.trim());
        if (result.success) {
          // Update local state to include the new location
          setExportLocations(prev => [location.trim(), ...prev]);
          showInfo(`Added "${location.trim()}" to export locations.`);
        }
      }
    } catch (error) {
      console.error('Error saving export location:', error);
    }
  };

  // Check wallet balance for fracked coins
  const checkForFrackedCoins = async () => {
    try {
      const balanceResult = await getWalletBalance();
      if (balanceResult.success && balanceResult.data && balanceResult.data[0]) {
        const walletData = balanceResult.data[0];
        if (walletData.folders && walletData.folders.fracked_coins > 0) {
          setFrackedCount(walletData.folders.fracked_coins);
          setShowFixModal(true);
          showWarning(`${walletData.folders.fracked_coins} fracked coins detected. Consider fixing them.`);
        }
      }
    } catch (error) {
      console.error('Error checking for fracked coins:', error);
    }
  };

  // Handle fix process in modal
  const handleFix = async () => {
    setIsFixing(true);
    setFixResult(null);

    try {
      showInfo('Starting coin healing process...');
      
      const result = await fixFrackedCoins();
      
      if (result.success) {
        setFixResult(result.data);
        const apiMessage = result.message || result.data?.message || 'Fix operation completed successfully!';
        showSuccess(apiMessage);
        
        // Recheck fracked coins after successful fix
        setTimeout(() => {
          checkForFrackedCoins();
        }, 2000);
      } else {
        const apiError = result.error || result.message || 'Fix operation failed';
        setFixResult({ error: apiError });
        showError(apiError);
      }
    } catch (error) {
      console.error('Fix operation error:', error);
      setFixResult({ error: error.message });
      showError(`Fix operation failed: ${error.message}`);
    } finally {
      setIsFixing(false);
    }
  };

  // Close fix modal
  const closeFixModal = () => {
    setShowFixModal(false);
    setFixResult(null);
  };

  // Handle export process
  const handleExport = async () => {
    const exportAmount = parseInt(amount);
    
    if (!amount || exportAmount <= 0) {
      showWarning('Please enter a valid amount to export.');
      return;
    }

    if (!selectedWallet || !selectedWallet.path) {
      showWarning('Please select a wallet to export from.');
      return;
    }

    if (!destination || !destination.trim()) {
      showWarning('Please enter a destination path where the exported CloudCoins should be saved.');
      return;
    }

    try {
      setIsProcessing(true);
      setProgress(0);
      setStatusMessage('Starting export...');
      setTaskResult(null);
      setShowResults(false);

      // Save the export location if it's new
      await saveCurrentExportLocation(destination);

      showInfo(`Starting export of ${exportAmount} coins from ${selectedWallet.name}...`);
      console.log('Exporting from wallet:', selectedWallet.name, 'at path:', selectedWallet.path);

      // Step 1: Call export endpoint with selected wallet path - PRESERVE ORIGINAL API CALL
      const exportResult = await exportCloudCoins(exportAmount, destination, selectedWallet.path);

      if (!exportResult.success) {
        const apiError = exportResult.error || exportResult.message || 'Export operation failed';
        showError(apiError);
        throw new Error(apiError);
      }

      setProgress(100);
      const completionMessage =
        exportResult.data?.message || 'Export completed successfully!';
      const normalizedResult = {
        data: {
          amount: exportResult.data?.amount,
          exported: exportResult.data?.coins_exported,
          exported_value: exportResult.data?.amount,
          filename: exportResult.data?.files?.[0] || null,
          file_path: exportResult.data?.files?.[0] || null,
          destination: exportResult.data?.destination,
          transaction_id: exportResult.data?.task_id || null,
          files_created: exportResult.data?.files_created,
          files: exportResult.data?.files || [],
        },
      };

      setStatusMessage(completionMessage);
      setTaskResult(normalizedResult);
      setShowResults(true);

      if (normalizedResult.data.exported !== undefined) {
        const exported = normalizedResult.data.exported;
        showSuccess(`${completionMessage} - Exported ${exported} coins successfully!`);
      } else {
        showSuccess(completionMessage);
      }
      
      // Clear form immediately after successful export
      setAmount('');
      setDestination(exportLocations[0] || 'Export');

    } catch (error) {
      console.error('Export failed:', error);
      setStatusMessage(`Error: ${error.message}`);
      setTaskResult(null);
      // Error notification already shown above
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="tab-content">
      <h3>Export CloudCoins</h3>
      <div className="feature-placeholder export-tab">
        <p>Export CloudCoins from your active wallet to a destination folder for sharing or transfer.</p>
        
        {/* Export Form */}
        <div className="export-tab__form">
           {/* Wallet Selector */}
        <div className="export-tab__field">
          <label htmlFor="wallet-select" className="export-tab__label">
            Select Wallet to Export From
            <span className="export-tab__required">*</span>
            <div className="export-tab__tooltip">
              <Info size={16} className="export-tab__info-icon" />
              <span className="export-tab__tooltip-text">Choose which wallet to export CloudCoins from</span>
            </div>
          </label>
          
          {/* Custom Dropdown */}
          <div className="export-tab__dropdown">
            <button
              type="button"
              className={`export-tab__dropdown-trigger ${walletsLoading || isProcessing ? 'export-tab__dropdown-trigger--disabled' : ''}`}
              onClick={() => setDropdownOpen(!dropdownOpen)}
              disabled={walletsLoading || isProcessing}
            >
              {walletsLoading ? (
                'Loading wallets...'
              ) : selectedWallet ? (
                selectedWallet.name
              ) : (
                'Select a wallet...'
              )}
              <svg 
                className={`export-tab__dropdown-arrow ${dropdownOpen ? 'export-tab__dropdown-arrow--open' : ''}`} 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
              >
                <polyline points="6,9 12,15 18,9"></polyline>
              </svg>
            </button>
            
            {dropdownOpen && !walletsLoading && (
              <div className="export-tab__dropdown-options">
                {availableWallets.map((wallet, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`export-tab__dropdown-option ${selectedWallet?.name === wallet.name ? 'export-tab__dropdown-option--selected' : ''}`}
                    onClick={() => {
                      setSelectedWallet(wallet);
                      setDropdownOpen(false);
                      showInfo(`Selected wallet: ${wallet.name}`);
                      console.log('Selected wallet:', wallet);
                    }}
                  >
                    {wallet.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
          {/* Amount Input */}
          <div className="export-tab__field">
            <label htmlFor="amount-input" className="export-tab__label">
              Amount to Export
              <span className="export-tab__required">*</span>
              <div className="export-tab__tooltip">
                <Info size={16} className="export-tab__info-icon" />
                <span className="export-tab__tooltip-text">Enter the number of CloudCoin units to export</span>
              </div>
            </label>
            <input
              id="amount-input"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount (e.g., 100, 250)"
              disabled={isProcessing}
              className="export-tab__amount-input"
            />
          </div>

          {/* Destination Input with Dropdown */}
          <div className="export-tab__field">
            <label htmlFor="destination-input" className="export-tab__label">
              Destination Folder
              <div className="export-tab__tooltip">
                <Info size={16} className="export-tab__info-icon" />
                <span className="export-tab__tooltip-text">
                  Enter destination path for exported files:
                  • Full paths: C:\Users\YourName\Documents, D:\Exports
                  • Folder names: Downloads, Documents, Desktop (auto-expanded)
                  • Custom paths: Any valid directory path
                </span>
              </div>
            </label>
            <div className="export-tab__destination-wrap">
              <input
                id="destination-input"
                type="text"
                list="export-locations"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g., Downloads, Documents, or C:\Your\Custom\Path"
                disabled={isProcessing}
                className="export-tab__destination-input"
              />
              <datalist id="export-locations">
                {exportLocations.map((location, index) => (
                  <option key={index} value={location} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Export Button */}
          <div className="export-tab__actions">
            <button 
              className="export-tab__submit-button" 
              onClick={handleExport}
              disabled={isProcessing || !amount || !selectedWallet || !destination.trim()}
            >
              {isProcessing ? 'Processing...' : 'Export CloudCoins'}
            </button>
          </div>
        </div>

        {/* Progress Section */}
        {isProcessing && (
          <div className="export-tab__progress">
            <div className="export-tab__progress-header">
              <h4 className="export-tab__progress-heading">Exporting CloudCoins</h4>
              <span className="export-tab__progress-percentage">{progress}%</span>
            </div>
            <div className="export-tab__progress-track">
              <div 
                className="export-tab__progress-bar" 
                style={{ '--export-tab-progress-width': `${progress}%` }}
              />
            </div>
            <p className="export-tab__status-message">{statusMessage}</p>
          </div>
        )}

        {/* Results Section with Close Button */}
        {taskResult && !isProcessing && showResults && (
          <div className="export-tab__results">
            <div className="export-tab__results-header">
              <div className="export-tab__results-title">
                <CheckCircle size={24} className="export-tab__results-icon" />
                <h4 className="export-tab__results-heading">Export Results</h4>
              </div>
              <button 
                className="export-tab__close-button" 
                onClick={clearResults}
                title="Close results"
              >
                ✕
              </button>
            </div>
            <div className="export-tab__results-grid">
              {taskResult.data && (
                <>
                  {taskResult.data.amount !== undefined && (
                    <div className="export-tab__result-item">
                      <span className="export-tab__result-label">Amount Requested:</span>
                      <span className="export-tab__result-value">{taskResult.data.amount}</span>
                    </div>
                  )}
                  {taskResult.data.exported !== undefined && (
                    <div className="export-tab__result-item export-tab__result-item--success">
                      <span className="export-tab__result-label">Coins Exported:</span>
                      <span className="export-tab__result-value">{taskResult.data.exported}</span>
                    </div>
                  )}
                  {taskResult.data.exported_value !== undefined && (
                    <div className="export-tab__result-item export-tab__result-item--success">
                      <span className="export-tab__result-label">Total Value Exported:</span>
                      <span className="export-tab__result-value">{taskResult.data.exported_value}</span>
                    </div>
                  )}
                  {taskResult.data.filename && (
                    <div className="export-tab__result-item">
                      <span className="export-tab__result-label">Filename:</span>
                      <span className="export-tab__result-value export-tab__result-value--filename">{taskResult.data.filename}</span>
                    </div>
                  )}
                  {taskResult.data.file_path && (
                    <div className="export-tab__result-item">
                      <span className="export-tab__result-label">File Path:</span>
                      <span className="export-tab__result-value export-tab__result-value--filepath">{taskResult.data.file_path}</span>
                    </div>
                  )}
                  {taskResult.data.destination && (
                    <div className="export-tab__result-item">
                      <span className="export-tab__result-label">Destination:</span>
                      <span className="export-tab__result-value">{taskResult.data.destination}</span>
                    </div>
                  )}
                  {taskResult.data.transaction_id && (
                    <div className="export-tab__result-item">
                      <span className="export-tab__result-label">Transaction ID:</span>
                      <span className="export-tab__result-value export-tab__result-value--transaction-id">{taskResult.data.transaction_id}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Status Message (when not processing) */}
        {!isProcessing && statusMessage && !taskResult && (
          <div className="export-tab__status">
            <p className="export-tab__status-message">{statusMessage}</p>
          </div>
        )}
      </div>

      {/* Fix Modal */}
      {showFixModal && (
        <div className="export-tab__modal-overlay" onClick={closeFixModal}>
          <div className="export-tab__fix-modal" onClick={(e) => e.stopPropagation()}>
            <div className="export-tab__modal-header">
              <div className="export-tab__modal-title">
                <Wrench size={24} className="export-tab__modal-icon" />
                <h4 className="export-tab__modal-heading">Fracked Coins Detected</h4>
              </div>
              <button className="export-tab__modal-close" onClick={closeFixModal}>
                <X size={20} />
              </button>
            </div>
            
            <div className="export-tab__modal-content">
              <div className="export-tab__warning">
                <AlertTriangle size={24} className="export-tab__warning-icon" />
                <div className="export-tab__warning-text">
                  <p><strong>{frackedCount} fracked coins</strong> found in your wallet.</p>
                  <p>Fracked coins have partial authentication (13-24/25 RAIDAs). Use the Fix operation to heal them for better reliability.</p>
                </div>
              </div>

              <div className="export-tab__fix-explanation">
                <h5 className="export-tab__fix-explanation-heading">How Fix Works:</h5>
                <ul>
                  <li><strong>Get Ticket:</strong> Passing RAIDAs provide authentication tickets</li>
                  <li><strong>Fix:</strong> Tickets are presented to failing RAIDAs to update their databases</li>
                  <li><strong>Result:</strong> Fracked coins become fully authenticated (25/25 RAIDAs)</li>
                </ul>
              </div>

              {/* Fix Results */}
              {fixResult && !isFixing && (
                <div className={`export-tab__fix-result ${fixResult.error ? 'export-tab__fix-result--error' : 'export-tab__fix-result--success'}`}>
                  {fixResult.error ? (
                    <>
                      <h5 className="export-tab__fix-result-heading">
                        <X size={18} className="export-tab__fix-result-icon" />
                        Fix Failed:
                      </h5>
                      <p>{fixResult.error}</p>
                    </>
                  ) : (
                    <>
                      <h5 className="export-tab__fix-result-heading">
                        <CheckCircle size={18} className="export-tab__fix-result-icon" />
                        Fix Operation Completed!
                      </h5>
                      <p><strong>Wallet:</strong> {fixResult.wallet}</p>
                      <p><strong>Status:</strong> {fixResult.message}</p>
                      
                      <div className="export-tab__fix-outcome-warning">
                        <AlertTriangle size={20} className="export-tab__warning-icon" />
                        <div className="export-tab__warning-text">
                          <p><strong>Important:</strong> Coins may have moved to different folders based on healing results:</p>
                          <ul>
                            <li><strong>Bank:</strong> Fully healed coins (25/25 RAIDAs)</li>
                            <li><strong>Fracked:</strong> Partially improved coins (13-24/25 RAIDAs)</li>
                            <li><strong>Counterfeit:</strong> Coins that couldn&apos;t be healed (&lt;13/25 RAIDAs)</li>
                          </ul>
                          <p>Check your wallet folders to see where each coin ended up.</p>
                        </div>
                      </div>
                      
                      <p className="export-tab__receipt-note">Check your wallet&apos;s Receipts folder for detailed healing results.</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="export-tab__modal-actions">
              <button 
                className="export-tab__fix-button" 
                onClick={handleFix}
                disabled={isFixing}
              >
                {isFixing ? 'Healing Coins...' : 'Fix Fracked Coins'}
              </button>
              <button 
                className="export-tab__skip-button" 
                onClick={closeFixModal}
                disabled={isFixing}
              >
                {fixResult && !fixResult.error ? 'Continue' : 'Skip for Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportTab;
