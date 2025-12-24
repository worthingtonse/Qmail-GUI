import React from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useNotification } from './NotificationContext';
import './NotificationContainer.css';

const NotificationContainer = () => {
  const { notifications, removeNotification } = useNotification();

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={20} className="notification-icon" />;
      case 'error':
        return <AlertCircle size={20} className="notification-icon" />;
      case 'warning':
        return <AlertTriangle size={20} className="notification-icon" />;
      case 'info':
      default:
        return <Info size={20} className="notification-icon" />;
    }
  };

  const getNotificationClass = (type) => {
    const baseClass = 'notification-item';
    switch (type) {
      case 'success':
        return `${baseClass} ${baseClass}--success`;
      case 'error':
        return `${baseClass} ${baseClass}--error`;
      case 'warning':
        return `${baseClass} ${baseClass}--warning`;
      case 'info':
      default:
        return `${baseClass} ${baseClass}--info`;
    }
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={getNotificationClass(notification.type)}
        >
          <div className="notification-content">
            <div className="notification-header">
              {getIcon(notification.type)}
              <button
                className="notification-close"
                onClick={() => removeNotification(notification.id)}
                aria-label="Close notification"
              >
                <X size={18} />
              </button>
            </div>
            <div className="notification-message">
              {notification.message}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default NotificationContainer;