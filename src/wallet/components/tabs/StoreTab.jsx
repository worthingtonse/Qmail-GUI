import { useState, useEffect } from 'react';
import { Pencil, Trash2, AlertTriangle } from 'lucide-react';
// API-FIX: switchWallet removed — rest_core doesn't track active wallet state
import { listWallets, getWalletBalance, createWallet, renameWallet, deleteWallet, addWalletLocation } from '../../../api/apiService.js';
import TransactionsTab from './TransactionsTab';

const StoreTab = () => {
  const [balance, setBalance] = useState(0);
  const [wallets, setWallets] = useState([]);
  const [isWalletsLoading, setIsWalletsLoading] = useState(false);
  const [walletsError, setWalletsError] = useState(null);
  const [showCreateWallet, setShowCreateWallet] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletPath, setNewWalletPath] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);
  
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [renamingWallet, setRenamingWallet] = useState(null);
  const [newNameInput, setNewNameInput] = useState('');
  const [deletingWallet, setDeletingWallet] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  // New state for transactions view
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [viewMode, setViewMode] = useState('wallets'); // 'wallets' or 'transactions'

  useEffect(() => {
    loadWalletData();
  }, []);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // API-FIX: rest_core returns balance per-wallet, not as a batch.
  // We list wallets first, then fetch balance for each one.
  const loadWalletData = async (showSuccess = false, successMsg = '') => {
  setIsWalletsLoading(true);
  setWalletsError(null);
  setWallets([]);
  setBalance(0);

  try {
    // 1. Get wallet list
    const listResult = await listWallets();
    if (!listResult.success) {
      throw new Error(listResult.error);
    }

    console.log('Wallet list:', listResult.data);

    const walletList = listResult.data || [];

    // 2. Fetch balance for each wallet individually
    let totalBalance = 0;
    const mergedWallets = await Promise.all(walletList.map(async (wallet) => {
      const walletPath = wallet.path || wallet.wallet_path;
      const walletName = wallet.name || wallet.wallet_name || 'Unknown';
      let bal = { balance: 0, coins: 0, has_fracked: false, has_limbo: false, denomination_counts: {} };

      try {
        const balanceResult = await getWalletBalance(walletPath);
        if (balanceResult.success && balanceResult.data.wallets.length > 0) {
          bal = balanceResult.data.wallets[0];
        }
      } catch (balanceError) {
        console.warn(`Balance fetch failed for ${walletName}:`, balanceError);
      }

      totalBalance += bal.balance || 0;

      return {
        ...wallet,
        name: walletName,
        path: walletPath,
        balance: bal.balance || 0,
        coins: bal.coins || 0,
        has_fracked: bal.has_fracked || false,
        has_limbo: bal.has_limbo || false,
        denomination_counts: bal.denomination_counts || {}
      };
    }));

    console.log('Merged wallets:', mergedWallets);

    setWallets(mergedWallets);
    setBalance(totalBalance);

    if (showSuccess && successMsg) {
      setSuccessMessage(successMsg);
    }

  } catch (error) {
    console.error('Failed to load wallet data:', error);
    setWalletsError(error.message);
  } finally {
    setIsWalletsLoading(false);
  }
};

  // API-FIX: handleSwitchWallet removed — rest_core doesn't track active wallet state.
  // Wallet selection is handled locally by clicking a wallet card.

  const handleCreateWallet = async (e) => {
    e.preventDefault();
    
    if (!newWalletName.trim()) {
      setWalletsError('Please enter a wallet name');
      return;
    }

    setIsCreating(true);
    setWalletsError(null);
    setSuccessMessage(null);

    try {
      const result = await createWallet(newWalletName.trim(), newWalletPath.trim() || null);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      const walletName = newWalletName;
      setNewWalletName('');
      setNewWalletPath('');
      setShowCreateWallet(false);
      
      await loadWalletData(true, `Successfully created wallet: ${walletName}`);

    } catch (error) {
      console.error('Failed to create wallet:', error);
      setWalletsError(`Failed to create wallet: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddLocation = async (e) => {
    e.preventDefault();
    
    if (!newLocation.trim()) {
      setWalletsError('Please enter a location path');
      return;
    }

    setIsAddingLocation(true);
    setWalletsError(null);
    setSuccessMessage(null);

    try {
      const result = await addWalletLocation(newLocation.trim());
      
      if (!result.success) {
        throw new Error(result.error);
      }

      const location = newLocation;
      setNewLocation('');
      setShowAddLocation(false);
      
      await loadWalletData(true, `Successfully added location: ${location}`);

    } catch (error) {
      console.error('Failed to add location:', error);
      setWalletsError(`Failed to add location: ${error.message}`);
    } finally {
      setIsAddingLocation(false);
    }
  };

  const handleRenameWallet = async (wallet) => {
    if (!newNameInput.trim()) {
      setWalletsError('Please enter a new wallet name');
      return;
    }

    if (wallet.name === newNameInput.trim()) {
      setWalletsError('New name must be different from current name');
      return;
    }

    setWalletsError(null);
    setSuccessMessage(null);

    try {
      const result = await renameWallet(wallet.path, newNameInput.trim());
      
      if (!result.success) {
        throw new Error(result.error);
      }

      const newName = newNameInput;
      const oldName = wallet.name;
      setRenamingWallet(null);
      setNewNameInput('');
      
      await loadWalletData(true, `Successfully renamed wallet from "${oldName}" to "${newName}"`);

    } catch (error) {
      console.error('Failed to rename wallet:', error);
      setWalletsError(`Failed to rename wallet: ${error.message}`);
    }
  };

  const handleDeleteWallet = async (wallet) => {
    setDeletingWallet(wallet.name);
    setWalletsError(null);
    setSuccessMessage(null);

    try {
      const result = await deleteWallet(wallet.path);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      const walletName = wallet.name;
      setShowDeleteConfirm(null);
      setDeletingWallet(null);
      
      await loadWalletData(true, `Successfully deleted wallet: ${walletName}`);

    } catch (error) {
      console.error('Failed to delete wallet:', error);
      setWalletsError(`Failed to delete wallet: ${error.message}`);
      setDeletingWallet(null);
    }
  };

  const startRename = (wallet) => {
    setRenamingWallet(wallet.name);
    setNewNameInput(wallet.name);
    setWalletsError(null);
    setSuccessMessage(null);
  };

  const cancelRename = () => {
    setRenamingWallet(null);
    setNewNameInput('');
  };

  const confirmDelete = (wallet) => {
    setShowDeleteConfirm(wallet.name);
    setWalletsError(null);
    setSuccessMessage(null);
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(null);
  };

  // New function to handle wallet card click
  const handleWalletClick = (wallet) => {
    setSelectedWallet(wallet);
    setViewMode('transactions');
  };

  // Function to handle back button from transactions view
  const handleBackToWallets = () => {
    setSelectedWallet(null);
    setViewMode('wallets');
  };

  // Prevent wallet actions (rename, delete) from triggering the wallet click
  const handleActionClick = (e, action, wallet) => {
    e.stopPropagation(); // Prevent wallet card click
    action(wallet);
  };

  // Render the transactions view if selected
  if (viewMode === 'transactions' && selectedWallet) {
    return (
      <div className="tab-content main-dashboard__panel--store main-dashboard__panel--transactions-view">
        <TransactionsTab 
          wallet={selectedWallet} 
          walletPath={selectedWallet.path}
          onBack={handleBackToWallets} 
        />
      </div>
    );
  }

  // Render using the EXACT original structure
  return (
    <div className="tab-content main-dashboard__panel--store">

      {successMessage && (
        <div className="main-dashboard__success-message">
          <span className="main-dashboard__success-icon">✓</span>
          {successMessage}
        </div>
      )}

      <div className="main-dashboard__balance-display">
        <h4 className="main-dashboard__balance-title">Current Balance: {isWalletsLoading ? '...' : balance.toLocaleString()} CloudCoins</h4>
      </div>
      
      <div className="feature-placeholder main-dashboard__wallet-list-panel">
        <div className="main-dashboard__wallet-list-header">
          <p>Your authenticated CloudCoins are stored in the following wallets:</p>
          <div className="main-dashboard__wallet-list-buttons">
            <button 
              className="main-dashboard__create-wallet-button"
              onClick={() => setShowCreateWallet(!showCreateWallet)}
              disabled={isWalletsLoading}
            >
              {showCreateWallet ? 'Cancel' : '+ Create New Wallet'}
            </button>
            <button 
              className="main-dashboard__add-location-button"
              onClick={() => setShowAddLocation(!showAddLocation)}
              disabled={isWalletsLoading}
            >
              {showAddLocation ? 'Cancel' : '+ Add Location'}
            </button>
          </div>
        </div>

        {showCreateWallet && (
          <div className="main-dashboard__wallet-form">
            <form onSubmit={handleCreateWallet}>
              <input
                type="text"
                placeholder="Enter wallet name..."
                value={newWalletName}
                onChange={(e) => setNewWalletName(e.target.value)}
                className="main-dashboard__wallet-name-input"
                disabled={isCreating}
                maxLength={50}
              />
              <button 
                type="submit" 
                className="main-dashboard__wallet-submit-button"
                disabled={isCreating || !newWalletName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create Wallet'}
              </button>
            </form>
          </div>
        )}

        {showAddLocation && (
          <div className="main-dashboard__wallet-form">
            <form onSubmit={handleAddLocation}>
              <input
                type="text"
                placeholder="Enter folder path (e.g., C:\MyWallets or /home/user/wallets)..."
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                className="main-dashboard__wallet-name-input"
                disabled={isAddingLocation}
              />
              <button 
                type="submit" 
                className="main-dashboard__wallet-submit-button"
                disabled={isAddingLocation || !newLocation.trim()}
              >
                {isAddingLocation ? 'Adding...' : 'Add Location'}
              </button>
            </form>
            <p className="main-dashboard__form-hint">Add a folder path to scan for existing wallets</p>
          </div>
        )}

        {isWalletsLoading && (
          <div className="main-dashboard__status-output">
            <h5>Loading Wallets...</h5>
          </div>
        )}

        {walletsError && (
          <div className="main-dashboard__status-output main-dashboard__status-output--error" >
            <pre>{walletsError}</pre>
          </div>
        )}

        {!isWalletsLoading && !walletsError && (
          <div className="main-dashboard__wallet-list">
            {wallets.length > 0 ? (
              wallets.map((wallet, index) => (
                <div 
                  key={wallet.name || index} 
                  className={`main-dashboard__wallet-item ${wallet.active ? 'main-dashboard__wallet-item--active' : ''}`}
                  onClick={() => handleWalletClick(wallet)}
                  title="Click to view transactions"
                >
                  {renamingWallet === wallet.name ? (
                    <div className="main-dashboard__rename-form" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={newNameInput}
                        onChange={(e) => setNewNameInput(e.target.value)}
                        className="main-dashboard__rename-input"
                        placeholder="Enter new name..."
                        maxLength={50}
                        autoFocus
                      />
                      <div className="main-dashboard__rename-actions">
                        <button
                          className="main-dashboard__rename-save-button"
                          onClick={(e) => handleActionClick(e, () => handleRenameWallet(wallet), wallet)}
                        >
                          Save
                        </button>
                        <button
                          className="main-dashboard__rename-cancel-button"
                          onClick={(e) => handleActionClick(e, cancelRename, wallet)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="main-dashboard__wallet-header">
                        <div className="main-dashboard__wallet-title-group">
                          <h5 className="main-dashboard__wallet-name">{wallet.name}</h5>
                          {wallet.active && <span className="main-dashboard__active-badge">Active</span>}
                        </div>
                        <div className="main-dashboard__wallet-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="main-dashboard__wallet-action-button main-dashboard__wallet-action-button--rename"
                            onClick={(e) => handleActionClick(e, startRename, wallet)}
                            title="Rename wallet"
                            disabled={deletingWallet !== null}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="main-dashboard__wallet-action-button main-dashboard__wallet-action-button--delete"
                            onClick={(e) => handleActionClick(e, confirmDelete, wallet)}
                            title="Delete wallet"
                            disabled={deletingWallet !== null}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="main-dashboard__wallet-balance">
                        <p className="main-dashboard__wallet-total-balance">
                          Total: {wallet.balance.toLocaleString()} CC ({wallet.coins || 0} coins)
                        </p>
                        {wallet.denomination_counts && Object.keys(wallet.denomination_counts).length > 0 && (
                          <div className="main-dashboard__denomination-breakdown">
                            <p className="main-dashboard__denomination-label">Denominations:</p>
                            <div className="main-dashboard__denomination-list">
                              {Object.entries(wallet.denomination_counts)
                                .filter(([, count]) => count > 0)
                                .sort(([a], [b]) => Number(b) - Number(a))
                                .map(([denom, count]) => (
                                  <span key={denom} className="main-dashboard__denomination-item">
                                    {denom}: {count}
                                  </span>
                                ))
                              }
                            </div>
                          </div>
                        )}
                        {(wallet.has_fracked || wallet.has_limbo) && (
                          <div className="main-dashboard__wallet-alerts">
                            {wallet.has_fracked && <span className="main-dashboard__alert-badge main-dashboard__alert-badge--fracked">Has Fracked Coins</span>}
                            {wallet.has_limbo && <span className="main-dashboard__alert-badge main-dashboard__alert-badge--limbo">Has Limbo Coins</span>}
                          </div>
                        )}
                      </div>
                      {wallet.path && (
                        <p className="main-dashboard__wallet-path" title={wallet.path}>
                          {wallet.path.length > 30 
                            ? `...${wallet.path.substring(wallet.path.length - 30)}` 
                            : wallet.path}
                        </p>
                      )}
                      
                      {showDeleteConfirm === wallet.name && (
                        <div className="main-dashboard__delete-confirm" onClick={(e) => e.stopPropagation()}>
                          <p className="main-dashboard__delete-warning">
                            <AlertTriangle size={16} className="main-dashboard__warning-icon" />
                            Delete wallet &quot;{wallet.name}&quot;?
                          </p>
                          <div className="main-dashboard__delete-actions">
                            <button
                              className="main-dashboard__delete-yes-button"
                              onClick={(e) => handleActionClick(e, () => handleDeleteWallet(wallet), wallet)}
                              disabled={deletingWallet !== null}
                            >
                              {deletingWallet === wallet.name ? 'Deleting...' : 'Yes, Delete'}
                            </button>
                            <button
                              className="main-dashboard__delete-no-button"
                              onClick={(e) => handleActionClick(e, cancelDelete, wallet)}
                              disabled={deletingWallet !== null}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {/* Add subtle click hint at the bottom */}
                      {/* <div className="wallet-click-hint">
                        <small>💡 Click to view transactions</small>
                      </div> */}
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="main-dashboard__empty-wallets">
                <p>No wallets found. Create your first wallet to get started!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StoreTab;
