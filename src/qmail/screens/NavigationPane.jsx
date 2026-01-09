import React from "react";
import {
  Mail,
  Inbox,
  Send,
  Trash2,
  FileEdit,
  Star,
  Tag,
  Users,
  UserCircle,
  RefreshCw,
  Coins
} from "lucide-react";
import "./NavigationPane.css";

const NavigationPane = ({
  activeView,
  setActiveView,
  onComposeClick,
  mailCounts,
  onRefresh,
  isRefreshing,
  draftsCount,
  serverHealth,
  walletBalance,
  folders 
}) => {
  // Icon mapping
  const folderIcons = {
    inbox: Inbox,
    sent: Send,
    drafts: FileEdit,
    trash: Trash2
  };
  
  return (
    <aside className="navigation-pane">
      {/* Wallet Balance Display */}
      {walletBalance && (
        <div className="wallet-balance-header">
          <div className="balance-info">
            <Coins size={16} />
            <span className="balance-value">{walletBalance.totalValue.toFixed(1)} CC</span>
          </div>
        </div>
      )}
      <div className="compose-button-container">
        <button className="compose-button primary" onClick={onComposeClick}>
          <FileEdit size={18} />
          <span>Compose</span>
        </button>
      </div>
      <nav className="nav-links">
        {folders && folders.map((folder) => {
          const IconComponent = folderIcons[folder.name] || Mail;
          const count = mailCounts[folder.name];
          
          return (
            <a  key={folder.name}
              href="#"
              className={`nav-link ${activeView === folder.name ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveView(folder.name);
              }}
            >
              <IconComponent size={18} />
              <span>{folder.displayName}</span>
              {count && count.unread > 0 && (
                <span className="email-count">{count.unread}</span>
              )}
              {count && count.unread === 0 && count.total > 0 && folder.name !== 'inbox' && (
                <span className="email-count-info">{count.total}</span>
              )}
            </a>
          );
        })}
        
        <a href="#" className="nav-link">
          <Star size={18} />
          <span>Starred</span>
        </a>
        <a
          href="#"
          className={`nav-link ${activeView === "contacts" ? "active" : ""}`}
          onClick={(e) => {
            e.preventDefault();
            setActiveView("contacts");
          }}
        >
          <Users size={18} />
          <span>Contacts</span>
        </a>
        <a
          href="#"
          className={`nav-link ${activeView === "account" ? "active" : ""}`}
          onClick={(e) => {
            e.preventDefault();
            setActiveView("account");
          }}
        >
          <UserCircle size={18} />
          <span>Account</span>
        </a>
      </nav>
      <div className="labels-section">
        <h3 className="labels-title">
          <Tag size={16} />
          <span>Labels</span>
        </h3>
        <div className="label-links">
          <a href="#" className="label-link">
            <span className="label-dot label-work"></span>
            <span>Work</span>
          </a>
          <a href="#" className="label-link">
            <span className="label-dot label-development"></span>
            <span>Development</span>
          </a>
          <a href="#" className="label-link">
            <span className="label-dot label-personal"></span>
            <span>Personal</span>
          </a>
          <a href="#" className="label-link">
            <span className="label-dot label-deployment"></span>
            <span>Deployment</span>
          </a>
        </div>
      </div>
      <div className="refresh-container">
        <button
          className="refresh-button secondary"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw size={16} className={isRefreshing ? "spinning" : ""} />
          <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
        </button>
        
        {/* Connection Status Indicator */}
        <div className="connection-status">
          <div className={`status-dot ${serverHealth?.status === "healthy" ? "status-online" : "status-offline"}`}></div>
          <span className="status-text">
            {serverHealth?.status === "healthy" ? "Connected" : "Offline"}
          </span>
        </div>
      </div>
    </aside>
  );
};

export default NavigationPane;