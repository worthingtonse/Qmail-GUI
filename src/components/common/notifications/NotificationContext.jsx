/* eslint-disable react-refresh/only-export-components, react/prop-types */
import { createContext, useContext, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

const NotificationContext = createContext();

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(notification => notification.id !== id));
  }, []);

  const addNotification = useCallback((message, type = 'info', optionsOrDuration = 5000) => {
    const id = uuidv4();
    const options =
      typeof optionsOrDuration === 'number'
        ? { duration: optionsOrDuration }
        : optionsOrDuration || {};
    const duration = options.duration ?? 5000;
    const notification = {
      ...options,
      id,
      message,
      type, // 'success', 'error', 'info', 'warning'
      timestamp: options.timestamp ?? Date.now(),
      duration
    };

    setNotifications(prev => [...prev, notification]);

    // Auto-remove notification after duration (if duration > 0)
    if (duration > 0) {
      setTimeout(() => {
        removeNotification(id);
      }, duration);
    }

    return id;
  }, [removeNotification]);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Convenience methods
  const showSuccess = useCallback((message, optionsOrDuration) => {
    return addNotification(message, 'success', optionsOrDuration);
  }, [addNotification]);

  const showError = useCallback((message, optionsOrDuration = 8000) => {
    return addNotification(message, 'error', optionsOrDuration);
  }, [addNotification]);

  const showInfo = useCallback((message, optionsOrDuration) => {
    return addNotification(message, 'info', optionsOrDuration);
  }, [addNotification]);

  const showWarning = useCallback((message, optionsOrDuration) => {
    return addNotification(message, 'warning', optionsOrDuration);
  }, [addNotification]);

  const value = {
    notifications,
    addNotification,
    removeNotification,
    clearAllNotifications,
    showSuccess,
    showError,
    showInfo,
    showWarning
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
