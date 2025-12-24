import { useNotification } from './NotificationContext';
import { useCallback } from 'react';

/**
 * Custom hook for handling API responses with automatic notifications
 * Uses actual API messages instead of custom frontend messages
 * @returns {Object} API handling functions
 */
export const useApiNotifications = () => {
  const { showSuccess, showError, showInfo, showWarning } = useNotification();

  /**
   * Handle API response and show appropriate notification using API messages
   * @param {Promise} apiCall - The API function call
   * @param {Object} options - Configuration options
   * @param {boolean} options.showSuccess - Whether to show success notification (default: true)
   * @param {boolean} options.showError - Whether to show error notification (default: true)
   * @param {Function} options.onSuccess - Callback for successful API calls
   * @param {Function} options.onError - Callback for failed API calls
   * @param {string} options.fallbackSuccessMessage - Fallback if API has no message
   * @param {string} options.fallbackErrorMessage - Fallback if API has no error message
   * @returns {Promise} API response or error
   */
  const handleApiCall = useCallback(async (apiCall, options = {}) => {
    const {
      showSuccess: shouldShowSuccess = true,
      showError: shouldShowError = true,
      onSuccess,
      onError,
      fallbackSuccessMessage = 'Operation completed successfully',
      fallbackErrorMessage = 'Operation failed'
    } = options;

    try {
      const result = await apiCall;

      if (result.success) {
        // Show success notification using API message
        if (shouldShowSuccess) {
          const successMessage = result.message || 
                                result.data?.message || 
                                fallbackSuccessMessage;
          showSuccess(successMessage);
        }

        // Call success callback if provided
        if (onSuccess) {
          onSuccess(result);
        }

        return result;
      } else {
        // Handle API failure (success: false) - use API error message
        if (shouldShowError) {
          const errorMessage = result.error || 
                              result.message || 
                              result.data?.error ||
                              fallbackErrorMessage;
          showError(errorMessage);
        }

        // Call error callback if provided
        if (onError) {
          onError(result);
        }

        return result;
      }
    } catch (error) {
      // Handle network/unexpected errors
      if (shouldShowError) {
        const errorMessage = error.message || 'Network error occurred';
        showError(errorMessage);
      }

      // Call error callback if provided
      if (onError) {
        onError({ success: false, error: error.message });
      }

      // Re-throw to allow calling code to handle if needed
      throw error;
    }
  }, [showSuccess, showError]);

  /**
   * Handle import operations using API messages
   */
  const handleImport = useCallback(async (apiCall, options = {}) => {
    return handleApiCall(apiCall, {
      fallbackSuccessMessage: 'Files imported successfully!',
      fallbackErrorMessage: 'Import operation failed',
      ...options
    });
  }, [handleApiCall]);

  /**
   * Handle locker operations using API messages
   */
  const handleLockerOperation = useCallback(async (apiCall, operationType, options = {}) => {
    const fallbackMessages = {
      download: 'Coins downloaded from locker successfully!',
      upload: 'Coins uploaded to locker successfully!'
    };

    return handleApiCall(apiCall, {
      fallbackSuccessMessage: fallbackMessages[operationType] || 'Locker operation completed!',
      fallbackErrorMessage: `Locker ${operationType} operation failed`,
      ...options
    });
  }, [handleApiCall]);

  /**
   * Handle wallet operations using API messages
   */
  const handleWalletOperation = useCallback(async (apiCall, operationType, options = {}) => {
    const fallbackMessages = {
      balance: 'Wallet balance updated',
      export: 'Wallet exported successfully!',
      create: 'Wallet created successfully!'
    };

    return handleApiCall(apiCall, {
      fallbackSuccessMessage: fallbackMessages[operationType] || 'Wallet operation completed!',
      fallbackErrorMessage: `Wallet ${operationType} operation failed`,
      ...options
    });
  }, [handleApiCall]);

  /**
   * Handle RAIDA operations using API messages
   */
  const handleRaidaOperation = useCallback(async (apiCall, options = {}) => {
    return handleApiCall(apiCall, {
      fallbackSuccessMessage: 'RAIDA operation completed successfully!',
      fallbackErrorMessage: 'RAIDA operation failed',
      ...options
    });
  }, [handleApiCall]);

  /**
   * Show a generic info message
   */
  const showInfoMessage = useCallback((message, duration) => {
    showInfo(message, duration);
  }, [showInfo]);

  /**
   * Show a generic warning message
   */
  const showWarningMessage = useCallback((message, duration) => {
    showWarning(message, duration);
  }, [showWarning]);

  /**
   * Show a generic success message
   */
  const showSuccessMessage = useCallback((message, duration) => {
    showSuccess(message, duration);
  }, [showSuccess]);

  /**
   * Show a generic error message
   */
  const showErrorMessage = useCallback((message, duration) => {
    showError(message, duration);
  }, [showError]);

  return {
    handleApiCall,
    handleImport,
    handleLockerOperation,
    handleWalletOperation,
    handleRaidaOperation,
    showInfoMessage,
    showWarningMessage,
    showSuccessMessage,
    showErrorMessage
  };
};

export default useApiNotifications;