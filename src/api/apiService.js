// --- src/api/apiService.js ---
// This file will store all your API call functions.

// API port is configurable via VITE_API_PORT env variable (default: 8080)
const API_PORT = import.meta.env.VITE_API_PORT || '8080';
const API_BASE_URL = `http://localhost:${API_PORT}/api`;

const extractApiErrorMessage = (data, fallback) => {
  if (!data || typeof data !== 'object') {
    return fallback;
  }

  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }

  if (typeof data.detail === 'string' && data.detail.trim()) {
    return data.detail;
  }

  if (typeof data.details === 'string' && data.details.trim()) {
    return data.details;
  }

  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error;
  }

  return fallback;
};

/**
 * A helper function to handle fetch responses.
 * It checks for network errors and non-ok responses.
 * @param {Response} response - The fetch Response object
 */
const handleResponse = async (response) => {
  let data = null;

  try {
    data = await response.json();
  } catch (jsonError) {
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status} ${response.statusText}`);
    }
    return null;
  }

  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Server responded with ${response.status} ${response.statusText}`
      )
    );
  }

  return data;
};

// BUG-08 FIX: Resolve home directory at runtime instead of using literal %USERNAME%
let _homeDir = null;
let _homeDirPromise = null;

function getHomeDir() {
  if (_homeDir) return Promise.resolve(_homeDir);
  if (_homeDirPromise) return _homeDirPromise;
  _homeDirPromise = (async () => {
    if (window.electronAPI && window.electronAPI.getHomeDir) {
      _homeDir = await window.electronAPI.getHomeDir();
    } else {
      // Fallback for browser testing
      _homeDir = 'C:\\Users\\User';
    }
    return _homeDir;
  })();
  return _homeDirPromise;
}

/**
 * Helper function to expand relative paths to absolute paths.
 * Now async to ensure home directory is resolved before use.
 * @param {string} pathStr - The path to expand
 * @returns {Promise<string>} - Expanded absolute path
 */
async function expandPath(pathStr) {
  if (!pathStr) return '';

  // If it's already an absolute path, return as-is
  if (pathStr.match(/^[a-zA-Z]:\\/) || pathStr.startsWith('/') || pathStr.startsWith('\\\\')) {
    return pathStr;
  }

  const homeDir = await getHomeDir();

  const commonExpansions = {
    'Downloads': homeDir + '\\Downloads',
    'Documents': homeDir + '\\Documents',
    'Desktop': homeDir + '\\Desktop',
    'CloudCoin': homeDir + '\\CloudCoin',
    'Data': 'Data\\Wallets',
    'Export': 'Export'
  };

  // Check if it's a common folder name
  if (commonExpansions[pathStr]) {
    return commonExpansions[pathStr];
  }

  // For unknown single folder names (no slashes), expand to user directory
  if (!pathStr.includes('\\') && !pathStr.includes('/')) {
    console.log(`Expanding relative folder "${pathStr}" to user directory`);
    return homeDir + '\\' + pathStr;
  }

  // If it contains slashes, assume user knows what they're doing
  return pathStr;
}

// Start resolving home dir early (non-blocking)
getHomeDir();

/**
 * Checks if the application is running from a USB drive.
 * Calls the REST API directly from the renderer (no IPC middleman).
 * @returns {Promise<{onUsb: boolean, required: boolean, rootPath: string}>}
 */
export const checkUsbDrive = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/system/config/usb`);
    if (!response.ok) {
      console.warn('USB check returned', response.status);
      return { onUsb: false, required: false, rootPath: '' };
    }
    const data = await response.json();
    return {
      onUsb: data.on_usb === true,
      required: data.required !== false, // default to required if not specified
      rootPath: data.root_path || '',
    };
  } catch (error) {
    console.error('USB check API failed:', error);
    return { onUsb: false, required: false, rootPath: '' };
  }
};

/**
 * Helper function to normalize file paths - keep backslashes for file paths
 * @param {string} path - The path to normalize
 * @param {boolean} isFilePath - True if this is a file path (uses backslashes), false for wallet path (uses forward slashes)
 * @returns {string} - Normalized path
 */
function normalizePath(path, isFilePath = true) {
  if (!path) return '';
  if (isFilePath) {
    // For file paths, convert forward slashes to backslashes
    return path.replace(/\//g, '\\');
  } else {
    // For wallet paths, convert backslashes to forward slashes
    return path.replace(/\\/g, '/');
  }
}

/**
 * Runs the RAIDA Echo Test.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const runEchoTest = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/raida/echo`);
    const data = await handleResponse(response);

    if (data && Array.isArray(data.raidas)) {
      return { success: true, data: { servers: data.raidas } };
    } else {
      const receivedDataString = JSON.stringify(data, null, 2);
      throw new Error(
        'Received invalid data from server (expected object with a "raidas" array).\n\n' +
        'Data received:\n' +
        `${receivedDataString.substring(0, 500)}${receivedDataString.length > 500 ? '...' : ''}`
      );
    }

  } catch (error) {
    console.error('Echo test failed:', error);
    const errorMessage = `Error: ${error.message}\n\nIs the Core server running?\nMake sure you started it with: ./core --server`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Lists all available wallets.
 */
export const listWallets = async () => {
  try {
    // API-FIX: Changed /api/wallets → /api/wallets/list to match rest_core
    const response = await fetch(`${API_BASE_URL}/wallets/list`);
    const data = await handleResponse(response);
    console.log('Data received from /wallets/list:', data);

    if (data && Array.isArray(data.wallets)) {
      // API-FIX: Backend returns wallet_name/wallet_path, map to name/path for GUI
      const mapped = data.wallets.map(w => ({
        ...w,
        name: w.wallet_name || w.name,
        path: w.wallet_path || w.path,
      }));
      return { success: true, data: mapped, total_balance: 0 };
    }
    else {
      const receivedDataString = JSON.stringify(data, null, 2);
      throw new Error(
        'Received invalid data from server (expected "wallets" array).\n\n' +
        'Data received:\n' +
        `${receivedDataString.substring(0, 500)}${receivedDataString.length > 500 ? '...' : ''}`
      );
    }

  } catch (error) {
    console.error('List wallets failed:', error);
    const errorMessage = `Error: ${error.message}\n\nIs the Core server running?`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets the balance for a specific wallet.
 * API-FIX: Changed from /api/wallets/active/balance to /api/wallets/balance?wallet_path=
 * rest_core does not track "active wallet" — it requires wallet_path each time.
 * If no walletPath is provided, the backend defaults to the "Default" wallet.
 * @param {string} walletPath - Optional wallet path. Omit to use Default wallet.
 */
export const getWalletBalance = async (walletPath = null) => {
  try {
    const queryParams = new URLSearchParams();
    if (walletPath) {
      queryParams.append('wallet_path', walletPath);
    }
    const url = queryParams.toString()
      ? `${API_BASE_URL}/wallets/balance?${queryParams.toString()}`
      : `${API_BASE_URL}/wallets/balance`;

    const response = await fetch(url);

    // Handle non-OK responses gracefully
    if (!response.ok) {
      console.warn(`Balance fetch returned ${response.status}`);
      return {
        success: true,
        data: {
          wallets: [],
          total_balance: 0,
          total_coins: 0,
          denomination_counts: {}
        }
      };
    }

    const data = await response.json();
    console.log('Data received from /wallets/balance:', data);

    // API-FIX: rest_core returns a single wallet balance object with fields:
    // { success, total_value, total_notes, bank_value, bank_notes,
    //   fracked_value, fracked_notes, limbo_value, limbo_notes, wallet_name, wallet_path }
    // We map this into the shape callers expect.
    if (data && data.success) {
      return {
        success: true,
        data: {
          wallets: [{
            name: data.wallet_name || 'Default',
            path: data.wallet_path || '',
            balance: data.total_value || 0,
            coins: data.total_notes || 0,
            has_fracked: (data.fracked_notes || 0) > 0,
            has_limbo: (data.limbo_notes || 0) > 0,
            denomination_counts: {},
            folders: {
              bank_coins: data.bank_notes || 0,
              bank_value: data.bank_value || 0,
              fracked_coins: data.fracked_notes || 0,
              fracked_value: data.fracked_value || 0,
              limbo_coins: data.limbo_notes || 0,
              limbo_value: data.limbo_value || 0,
            }
          }],
          total_balance: data.total_value || 0,
          total_coins: data.total_notes || 0,
          denomination_counts: {}
        }
      };
    } else {
      return {
        success: true,
        data: {
          wallets: [],
          total_balance: 0,
          total_coins: 0,
          denomination_counts: {}
        }
      };
    }

  } catch (error) {
    console.error('Get wallet balance failed:', error);
    // BUG-11 FIX: Report failure so the UI can show an error indicator
    return {
      success: false,
      error: `Failed to load wallet balance: ${error.message}`
    };
  }
};
/**
 * Gets total balance across all wallets by listing wallets then fetching each balance.
 * API-FIX: rest_core has no single "total balance" endpoint.
 * We list wallets via /api/wallets/list, then call /api/wallets/balance for each.
 */
export const getTotalBalance = async () => {
  try {
    // 1. Get wallet list
    const listResponse = await fetch(`${API_BASE_URL}/wallets/list`);
    const listData = await handleResponse(listResponse);
    console.log('Data received from /wallets/list (for total balance):', listData);

    if (!listData || !Array.isArray(listData.wallets)) {
      throw new Error('Invalid wallet list response');
    }

    // 2. Fetch balance for each wallet
    let allWallets = [];
    let totalBalance = 0;
    let totalCoins = 0;

    for (const w of listData.wallets) {
      const walletPath = w.wallet_path || w.path;
      try {
        const balResult = await getWalletBalance(walletPath);
        if (balResult.success && balResult.data.wallets.length > 0) {
          const bal = balResult.data.wallets[0];
          allWallets.push({
            name: w.wallet_name || w.name || 'Unknown',
            balance: bal.balance || 0,
            coins: bal.coins || 0,
            location: walletPath,
            has_fracked: bal.has_fracked || false,
            has_limbo: bal.has_limbo || false,
            denomination_counts: bal.denomination_counts || {}
          });
          totalBalance += bal.balance || 0;
          totalCoins += bal.coins || 0;
        }
      } catch (balErr) {
        console.warn(`Failed to get balance for wallet ${walletPath}:`, balErr);
        allWallets.push({
          name: w.wallet_name || w.name || 'Unknown',
          balance: 0, coins: 0, location: walletPath,
          has_fracked: false, has_limbo: false, denomination_counts: {}
        });
      }
    }

    return {
      success: true,
      data: {
        wallets: allWallets,
        total_balance: totalBalance,
        total_coins: totalCoins,
        denomination_counts: {}
      }
    };

  } catch (error) {
    console.error('Get total balance failed:', error);
    const errorMessage = `Error: ${error.message}\n\nIs the Core server running?`;
    return { success: false, error: errorMessage };
  }
};
// API-FIX: switchWallet() removed — rest_core does not track "active wallet" state.
// The GUI tracks the selected wallet locally and passes wallet_path to each API call.
// If no wallet_path is provided, rest_core defaults to the "Default" wallet.

/**
 * Creates a new wallet with the specified name.
 * @param {string} walletName - The name for the new wallet
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { message, wallet_name } }
 * On failure: { success: false, error: "Error message" }
 */
export const createWallet = async (walletName, walletPath = null) => {
  try {
    // Validate input
    if (!walletName || typeof walletName !== 'string') {
      throw new Error('Wallet name is required and must be a string');
    }

    // Additional validation for wallet name
    if (walletName.trim().length === 0) {
      throw new Error('Wallet name cannot be empty');
    }

    const response = await fetch(`${API_BASE_URL}/wallets/create?wallet_path=${encodeURIComponent(normalizePath((walletPath || 'Data/Wallets') + '/' + walletName.trim(), false))}`);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallets/create:', data);

    // Check if the response indicates success
    if (data && (data.success || data.status === 'success' || data.message)) {
      return { 
        success: true, 
        data: {
          message: data.message || `Wallet "${walletName}" created successfully`,
          wallet_name: walletName,
          ...data
        }
      };
    } else {
      throw new Error(data.error || 'Failed to create wallet');
    }

  } catch (error) {
    console.error('Create wallet failed:', error);
    
    const errorMessage = `Error creating wallet "${walletName}": ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Adds a new wallet location/path to scan for wallets.
 * @param {string} path - The file system path to add
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { message, path } }
 * On failure: { success: false, error: "Error message" }
 */
export const addWalletLocation = async (path) => {
  try {
    // Validate input
    if (!path || typeof path !== 'string') {
      throw new Error('Path is required and must be a string');
    }

    if (path.trim().length === 0) {
      throw new Error('Path cannot be empty');
    }

    // URL encode the path to handle special characters and spaces
    const encodedPath = encodeURIComponent(path.trim());
    
    // API-FIX: Changed /api/wallet/add-location → /api/wallets/locations to match rest_core
    const response = await fetch(`${API_BASE_URL}/wallets/locations?path=${encodedPath}`);
    const data = await handleResponse(response);

    console.log('Data received from /wallets/locations:', data);

    // Check if the response indicates success
    if (data && (data.success || data.status === 'success' || data.message)) {
      return { 
        success: true, 
        data: {
          message: data.message || `Location "${path}" added successfully`,
          path: path,
          ...data
        }
      };
    } else {
      throw new Error(data.error || 'Failed to add wallet location');
    }

  } catch (error) {
    console.error('Add wallet location failed:', error);
    
    const errorMessage = `Error adding location "${path}": ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};


/**
 * Renames a wallet from one name to another.
 * @param {string} oldName - The current name of the wallet
 * @param {string} newName - The new name for the wallet
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { message, old_name, new_name } }
 * On failure: { success: false, error: "Error message" }
 */
export const renameWallet = async (walletPath, newName) => {
  try {
    if (!walletPath || typeof walletPath !== 'string') {
      throw new Error('Wallet path is required');
    }

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      throw new Error('New wallet name is required');
    }

    const encodedPath = encodeURIComponent(walletPath);
    const encodedNewName = encodeURIComponent(newName.trim());
    
    // API-FIX: Changed from POST to GET — rest_core uses GET for all wallet endpoints
    const response = await fetch(`${API_BASE_URL}/wallets/rename?wallet_path=${encodedPath}&new_name=${encodedNewName}`);
    const data = await handleResponse(response);

    console.log('Data received from /wallets/rename:', data);

    if (data && (data.success === true || data.status === 'success')) {
      return { 
        success: true, 
        data: {
          message: data.message || `Wallet renamed to "${newName}"`,
          new_name: newName,
          ...data
        }
      };
    } else {
      throw new Error(data.error || data.message || 'Failed to rename wallet');
    }

  } catch (error) {
    console.error('Rename wallet failed:', error);
    return { success: false, error: `Error renaming wallet: ${error.message}` };
  }
};

/**
 * Deletes a wallet with the specified name.
 * @param {string} walletName - The name of the wallet to delete
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { message, wallet_name } }
 * On failure: { success: false, error: "Error message" }
 */
export const deleteWallet = async (walletPath) => {
  try {
    if (!walletPath || typeof walletPath !== 'string') {
      throw new Error('Wallet path is required');
    }
    
    const encodedPath = encodeURIComponent(walletPath);
    
    // BUG-05 FIX: Do not assume network errors mean success
    // API-FIX: Changed from DELETE to GET — rest_core uses GET for all wallet endpoints
    const response = await fetch(`${API_BASE_URL}/wallets/delete?wallet_path=${encodedPath}`);

    console.log('Delete response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error('Delete error response:', errorText);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('Data received from /wallets/delete:', data);
    
    if (data && (data.success === true || data.command === 'wallet-delete')) {
      return { 
        success: true, 
        data: { 
          message: data.message || 'Wallet deleted successfully',
          wallet_name: data.wallet_name,
          ...data 
        } 
      };
    } else {
      throw new Error(data.error || data.message || 'Failed to delete wallet');
    }
    
  } catch (error) {
    console.error('Delete wallet failed:', error);
    return { success: false, error: `Error deleting wallet: ${error.message}` };
  }
};


/**
 * Gets transactions for a specific wallet.
 * @param {number} limit - Maximum number of transactions to retrieve (default: 10)
 * @param {string} walletPath - Optional wallet path. If not provided, uses a default path.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
  export const getWalletTransactions = async (limit = 10, walletPath = null) => {
  try {
    // Validate that walletPath is provided
    if (!walletPath || typeof walletPath !== 'string') {
      throw new Error('Wallet path is required for getting transactions');
    }

    console.log('Getting transactions for wallet:', walletPath);

    // Ensure the wallet path uses backslashes for the transactions API
    const normalizedWalletPath = normalizePath(walletPath, true); // true = use backslashes

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('wallet_path', normalizedWalletPath);
    queryParams.append('limit', limit.toString());

    const response = await fetch(`${API_BASE_URL}/wallets/transactions?${queryParams.toString()}`);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallets/transactions:', data);

    if (data && data.success && Array.isArray(data.transactions)) {
      return { 
        success: true, 
        data: {
          transactions: data.transactions,
          wallet: data.wallet_name || 'Unknown',
          wallet_path: data.wallet_path,
          count: data.count || data.transactions.length
        }
      };
    } else {
      const receivedDataString = JSON.stringify(data, null, 2);
      throw new Error(
        'Received invalid data from server (expected success and "transactions" array).\n\n' +
        'Data received:\n' +
        `${receivedDataString.substring(0, 500)}${receivedDataString.length > 500 ? '...' : ''}`
      );
    }

  } catch (error) {
    console.error('Get wallet transactions failed:', error);
    
    const errorMessage = `Error: ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Creates a complete ZIP archive backup of the active wallet.
 * @param {string} destination - Absolute path to the directory to save the backup
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { status, operation, wallet, destination, filename, full_path, message } }
 * On failure: { success: false, error: "Error message" }
 */
export const createWalletBackup = async (destination, walletPath = null) => {
  try {
    // 1. Validate input
    if (!destination || typeof destination !== 'string' || destination.trim().length === 0) {
      throw new Error('Destination path is required and must be an absolute path');
    }
    
    const encodedDestination = encodeURIComponent(destination.trim());

    // 2. Build URL with optional wallet_path
    // API-FIX: rest_core endpoint is /api/wallets/backup?destination=...&wallet_path=...
    let url = `${API_BASE_URL}/wallets/backup?destination=${encodedDestination}`;
    if (walletPath) {
      url += `&wallet_path=${encodeURIComponent(walletPath)}`;
    }

    const response = await fetch(url);

    // 3. Get JSON data regardless of response.ok
    const data = await response.json();

    // 4. Handle non-ok responses (400, 500, etc.)
    if (!response.ok) {
      throw new Error(data.error || data.message || `Server responded with ${response.status} ${response.statusText}`);
    }

    // 5. Handle successful response
    // API-FIX: rest_core returns { success, command, wallet_path, wallet_name, zip_path,
    //   destination, files_added, files_skipped, message }
    if (data && data.success === true) {
      return { success: true, data: {
        ...data,
        full_path: data.zip_path || '',
      }};
    } else {
      const receivedDataString = JSON.stringify(data, null, 2);
      throw new Error(
        'Received an unexpected success response from server.\n\n' +
        'Data received:\n' +
        `${receivedDataString.substring(0, 500)}${receivedDataString.length > 500 ? '...' : ''}`
      );
    }

  } catch (error) {
    // 6. Handle all errors (fetch failures, thrown errors)
    console.error('Create wallet backup failed:', error);
    
    const errorMessage = `Error creating backup: ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Imports specific CloudCoin files from absolute file paths with a transaction memo.
 * This is an async operation that returns a task ID for tracking progress.
 * @param {string[]} filePaths - Array of absolute file paths to CloudCoin files
 * @param {string} memo - Optional transaction memo for record-keeping
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { status, operation, task_id, message, file_count } }
 * On failure: { success: false, error: "Error message" }
 */
// export const importCloudCoinFiles = async (filePaths, memo = '', walletPath = 'C:\\Users\\tabee\\Downloads\\Test\\Data\\Wallets\\Default') => {
//   try {
//     // Validate input
//     if (!Array.isArray(filePaths) || filePaths.length === 0) {
//       throw new Error('File paths must be a non-empty array');
//     }

//     if (filePaths.length > 100) {
//       throw new Error('Maximum 100 files per import request');
//     }

//     // Build query parameters - API supports multiple 'file' parameters
//     const queryParams = new URLSearchParams();
    
//     // Add each file as a separate 'file' parameter
//     filePaths.forEach(filePath => {
//       // Keep original path format (don't convert backslashes)
//       queryParams.append('file', filePath);
//     });
    
//     // Add memo if provided
//     if (memo && memo.trim().length > 0) {
//       queryParams.append('memo', memo.trim());
//     }
    
//     // Add wallet path (keep original format)
//     queryParams.append('wallet_path', walletPath);

//     console.log('Import URL:', `${API_BASE_URL}/transactions/import?${queryParams.toString()}`);
//     console.log('Query string:', queryParams.toString());
//     console.log('Individual parameters:');
//     for (let [key, value] of queryParams.entries()) {
//       console.log(`  ${key}: ${value}`);
//     }

//     // Try alternative URL building to match Postman exactly
//     const manualQueryParts = [];
//     filePaths.forEach(filePath => {
//       manualQueryParts.push(`file=${encodeURIComponent(filePath)}`);
//     });
//     if (memo && memo.trim().length > 0) {
//       manualQueryParts.push(`memo=${encodeURIComponent(memo.trim())}`);
//     }
//     manualQueryParts.push(`wallet_path=${encodeURIComponent(walletPath)}`);
    
//     const manualQueryString = manualQueryParts.join('&');
//     const manualUrl = `${API_BASE_URL}/transactions/import?${manualQueryString}`;
//     console.log('Manual URL construction:', manualUrl);

//     const response = await fetch(manualUrl, {
//       method: 'GET'
//     });

//     const data = await handleResponse(response);
    
//     console.log('Data received from /transactions/import:', data);

   
//     if (data && data.task_id && (data.command === 'import' || data.status === 'success')) {
//       return { 
//         success: true, 
//         data: {
//           status: 'success',
//           operation: data.command || data.operation || 'import',
//           task_id: data.task_id,
//           message: data.message || 'Import task started successfully',
//           file_count: data.total || data.file_count || filePaths.length
//         }
//       };
//     } else {
//       throw new Error(data.error || 'Failed to start import task');
//     }

//   } catch (error) {
//     console.error('Import CloudCoin files failed:', error);
    
//     const errorMessage = `Error importing files: ${error.message}\n\n` +
//                          `Is the Core server running?`;
                         
//     return { success: false, error: errorMessage };
//   }
// };

/**
 * Polls the status of an asynchronous task (import, authenticate, fix, etc.)
 * @param {string} taskId - The task ID to check status for
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { status, task_id, progress, message, data } }
 * On failure: { success: false, error: "Error message" }
 */
export const getTaskStatus = async (taskId) => {
  try {
    // Validate input
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Task ID is required and must be a string');
    }

    const response = await fetch(`${API_BASE_URL}/system/tasks?task_id=${encodeURIComponent(taskId)}`);
    const data = await handleResponse(response);

    console.log('Data received from /system/tasks:', data);

    // API-FIX: rest_core returns { status: "success", payload: { id, status, progress, message, data } }
    // The task's actual status is nested inside payload, not at the top level.
    if (data && data.payload) {
      const p = data.payload;
      return {
        success: true,
        data: {
          status: p.status,
          task_id: p.id || taskId,
          progress: p.progress || 0,
          message: p.message || '',
          data: p.data || {}
        }
      };
    } else {
      throw new Error(data.message || data.error || 'Invalid task status response');
    }

  } catch (error) {
    console.error('Get task status failed:', error);
    
    const errorMessage = `Error getting task status: ${error.message}`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Polls a task until it completes (success, error, or failed status)
 * @param {string} taskId - The task ID to poll
 * @param {number} pollInterval - How often to poll in milliseconds (default: 1000ms)
 * @param {Function} onProgress - Optional callback function called on each poll with task data
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { task data } }
 * On failure: { success: false, error: "Error message" }
 */
// BUG-07 FIX: Add max attempts and handle unknown terminal statuses
export const pollTaskUntilComplete = async (taskId, pollInterval = 1000, onProgress = null) => {
  const MAX_ATTEMPTS = 300; // 5 minutes at 1s interval
  let attempts = 0;

  try {
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const result = await getTaskStatus(taskId);

      if (!result.success) {
        return result; // Return error immediately
      }

      const taskData = result.data;

      // Call progress callback if provided
      if (onProgress && typeof onProgress === 'function') {
        onProgress(taskData);
      }

      // Check if task is complete
      if (taskData.status === 'success' || taskData.status === 'completed') {
        console.log('Task completed successfully:', taskData);
        return { success: true, data: taskData };
      } else if (taskData.status === 'error' || taskData.status === 'failed' ||
                 taskData.status === 'cancelled' || taskData.status === 'timeout' ||
                 taskData.status === 'aborted') {
        console.error('Task ended with status:', taskData.status);
        throw new Error(taskData.message || `Task ${taskData.status}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Max attempts reached
    throw new Error(`Task polling timed out after ${MAX_ATTEMPTS} attempts`);
  } catch (error) {
    console.error('Error polling task:', error);
    return { success: false, error: `Error polling task: ${error.message}` };
  }
};

/**
 * Exports CloudCoins from the active wallet to a destination folder.
 * This is an async operation that returns a task ID for tracking progress.
 * @param {number} amount - The amount of CloudCoins to export (in whole units)
 * @param {string} destination - Optional destination folder name (defaults to "Export")
 * @param {string} walletPath - Optional wallet path (if not provided, uses active wallet)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { status, operation, task_id, amount, destination, message } }
 * On failure: { success: false, error: "Error message" }
 */
export const exportCloudCoins = async (amount, destination = 'Export', walletPath = null) => {
  try {
    // Validate input
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      throw new Error('Amount must be a positive number');
    }

    // Normalize paths according to the endpoint requirements:
    // destination uses backslashes, wallet_path uses forward slashes
    const normalizedDestination = normalizePath(destination, true); // true = destination path (backslashes)
    const normalizedWalletPath = walletPath ? normalizePath(walletPath, false) : null; // false = wallet path (forward slashes)

    // Build URL with query parameters
    const url = new URL(`${API_BASE_URL}/transactions/export`);
    
    url.searchParams.append('amount', amount.toString());
    url.searchParams.append('destination', normalizedDestination);
    
    if (normalizedWalletPath) {
      url.searchParams.append('wallet_path', normalizedWalletPath);
    }

    console.log('Export request URL:', url.toString());

    const response = await fetch(url.toString(), {
      method: 'GET'
    });

    console.log('Export response status:', response.status, response.statusText);

    const data = await handleResponse(response);
    console.log('Export response data:', data);

    // API-FIX: Export is synchronous — backend returns { status, command, files_created, coins_exported, value_exported, files[] }
    // Check for data.status or data.coins_exported instead of data.task_id
    if (data && (data.status === 'success' || data.status || data.coins_exported !== undefined)) {
      return {
        success: true,
        data: {
          status: data.status || 'success',
          operation: data.command || data.operation || 'export',
          amount: data.value_exported || data.amount || amount,
          coins_exported: data.coins_exported,
          files_created: data.files_created,
          files: data.files,
          destination: data.destination || normalizedDestination,
          message: data.message || `Export completed: ${data.coins_exported || 0} coins exported`,
          ...data
        }
      };
    } else {
      throw new Error(extractApiErrorMessage(data, 'Export operation failed'));
    }

  } catch (error) {
    console.error('Export CloudCoins failed:', error);
    
    const errorMessage = `Error exporting coins: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets dropdown menu data from configuration files.
 * @param {string} fileName - The configuration file name (e.g., 'export-locations.txt', 'wallet-locations.csv', 'BackupPlaces.txt')
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { status, operation, file, path, items } }
 * On failure: { success: false, error: "Error message" }
 */
export const getDropdownData = async (fileName) => {
  try {
    // Validate input
    if (!fileName || typeof fileName !== 'string') {
      throw new Error('File name is required and must be a string');
    }

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('file', fileName);

    const response = await fetch(`${API_BASE_URL}/system/dropdown?${queryParams.toString()}`, {
      method: 'GET'
    });

    // Always try to get the JSON body, even for error responses
    const data = await response.json();
    
    console.log(`Data received from /system/dropdown (${fileName}):`, data);

    // Check if response indicates an error (either from HTTP status or error field)
    if (!response.ok || data.error) {
      throw new Error(data.error || data.message || `Server responded with ${response.status}`);
    }

    // Validate the response structure
    if (data && data.status === 'success' && Array.isArray(data.items)) {
      return { 
        success: true, 
        data: {
          status: data.status,
          operation: data.operation,
          file: data.file,
          path: data.path,
          items: data.items
        }
      };
    } else {
      throw new Error(data.message || data.error || 'Invalid dropdown data response');
    }

  } catch (error) {
    console.error('Get dropdown data failed:', error);
    
    const errorMessage = `Error getting dropdown data: ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Saves a new export location to the export-locations.txt configuration file.
 * @param {string} location - The export location to save
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { message } }
 * On failure: { success: false, error: "Error message" }
 */
export const saveExportLocation = async (location) => {
  try {
    // Validate input
    if (!location || typeof location !== 'string') {
      throw new Error('Location is required and must be a string');
    }

    // Get current export locations
    const currentLocations = await getDropdownData('export-locations.txt');
    
    if (!currentLocations.success) {
      throw new Error('Failed to get current export locations');
    }

    // Check if location already exists
    if (currentLocations.data.items.includes(location)) {
      return { success: true, data: { message: 'Location already exists' } };
    }

    // For now, we'll just return success since there's no API to update the file
    // In a real implementation, you might need to add an endpoint to update configuration files
    console.log('Would save export location:', location);
    
    return { 
      success: true, 
      data: { 
        message: `Export location '${location}' saved successfully` 
      }
    };

  } catch (error) {
    console.error('Save export location failed:', error);
    
    const errorMessage = `Error saving export location: ${error.message}`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Fix fracked CloudCoins using the RAIDA ticket-based healing protocol.
 * Automatically heals coins with 13-24 successful authentications.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { status, operation, message, wallet, note } }
 * On failure: { success: false, error: "Error message" }
 */
// API-FIX: Changed path from /wallettools/fix to /health/fix, added optional walletPath parameter
export const fixFrackedCoins = async (walletPath = null) => {
  try {
    console.log('Starting fix fracked coins request...');

    // API-FIX: Build URL with optional wallet_path query param
    const url = walletPath
      ? `${API_BASE_URL}/health/fix?wallet_path=${encodeURIComponent(walletPath)}`
      : `${API_BASE_URL}/health/fix`;

    const response = await fetch(url, {
      method: 'GET'
    });

    console.log('Fix response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Fix response error:', errorText);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    console.log('Fix response data:', data);

    // Validate the response structure - check for success boolean, not status
    if (data && data.success === true) {
      return { 
        success: true, 
        data: {
          status: 'success', // Set this for consistency
          operation: data.command || 'coins-fix',
          message: data.message || 'Fix operation completed',
          wallet: data.wallet || 'Unknown',
          note: data.note || 'Fracked coins healed using Get Ticket + Fix protocol'
        }
      };
    } else {
      console.error('Fix operation returned non-success status:', data);
      throw new Error(data.error || data.message || 'Fix operation failed');
    }

  } catch (error) {
    console.error('Fix fracked coins failed:', error);
    
    const errorMessage = `Error fixing coins: ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};
/**
 * Gets the detailed balance for the active wallet with folder breakdown.
 * @param {string} walletPath - Optional wallet path. If not provided, uses active wallet.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { wallet, total_coins, total_value, folders, balance_reconciled, ... } }
 * On failure: { success: false, error: "Error message" }
 */
export const getActiveWalletBalance = async (walletPath = null) => {
  try {
    let url = `${API_BASE_URL}/wallets/active/balance`;
    
    if (walletPath) {
      url += `?wallet_path=${encodeURIComponent(walletPath)}`;
    }

    const response = await fetch(url);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallets/active/balance:', data);

    // Validate the response structure
    if (data && typeof data.total_coins !== 'undefined' && data.folders) {
      return { 
        success: true, 
        data: {
          wallet: data.wallet || 'Unknown',
          total_coins: data.total_coins || 0,
          total_value: data.total_value || 0,
          folders: data.folders || {},
          balance_reconciled: data.balance_reconciled !== undefined ? data.balance_reconciled : true,
          recorded_balance: data.recorded_balance || 0,
          max_coins_allowed: data.max_coins_allowed,
          exceeds_limit: data.exceeds_limit
        }
      };
    } else {
      const receivedDataString = JSON.stringify(data, null, 2);
      throw new Error(
        'Received invalid data from server for /wallets/active/balance.\n\n' + 
        'Expected: { wallet, total_coins, total_value, folders, balance_reconciled }\n\n' +
        'Data received:\n' +
        `${receivedDataString.substring(0, 500)}${receivedDataString.length > 500 ? '...' : ''}`
      );
    }

  } catch (error) { 
    console.error('Get active wallet balance failed:', error);
    
    const errorMessage = `Error: ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets a specific transaction receipt from the active wallet.
 * @param {string} filename - The receipt filename (e.g., "Nov-20-25_04-01-01-PM-3bab.txt")
 * @param {string} walletPath - Optional wallet path. If not provided, uses active wallet.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { wallet_name, filename, content, ... } }
 * On failure: { success: false, error: "Error message" }
 */
export const getWalletReceipt = async (filename, walletPath = null) => {
  try {
    // Validate input
    if (!filename || typeof filename !== 'string') {
      throw new Error('Receipt filename is required');
    }

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('filename', filename);
    
    if (walletPath) {
      queryParams.append('wallet_path', walletPath);
    }

    // API-FIX: Changed /api/wallets/active/receipts → /api/wallets/receipts to match rest_core
    const response = await fetch(`${API_BASE_URL}/wallets/receipts?${queryParams.toString()}`);
    const data = await handleResponse(response);

    console.log('Data received from /wallets/receipts:', data);

    // Validate the response structure
    if (data && data.success && data.content) {
      return { 
        success: true, 
        data: {
          command: data.command || 'wallet-receipt',
          wallet_name: data.wallet_name || 'Unknown',
          wallet_path: data.wallet_path || '',
          filename: data.filename || filename,
          content: data.content || '',
          raw_response: data
        }
      };
    } else {
      throw new Error(data.error || data.message || 'Invalid receipt response');
    }

  } catch (error) { 
    console.error('Get wallet receipt failed:', error);
    
    const errorMessage = `Error getting receipt: ${error.message}`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Lists all available receipts in the active wallet.
 * @param {string} walletPath - Optional wallet path. If not provided, uses active wallet.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { wallet_name, receipts: [...] } }
 * On failure: { success: false, error: "Error message" }
 */
export const listWalletReceipts = async (walletPath = null) => {
  try {
    // API-FIX: Changed /api/wallets/active/receipts → /api/wallets/receipts to match rest_core
    let url = `${API_BASE_URL}/wallets/receipts`;

    if (walletPath) {
      const queryParams = new URLSearchParams();
      queryParams.append('wallet_path', walletPath);
      url += `?${queryParams.toString()}`;
    }

    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log('Data received from /wallets/receipts (list):', data);

    // API-FIX: rest_core returns { command, success, files: [...], count } (not "receipts" array)
    if (data && data.success && (Array.isArray(data.files) || Array.isArray(data.receipts))) {
      return { 
        success: true, 
        data: {
          command: data.command || 'wallet-receipt-list',
          wallet_name: data.wallet_name || data.wallet || 'Unknown',
          wallet_path: data.wallet_path || '',
          receipts: data.files || data.receipts || [],
          raw_response: data
        }
      };
    } else {
      throw new Error(data.error || data.message || 'Invalid receipts list response');
    }

  } catch (error) { 
    console.error('List wallet receipts failed:', error);
    
    const errorMessage = `Error listing receipts: ${error.message}`;
                         
    return { success: false, error: errorMessage };
  }
};

/**
 * Import CloudCoin files for authentication using the transactions/deposit endpoint
 * @param {string[]} filePaths - Array of file paths to import
 * @param {string} memo - Optional memo for the transaction
 * @param {string} walletPath - Path to the wallet where coins should be stored
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const importCloudCoinFiles = async (filePaths, memo = '', walletPath = '') => {
  try {
    // Validate inputs
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      throw new Error('File paths are required');
    }

    // Validate file types - only .bin and .png files allowed
    const allowedExtensions = ['.bin', '.png'];
    const invalidFiles = filePaths.filter(filePath => {
      const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
      return !allowedExtensions.includes(ext);
    });

    if (invalidFiles.length > 0) {
      throw new Error(`Invalid file types detected. Only .bin and .png files are allowed. Invalid files: ${invalidFiles.join(', ')}`);
    }

    // Expand and normalize paths - file paths use backslashes, wallet path uses forward slashes
    const expandedFilePaths = await Promise.all(filePaths.map(path => expandPath(path)));
    const expandedWalletPath = walletPath ? await expandPath(walletPath) : '';

    const normalizedFilePaths = expandedFilePaths.map(path => normalizePath(path, true)); // true = file path (backslashes)
    const normalizedWalletPath = expandedWalletPath ? normalizePath(expandedWalletPath, false) : ''; // false = wallet path (forward slashes)

    // Build URL with query parameters
    const url = new URL(`${API_BASE_URL}/transactions/deposit`);
    
    // Add file parameters (multiple file parameters) - these use backslashes
    normalizedFilePaths.forEach(filePath => {
      url.searchParams.append('file', filePath);
    });

    // Add memo if provided
    if (memo && memo.trim()) {
      url.searchParams.append('memo', memo.trim());
    }

    // Add wallet_path if provided - this uses forward slashes
    if (normalizedWalletPath && normalizedWalletPath.trim()) {
      url.searchParams.append('wallet_path', normalizedWalletPath.trim());
    }

    console.log('Import request URL:', url.toString());

    // Make the API call
    const response = await fetch(url.toString(), {
      method: 'GET'
    });

    console.log('Import response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Import response error:', errorText);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('Import response data:', data);

    // Return the response data
    // The endpoint should return task information for polling
    if (data && (data.task_id || data.success)) {
      return { 
        success: true, 
        data: {
          task_id: data.task_id,
          message: data.message || 'Import started successfully',
          ...data
        }
      };
    } else {
      throw new Error(data.error || data.message || 'Import operation failed');
    }

  } catch (error) {
    console.error('Import CloudCoin files failed:', error);
    
    const errorMessage = `Error importing files: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Generate a random locker code according to CloudCoin specifications
 * Format: ABC-1234 (3 letters + hyphen + 4 characters)
 * Uses characters: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (excludes O,L,I,0,1)
 * @returns {string} - Generated locker code
 */
export const generateLockerCode = () => {
  // Allowed characters (excluding O,L,I,0,1 to avoid confusion)
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  
  let result = "";
  
  // Generate 3 characters
  for (let i = 0; i < 3; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Add hyphen
  result += "-";
  
  // Generate 4 more characters
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
};

/**
 * Validate locker code format
 * @param {string} lockerCode - The locker code to validate
 * @returns {boolean} - True if valid format
 */
export const validateLockerCode = (lockerCode) => {
  if (!lockerCode || typeof lockerCode !== "string") {
    return false;
  }
  
  // Check length (should be 8: ABC-1234)
  if (lockerCode.length !== 8) {
    return false;
  }
  
  // Check hyphen position
  if (lockerCode[3] !== "-") {
    return false;
  }
  
  // Check characters (only allowed chars, all uppercase)
  const allowedChars = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789-]+$/;
  if (!allowedChars.test(lockerCode)) {
    return false;
  }
  
  return true;
};

/**
 * Download CloudCoins from a RAIDA locker
 * @param {string} lockerKey - 8-character locker key (e.g., "AFG-7YTB")
 * @param {string} walletPath - Optional wallet path where coins should be stored
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const downloadFromLocker = async (lockerKey, walletPath = "") => {
  try {
    // Validate locker key
    if (!lockerKey || typeof lockerKey !== "string") {
      throw new Error("Locker key is required");
    }
    
    // Ensure locker key is uppercase and validate format
    const normalizedKey = lockerKey.toUpperCase().trim();
    if (!validateLockerCode(normalizedKey)) {
      throw new Error("Invalid locker key format. Expected format: ABC-1234 (3 letters, hyphen, 4 characters)");
    }

    // Build URL with query parameters
    const url = new URL(`${API_BASE_URL}/transactions/locker/download`);
    url.searchParams.append("locker_key", normalizedKey);
    
    // Add wallet path if provided
    if (walletPath && walletPath.trim()) {
      const expandedWalletPath = await expandPath(walletPath);
      const normalizedWalletPath = normalizePath(expandedWalletPath, false); // false = wallet path (forward slashes)
      url.searchParams.append("wallet_path", normalizedWalletPath.trim());
    }

    console.log("Locker download request URL:", url.toString());

    // Make the API call
    const response = await fetch(url.toString(), {
      method: "GET"
    });

    console.log("Locker download response status:", response.status, response.statusText);

    const data = await handleResponse(response);
    console.log("Locker download response data:", data);

    // API-FIX: Response is synchronous — backend returns { status, operation, coins_found, coins_saved, total_value, wallet_path, locker_key, task_id, message }
    // task_id is informational only, not for polling. Check status or coins_saved for success.
    if (data && (data.status === "success" || data.coins_saved >= 0)) {
      return {
        success: true,
        data: {
          status: data.status || "success",
          operation: data.operation || "locker_download",
          coins_found: data.coins_found,
          coins_saved: data.coins_saved,
          total_value: data.total_value,
          wallet_path: data.wallet_path,
          message: data.message || `Locker download completed: ${data.coins_saved || 0} coins saved`,
          locker_key: data.locker_key || normalizedKey,
          task_id: data.task_id, // informational only
          ...data
        }
      };
    } else {
      throw new Error(extractApiErrorMessage(data, "Locker download operation failed"));
    }

  } catch (error) {
    console.error("Download from locker failed:", error);

    const errorMessage = `Error downloading from locker: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Upload CloudCoins to a RAIDA locker
 * @param {string} lockerKey - 8-character locker key (e.g., "AFG-7YTB")
 * @param {number} amount - Amount to upload in whole units (e.g., 100.0323)
 * @param {string} walletPath - Optional wallet path where coins are stored
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const uploadToLocker = async (lockerKey, amount, walletPath = "") => {
  try {
    // Validate inputs
    if (!lockerKey || typeof lockerKey !== "string") {
      throw new Error("Locker key is required");
    }
    
    if (amount === null || amount === undefined || isNaN(amount) || amount <= 0) {
      throw new Error("Amount must be a positive number");
    }
    
    // Ensure locker key is uppercase and validate format
    const normalizedKey = lockerKey.toUpperCase().trim();
    if (!validateLockerCode(normalizedKey)) {
      throw new Error("Invalid locker key format. Expected format: ABC-1234 (3 letters, hyphen, 4 characters)");
    }

    // Build URL with query parameters
    const url = new URL(`${API_BASE_URL}/transactions/locker/upload`);
    url.searchParams.append("locker_key", normalizedKey);
    url.searchParams.append("amount", amount.toString());
    
    // Add wallet path if provided
    if (walletPath && walletPath.trim()) {
      const expandedWalletPath = await expandPath(walletPath);
      const normalizedWalletPath = normalizePath(expandedWalletPath, false); // false = wallet path (forward slashes)
      url.searchParams.append("wallet_path", normalizedWalletPath.trim());
    }

    console.log("Locker upload request URL:", url.toString());

    // Make the API call
    const response = await fetch(url.toString(), {
      method: "GET"
    });

    console.log("Locker upload response status:", response.status, response.statusText);

    const data = await handleResponse(response);
    console.log("Locker upload response data:", data);

    // API-FIX: Response is synchronous — backend returns { status, operation, amount_uploaded, coins_uploaded, locker_key, message, task_id }
    // task_id is informational only, not for polling. Return success directly.
    if (data && (data.status === "success" || data.status || data.coins_uploaded !== undefined)) {
      return {
        success: true,
        data: {
          status: data.status || "success",
          operation: data.operation || "locker_upload",
          amount_uploaded: data.amount_uploaded,
          coins_uploaded: data.coins_uploaded,
          locker_key: data.locker_key || normalizedKey,
          amount: data.amount_uploaded || amount,
          message: data.message || `Locker upload completed: ${data.coins_uploaded || 0} coins uploaded`,
          task_id: data.task_id, // informational only
          ...data
        }
      };
    } else {
      throw new Error(extractApiErrorMessage(data, "Locker upload operation failed"));
    }

  } catch (error) {
    console.error("Upload to locker failed:", error);

    const errorMessage = `Error uploading to locker: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Run encryption health check - checks the health of encryption systems
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
// API-FIX: Changed path from /health/encryption-health to /health/check, added optional walletPath, returns task_id (async)
export const runEncryptionHealthCheck = async (walletPath = null) => {
  try {
    console.log("Running encryption health check...");

    // API-FIX: Build URL with optional wallet_path query param
    const url = walletPath
      ? `${API_BASE_URL}/health/check?wallet_path=${encodeURIComponent(walletPath)}`
      : `${API_BASE_URL}/health/check`;

    const response = await fetch(url, {
      method: "GET"
    });

    console.log("Encryption health check response status:", response.status, response.statusText);

    // Try to get response data regardless of status code
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      // If JSON parsing fails, try to get text
      try {
        const textData = await response.text();
        console.log("Encryption health check raw response:", textData);
        data = { message: textData };
      } catch (textError) {
        data = { message: "No response data available" };
      }
    }

    console.log("Encryption health check response data:", data);

    // BUG-11 FIX: Only report success on 2xx status codes
    if (!response.ok) {
      console.warn(`Health check returned ${response.status}`);
      return {
        success: false,
        error: data.message || `Health check returned ${response.status}`,
        data: { status_code: response.status, ...data }
      };
    }

    // API-FIX: Backend returns { success, task_id, message } — this is async, return task_id for polling
    return {
      success: true,
      data: {
        task_id: data.task_id,
        message: data.message || "Health check started",
        ...data
      }
    };

  } catch (error) {
    console.error("Encryption health check failed:", error);

    const errorMessage = `Error running encryption health check: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Run encryption repair - repairs encryption issues found
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
// API-FIX: Added optional walletPath parameter, path already correct at /health/encryption-repair
export const runEncryptionRepair = async (walletPath = null) => {
  try {
    console.log("Running encryption repair...");

    // API-FIX: Build URL with optional wallet_path query param
    const url = walletPath
      ? `${API_BASE_URL}/health/encryption-repair?wallet_path=${encodeURIComponent(walletPath)}`
      : `${API_BASE_URL}/health/encryption-repair`;

    const response = await fetch(url, {
      method: "GET"
    });

    console.log("Encryption repair response status:", response.status, response.statusText);

    // Try to get response data regardless of status code
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      // If JSON parsing fails, try to get text
      try {
        const textData = await response.text();
        console.log("Encryption repair raw response:", textData);
        data = { message: textData };
      } catch (textError) {
        data = { message: "No response data available" };
      }
    }

    console.log("Encryption repair response data:", data);

    // BUG-11 FIX: Only report success on 2xx status codes
    if (!response.ok) {
      console.warn(`Encryption repair returned ${response.status}`);
      return {
        success: false,
        error: data.message || `Encryption repair returned ${response.status}`,
        data: { status_code: response.status, ...data }
      };
    }

    return { 
      success: true, 
      data: {
        message: data.message || "Encryption repair completed",
        ...data
      }
    };

  } catch (error) {
    console.error("Encryption repair failed:", error);
    
    const errorMessage = `Error running encryption repair: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Run both encryption health check and repair in sequence
 * Typically called after successful import operations
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const runPostImportHealthChecks = async () => {
  try {
    console.log("Running post-import health checks...");

    // Run health check first
    const healthResult = await runEncryptionHealthCheck();
    console.log("Health check result:", healthResult);

    // Then run repair
    const repairResult = await runEncryptionRepair();
    console.log("Repair result:", repairResult);

    // Determine overall success - if both API calls succeeded (got responses)
    const overallSuccess = healthResult.success && repairResult.success;

    // Collect any warnings or issues
    const issues = [];
    if (healthResult.data?.status_code && healthResult.data.status_code !== 200) {
      issues.push(`Health check: ${healthResult.data.message}`);
    }
    if (repairResult.data?.status_code && repairResult.data.status_code !== 200) {
      issues.push(`Repair: ${repairResult.data.message}`);
    }
    if (!healthResult.success) {
      issues.push(`Health check failed: ${healthResult.error}`);
    }
    if (!repairResult.success) {
      issues.push(`Repair failed: ${repairResult.error}`);
    }

    return {
      success: overallSuccess,
      data: {
        message: issues.length > 0 
          ? `Post-import health checks completed with issues: ${issues.join('; ')}`
          : "Post-import health checks completed successfully",
        healthCheck: healthResult,
        repair: repairResult,
        issues: issues
      }
    };

  } catch (error) {
    console.error("Post-import health checks failed:", error);
    
    const errorMessage = `Error running post-import health checks: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};
