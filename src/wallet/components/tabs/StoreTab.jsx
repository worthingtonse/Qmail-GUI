import React, { useState, useEffect } from 'react';
import { Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { listWallets, getWalletBalance, switchWallet, createWallet, renameWallet, deleteWallet, addWalletLocation } from '../../../api/apiService.js';
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
  const [isSwitching, setIsSwitching] = useState(null);
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
    
    // 2. Get balance info - wrap in try-catch to handle deleted wallet
    let balanceData = { wallets: [], total_balance: 0, total_coins: 0 };
    
    try {
      const balanceResult = await getWalletBalance();
      if (balanceResult.success) {
        balanceData = balanceResult.data || balanceData;
      }
    } catch (balanceError) {
      console.warn('Balance fetch failed (might be due to deleted wallet):', balanceError);
      // Continue with empty balance data
    }
    
    console.log('Balance data:', balanceData);
    
    const walletBalances = balanceData.wallets || [];
    const totalBalance = balanceData.total_balance || 0;

    // 3. Merge wallet list with balance data
    const mergedWallets = walletList.map(wallet => {
      const balanceInfo = walletBalances.find(b => b.name === wallet.wallet_name || b.name === wallet.name);
      
      return {
        ...wallet,
        name: wallet.wallet_name || wallet.name || 'Unknown',
        path: wallet.wallet_path || wallet.path,
        balance: balanceInfo ? balanceInfo.balance : 0,
        coins: balanceInfo ? balanceInfo.coins : 0,
        has_fracked: balanceInfo ? balanceInfo.has_fracked : false,
        has_limbo: balanceInfo ? balanceInfo.has_limbo : false,
        denomination_counts: balanceInfo ? balanceInfo.denomination_counts : {}
      };
    });

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

  const handleSwitchWallet = async (walletName) => {
    setIsSwitching(walletName);
    setWalletsError(null);
    setSuccessMessage(null);

    try {
      const result = await switchWallet(walletName);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      await loadWalletData(true, `Successfully switched to wallet: ${walletName}`);

    } catch (error) {
      console.error('Failed to switch wallet:', error);
      setWalletsError(`Failed to switch wallet: ${error.message}`);
    } finally {
      setIsSwitching(null);
    }
  };

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
      <div className="tab-content store-tab transactions-view">
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
    <div className="tab-content store-tab">

      {successMessage && (
        <div className="success-message">
          <span className="success-icon">✓</span>
          {successMessage}
        </div>
      )}

      <div className="balance-display">
        <h4>Current Balance: {isWalletsLoading ? '...' : balance.toLocaleString()} CloudCoins</h4>
      </div>
      
      <div className="feature-placeholder wallet-list-container">
        <div className="wallet-list-header">
          <p>Your authenticated CloudCoins are stored in the following wallets:</p>
          <div className="header-buttons">
            <button 
              className="create-wallet-btn"
              onClick={() => setShowCreateWallet(!showCreateWallet)}
              disabled={isWalletsLoading}
            >
              {showCreateWallet ? 'Cancel' : '+ Create New Wallet'}
            </button>
            <button 
              className="add-location-btn"
              onClick={() => setShowAddLocation(!showAddLocation)}
              disabled={isWalletsLoading}
            >
              {showAddLocation ? 'Cancel' : '+ Add Location'}
            </button>
          </div>
        </div>

        {showCreateWallet && (
          <div className="create-wallet-form">
            <form onSubmit={handleCreateWallet}>
              <input
                type="text"
                placeholder="Enter wallet name..."
                value={newWalletName}
                onChange={(e) => setNewWalletName(e.target.value)}
                className="wallet-name-input"
                disabled={isCreating}
                maxLength={50}
              />
              <button 
                type="submit" 
                className="submit-wallet-btn"
                disabled={isCreating || !newWalletName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create Wallet'}
              </button>
            </form>
          </div>
        )}

        {showAddLocation && (
          <div className="create-wallet-form">
            <form onSubmit={handleAddLocation}>
              <input
                type="text"
                placeholder="Enter folder path (e.g., C:\MyWallets or /home/user/wallets)..."
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                className="wallet-name-input"
                disabled={isAddingLocation}
              />
              <button 
                type="submit" 
                className="submit-wallet-btn"
                disabled={isAddingLocation || !newLocation.trim()}
              >
                {isAddingLocation ? 'Adding...' : 'Add Location'}
              </button>
            </form>
            <p className="form-hint">Add a folder path to scan for existing wallets</p>
          </div>
        )}

        {isWalletsLoading && (
          <div className="echo-status-output">
            <h5>Loading Wallets...</h5>
          </div>
        )}

        {walletsError && (
          <div className="echo-status-output error" >
            <pre>{walletsError}</pre>
          </div>
        )}

        {!isWalletsLoading && !walletsError && (
          <div className="wallet-list">
            {wallets.length > 0 ? (
              wallets.map((wallet, index) => (
                <div 
                  key={wallet.name || index} 
                  className={`wallet-item info-card ${wallet.active ? 'active' : ''} clickable-wallet`}
                  onClick={() => handleWalletClick(wallet)}
                  style={{ cursor: 'pointer' }}
                  title="Click to view transactions"
                >
                  {renamingWallet === wallet.name ? (
                    <div className="rename-wallet-form" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={newNameInput}
                        onChange={(e) => setNewNameInput(e.target.value)}
                        className="rename-input"
                        placeholder="Enter new name..."
                        maxLength={50}
                        autoFocus
                      />
                      <div className="rename-actions">
                        <button
                          className="rename-save-btn"
                          onClick={(e) => handleActionClick(e, () => handleRenameWallet(wallet), wallet)}
                        >
                          Save
                        </button>
                        <button
                          className="rename-cancel-btn"
                          onClick={(e) => handleActionClick(e, cancelRename, wallet)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="wallet-header">
                        <div className="wallet-title-section">
                          <h5>{wallet.name}</h5>
                          {wallet.active && <span className="active-badge">Active</span>}
                        </div>
                        <div className="wallet-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="action-btn rename-btn"
                            onClick={(e) => handleActionClick(e, startRename, wallet)}
                            title="Rename wallet"
                            disabled={isSwitching !== null || deletingWallet !== null}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="action-btn delete-btn"
                            onClick={(e) => handleActionClick(e, confirmDelete, wallet)}
                            title="Delete wallet"
                            disabled={isSwitching !== null || deletingWallet !== null || wallet.active}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="wallet-balance-section">
                        <p className="wallet-total-balance">
                          Total: {wallet.balance.toLocaleString()} CC ({wallet.coins || 0} coins)
                        </p>
                        {wallet.denomination_counts && Object.keys(wallet.denomination_counts).length > 0 && (
                          <div className="denomination-breakdown">
                            <p className="denomination-label">Denominations:</p>
                            <div className="denomination-list">
                              {Object.entries(wallet.denomination_counts)
                                .filter(([denom, count]) => count > 0)
                                .sort(([a], [b]) => Number(b) - Number(a))
                                .map(([denom, count]) => (
                                  <span key={denom} className="denomination-item">
                                    {denom}: {count}
                                  </span>
                                ))
                              }
                            </div>
                          </div>
                        )}
                        {(wallet.has_fracked || wallet.has_limbo) && (
                          <div className="wallet-alerts">
                            {wallet.has_fracked && <span className="alert-badge fracked">Has Fracked Coins</span>}
                            {wallet.has_limbo && <span className="alert-badge limbo">Has Limbo Coins</span>}
                          </div>
                        )}
                      </div>
                      {wallet.path && (
                        <p className="wallet-path" title={wallet.path}>
                          {wallet.path.length > 30 
                            ? `...${wallet.path.substring(wallet.path.length - 30)}` 
                            : wallet.path}
                        </p>
                      )}
                      
                      {showDeleteConfirm === wallet.name && (
                        <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
                          <p className="delete-warning">
                            <AlertTriangle size={16} className="warning-icon" />
                            Delete wallet "{wallet.name}"?
                          </p>
                          <div className="delete-actions">
                            <button
                              className="delete-yes-btn"
                              onClick={(e) => handleActionClick(e, () => handleDeleteWallet(wallet), wallet)}
                              disabled={deletingWallet !== null}
                            >
                              {deletingWallet === wallet.name ? 'Deleting...' : 'Yes, Delete'}
                            </button>
                            <button
                              className="delete-no-btn"
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
              <div className="no-wallets-message">
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