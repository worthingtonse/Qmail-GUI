import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useNotification } from './NotificationContext';
import './NotificationContainer.css';

const NotificationContainer = () => {
  const { notifications, removeNotification } = useNotification();

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={20} className="notification-container__icon" />;
      case 'error':
        return <AlertCircle size={20} className="notification-container__icon" />;
      case 'warning':
        return <AlertTriangle size={20} className="notification-container__icon" />;
      case 'info':
      default:
        return <Info size={20} className="notification-container__icon" />;
    }
  };

  const getNotificationClass = (notification) => {
    const baseClass = 'notification-container__item';
    const typeClass = (() => {
      switch (notification.type) {
        case 'success':
          return `${baseClass}--success`;
        case 'error':
          return `${baseClass}--error`;
        case 'warning':
          return `${baseClass}--warning`;
        case 'info':
        default:
          return `${baseClass}--info`;
      }
    })();

    const classes = [baseClass, typeClass];
    if (typeof notification.onClick === 'function') {
      classes.push(`${baseClass}--clickable`);
    }
    return classes.join(' ');
  };

  const activateNotification = (notification) => {
    if (typeof notification.onClick !== 'function') return;
    notification.onClick(notification);
    removeNotification(notification.id);
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <aside
      className="notification-container"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Notifications"
    >
      {notifications.map((notification) => (
        <article
          key={notification.id}
          className={getNotificationClass(notification)}
          role={typeof notification.onClick === 'function' ? 'button' : 'status'}
          tabIndex={typeof notification.onClick === 'function' ? 0 : undefined}
          onClick={
            typeof notification.onClick === 'function'
              ? () => activateNotification(notification)
              : undefined
          }
          onKeyDown={(event) => {
            if (
              typeof notification.onClick === 'function' &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault();
              activateNotification(notification);
            }
          }}
        >
          <div className="notification-container__content">
            <header className="notification-container__header">
              {getIcon(notification.type)}
              <button
                className="notification-container__close"
                onClick={(event) => {
                  event.stopPropagation();
                  removeNotification(notification.id);
                }}
                aria-label="Close notification"
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <p className="notification-container__message">
              {notification.message}
            </p>
          </div>
        </article>
      ))}
    </aside>
  );
};

export default NotificationContainer;
