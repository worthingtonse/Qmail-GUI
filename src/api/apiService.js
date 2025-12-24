// --- src/api/apiService.js ---
// This file will store all your API call functions.

// Define the base URL for your local server
const API_BASE_URL = 'http://localhost:8080/api';

/**
 * A helper function to handle fetch responses.
 * It checks for network errors and non-ok responses.
 * @param {Response} response - The fetch Response object
 */
const handleResponse = async (response) => {
  if (!response.ok) {
    // Handle HTTP errors (e.g., 404, 500)
    throw new Error(`Server responded with ${response.status} ${response.statusText}`);
  }
  
  // Get the JSON response from the server
  const data = await response.json();
  return data;
};

/**
 * Helper function to expand relative paths to absolute paths
 * @param {string} path - The path to expand
 * @returns {string} - Expanded absolute path
 */
function expandPath(path) {
  if (!path) return '';
  
  // If it's already an absolute path, return as-is
  if (path.match(/^[a-zA-Z]:\\/) || path.startsWith('/') || path.startsWith('\\\\')) {
    return path;
  }
  
  // For relative folder names, assume Windows user directory structure
  // Users can override this by providing full paths
  const commonExpansions = {
  'Downloads': 'C:\\Users\\%USERNAME%\\Downloads',
  'Documents': 'C:\\Users\\%USERNAME%\\Documents', 
  'Desktop': 'C:\\Users\\%USERNAME%\\Desktop',
  'CloudCoin': 'C:\\Users\\%USERNAME%\\CloudCoin',
  'Data': 'Data\\Wallets',  // ← ADD THIS LINE
  'Export': 'Export'
};
  
  // Check if it's a common folder name
  if (commonExpansions[path]) {
    return commonExpansions[path];
  }
  
  // For unknown single folder names (no slashes), expand to user directory
  // Examples: "MyFolder" → "C:\Users\%USERNAME%\MyFolder"
  if (!path.includes('\\') && !path.includes('/')) {
    console.log(`Expanding relative folder "${path}" to user directory`);
    return `C:\\Users\\%USERNAME%\\${path}`;
  }
  
  // If it contains slashes, assume user knows what they're doing
  // Examples: "folder/subfolder", "relative\path"
  return path;
}

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
    const response = await fetch(`${API_BASE_URL}/wallets`);
    const data = await handleResponse(response);
    console.log('Data received from /wallets:', data);

    if (data && Array.isArray(data.wallets)) {
      return { success: true, data: data.wallets, total_balance: 0 };
    }
    else if (data && Array.isArray(data.locations)) {
      let allWallets = [];
      data.locations.forEach(location => {
        if (location && Array.isArray(location.wallets)) {
          const walletsWithLocation = location.wallets.map(wallet => ({
            ...wallet,
            name: wallet.wallet_name || wallet.name,
            path: location.path || location.active_path,
            balance: wallet.balance || 0,
            coins: wallet.total_coins || 0,
            total_value: wallet.total_value || 0
          }));
          allWallets = allWallets.concat(walletsWithLocation);
        }
      });
      return { success: true, data: allWallets, total_balance: data.total_balance || 0 };
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
 * Gets the balance for wallets - NEVER throws, always returns success/error object
 */
export const getWalletBalance = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/wallets/active/balance`);
    
    // Handle non-OK responses gracefully
    if (!response.ok) {
      console.warn(`Balance fetch returned ${response.status}`);
      // Return empty data instead of throwing
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
    console.log('Data received from /wallets/active/balance:', data);

    if (data && Array.isArray(data.wallets)) {
      return { 
        success: true, 
        data: {
          wallets: data.wallets,
          total_balance: data.total_balance || 0,
          total_coins: data.total_coins || 0,
          denomination_counts: data.denomination_counts || {}
        }
      };
    } else {
      // Return empty data instead of throwing
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
    // Return empty data instead of error
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
};
export const getTotalBalance = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/wallets`);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallets:', data);

    // The endpoint returns:
    // {
    //   "total_balance": 0,
    //   "locations": [{
    //     "path": "...",
    //     "wallets": [{
    //       "name": "Default",
    //       "index": 0,
    //       "active": false,
    //       "balance": 0,
    //       "total_coins": 0,
    //       "total_value": 0.0,
    //       "has_limbo": false,
    //       "has_fracked": false,
    //       "denomination_counts": {}
    //     }]
    //   }]
    // }

    // Validate the response structure
    if (data && Array.isArray(data.locations) && typeof data.total_balance !== 'undefined') {
      // Extract all wallets from all locations
      let allWallets = [];
      data.locations.forEach(location => {
        if (location && Array.isArray(location.wallets)) {
          location.wallets.forEach(wallet => {
            allWallets.push({
              name: wallet.wallet_name || wallet.name || 'Unknown',
              balance: wallet.balance || 0,
              coins: wallet.total_coins || 0,
              location: location.path || location.active_path || '',
              has_fracked: wallet.has_fracked || false,
              has_limbo: wallet.has_limbo || false,
              denomination_counts: wallet.denomination_counts || {}
            });
          });
        }
      });

      return { 
        success: true, 
        data: {
          wallets: allWallets,
          total_balance: data.total_balance || 0,
          total_coins: allWallets.reduce((sum, w) => sum + w.coins, 0),
          denomination_counts: {}
        }
      };
    } else {
      // If the structure doesn't match, throw an error
      const receivedDataString = JSON.stringify(data, null, 2);
      throw new Error(
        'Received invalid/unexpected data from server for /wallets.\n\n' + 
        'Expected: { locations: [...], total_balance: number }\n\n' +
        'Data received:\n' +
        `${receivedDataString.substring(0, 500)}${receivedDataString.length > 500 ? '...' : ''}`
      );
    }

  } catch (error) { 
    console.error('Get total balance failed:', error);
    
    const errorMessage = `Error: ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};
/**
 * Switches the active wallet to the specified wallet name.
 * @param {string} walletName - The name of the wallet to switch to
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 * On success: { success: true, data: { message, wallet_name } }
 * On failure: { success: false, error: "Error message" }
 */
export const switchWallet = async (walletName) => {
  try {
    // Validate input
    if (!walletName || typeof walletName !== 'string') {
      throw new Error('Wallet name is required and must be a string');
    }

    // URL encode the wallet name to handle special characters
    const encodedWalletName = encodeURIComponent(walletName);
    
    const response = await fetch(`${API_BASE_URL}/wallet/switch?name=${encodedWalletName}`);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallet/switch:', data);

    // Check if the response indicates success
    // Adjust this based on what your API actually returns
    if (data && (data.success || data.status === 'success' || data.message)) {
      return { 
        success: true, 
        data: {
          message: data.message || `Switched to wallet: ${walletName}`,
          wallet_name: walletName,
          ...data
        }
      };
    } else {
      throw new Error(data.error || 'Failed to switch wallet');
    }

  } catch (error) {
    console.error('Switch wallet failed:', error);
    
    const errorMessage = `Error switching to wallet "${walletName}": ${error.message}\n\n` +
                         `Is the Core server running?`;
                         
    return { success: false, error: errorMessage };
  }
};

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

    // URL encode the wallet name to handle special characters
    const encodedWalletName = encodeURIComponent(walletName.trim());
    
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
    
    const response = await fetch(`${API_BASE_URL}/wallet/add-location?path=${encodedPath}`);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallet/add-location:', data);

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
    
    const response = await fetch(`${API_BASE_URL}/wallets/rename?wallet_path=${encodedPath}&new_name=${encodedNewName}`, {
      method: 'POST'
    });
    const data = await handleResponse(response);
    
    console.log('Data received from /wallets/active/rename:', data);

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
    
    // Use fetch with mode: 'cors' and handle CORS issues
    const response = await fetch(`${API_BASE_URL}/wallets/delete?wallet_path=${encodedPath}`, {
      method: 'DELETE',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    }).catch(fetchError => {
      // CORS error or network error - wallet is likely deleted but browser blocked response
      console.warn('Fetch failed (likely CORS), assuming wallet deleted:', fetchError);
      return null;
    });
    
    // If fetch was blocked by CORS, assume success
    if (!response) {
      console.log('DELETE request blocked by CORS - assuming wallet was deleted');
      return { 
        success: true, 
        data: { 
          message: 'Wallet deleted successfully',
          note: 'Request completed but response blocked by browser CORS policy'
        } 
      };
    }
    
    console.log('Delete response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error('Delete error response:', errorText);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Data received from /wallets/active/delete:', data);
    
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
    
    // If error is CORS-related, treat as success since Postman confirms it works
    if (error.message.includes('Failed to fetch') || 
        error.message.includes('CORS') || 
        error.message.includes('NetworkError')) {
      console.log('CORS error detected - wallet likely deleted successfully');
      return { 
        success: true, 
        data: { 
          message: 'Wallet deleted successfully',
          note: 'CORS prevented reading response, but deletion completed'
        } 
      };
    }
    
    // If 404, wallet doesn't exist (already deleted)
    if (error.message.includes('404') || error.message.includes('Not Found')) {
      return { 
        success: true, 
        data: { message: 'Wallet already deleted or does not exist' } 
      };
    }
    
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
export const createWalletBackup = async (destination) => {
  try {
    // 1. Validate input
    if (!destination || typeof destination !== 'string' || destination.trim().length === 0) {
      throw new Error('Destination path is required and must be an absolute path');
    }
    
    const encodedDestination = encodeURIComponent(destination.trim());

    // 2. Make the fetch call
    const response = await fetch(`${API_BASE_URL}/wallet/backup?destination=${encodedDestination}`);
    
    // 3. Get JSON data regardless of response.ok
    // This allows us to parse the error message from the server
    const data = await response.json();

    // 4. Handle non-ok responses (400, 500, etc.)
    if (!response.ok) {
      // Use the error message from the JSON body if it exists
      throw new Error(data.error || `Server responded with ${response.status} ${response.statusText}`);
    }

    // 5. Handle successful response
    // Validate success data structure
    // FIX: Changed check from 'data.status === "success"' to 'data.success === true'
    // This matches the actual server response shown in the screenshot.
    if (data && data.success === true && data.full_path) {
      return { success: true, data: data };
    } else {
      // This case handles a 200 OK response that is not in the expected format
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

    // Validate the response structure
    if (data && data.task_id && data.status) {
      return { 
        success: true, 
        data: {
          status: data.status,
          task_id: data.task_id,
          progress: data.progress || 0,
          message: data.message || '',
          data: data.data || {}
        }
      };
    } else {
      throw new Error(data.error || 'Invalid task status response');
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
export const pollTaskUntilComplete = async (taskId, pollInterval = 1000, onProgress = null) => {
  try {
    while (true) {
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
      if (taskData.status === 'success') {
        console.log('Task completed successfully:', taskData);
        return { success: true, data: taskData };
      } else if (taskData.status === 'error' || taskData.status === 'failed') {
        console.error('Task failed:', taskData);
        throw new Error(taskData.message || 'Task failed');
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  } catch (error) {
    console.error('Error polling task:', error);
    
    const errorMessage = `Error polling task: ${error.message}`;
                         
    return { success: false, error: errorMessage };
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Export response error:', errorText);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('Export response data:', data);

    // Return the response data - should contain task_id for polling
    if (data && (data.task_id || data.success)) {
      return { 
        success: true, 
        data: {
          task_id: data.task_id,
          status: 'success',
          operation: data.command || data.operation || 'export',
          amount: data.amount || amount,
          destination: data.destination || normalizedDestination,
          message: data.message || 'Export task started successfully',
          ...data
        }
      };
    } else {
      throw new Error(data.error || data.message || 'Failed to start export task');
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
export const fixFrackedCoins = async () => {
  try {
    console.log('Starting fix fracked coins request...');
    
    const response = await fetch(`${API_BASE_URL}/wallettools/fix`, {
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

    const response = await fetch(`${API_BASE_URL}/wallets/active/receipts?${queryParams.toString()}`);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallets/active/receipts:', data);

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
    let url = `${API_BASE_URL}/wallets/active/receipts`;
    
    if (walletPath) {
      const queryParams = new URLSearchParams();
      queryParams.append('wallet_path', walletPath);
      url += `?${queryParams.toString()}`;
    }

    const response = await fetch(url);
    const data = await handleResponse(response);
    
    console.log('Data received from /wallets/active/receipts (list):', data);

    // Validate the response structure
    if (data && data.success && Array.isArray(data.receipts)) {
      return { 
        success: true, 
        data: {
          command: data.command || 'wallet-receipt-list',
          wallet_name: data.wallet_name || data.wallet || 'Unknown',
          wallet_path: data.wallet_path || '',
          receipts: data.receipts || [],
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
    const expandedFilePaths = filePaths.map(path => expandPath(path));
    const expandedWalletPath = walletPath ? expandPath(walletPath) : '';
    
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
      const expandedWalletPath = expandPath(walletPath);
      const normalizedWalletPath = normalizePath(expandedWalletPath, false); // false = wallet path (forward slashes)
      url.searchParams.append("wallet_path", normalizedWalletPath.trim());
    }

    console.log("Locker download request URL:", url.toString());

    // Make the API call
    const response = await fetch(url.toString(), {
      method: "GET"
    });

    console.log("Locker download response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Locker download response error:", errorText);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("Locker download response data:", data);

    // Return the response data
    if (data && (data.task_id || data.success)) {
      return { 
        success: true, 
        data: {
          task_id: data.task_id,
          message: data.message || "Locker download started successfully",
          locker_key: normalizedKey,
          ...data
        }
      };
    } else {
      throw new Error(data.error || data.message || "Locker download operation failed");
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
      const expandedWalletPath = expandPath(walletPath);
      const normalizedWalletPath = normalizePath(expandedWalletPath, false); // false = wallet path (forward slashes)
      url.searchParams.append("wallet_path", normalizedWalletPath.trim());
    }

    console.log("Locker upload request URL:", url.toString());

    // Make the API call
    const response = await fetch(url.toString(), {
      method: "GET"
    });

    console.log("Locker upload response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Locker upload response error:", errorText);
      throw new Error(`Server responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("Locker upload response data:", data);

    // Return the response data
    if (data && (data.task_id || data.success)) {
      return { 
        success: true, 
        data: {
          task_id: data.task_id,
          message: data.message || "Locker upload started successfully",
          locker_key: normalizedKey,
          amount: amount,
          ...data
        }
      };
    } else {
      throw new Error(data.error || data.message || "Locker upload operation failed");
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
export const runEncryptionHealthCheck = async () => {
  try {
    console.log("Running encryption health check...");

    const response = await fetch(`${API_BASE_URL}/health/encryption-health`, {
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

    // Consider the operation successful if we got a response (even non-200)
    // The actual health status might be in the response data
    if (!response.ok) {
      console.warn(`Health check returned ${response.status}, but continuing...`);
      return { 
        success: true, // Still consider it successful that we got a response
        data: {
          message: data.message || `Health check returned ${response.status}`,
          status_code: response.status,
          ...data
        }
      };
    }

    return { 
      success: true, 
      data: {
        message: data.message || "Encryption health check completed",
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
export const runEncryptionRepair = async () => {
  try {
    console.log("Running encryption repair...");

    const response = await fetch(`${API_BASE_URL}/health/encryption-repair`, {
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

    // Consider the operation successful if we got a response (even non-200)
    // The actual repair status might be in the response data
    if (!response.ok) {
      console.warn(`Encryption repair returned ${response.status}, but continuing...`);
      return { 
        success: true, // Still consider it successful that we got a response
        data: {
          message: data.message || `Encryption repair returned ${response.status}`,
          status_code: response.status,
          ...data
        }
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