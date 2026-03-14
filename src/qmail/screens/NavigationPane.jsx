import React, { useState, useEffect } from "react";
import {
  Mail,
  Inbox,
  Send,
  Trash2,
  FileEdit,
  Star,
  Users,
  RefreshCw,
  Wallet,
  Archive,
} from "lucide-react";
import { echoRaida } from "../../api/qmailApiServices";
import "./NavigationPane.css";

const formatBalance = (value) => {
  if (value == null) return "0";
  const rounded = Math.ceil(value);
  return rounded.toLocaleString();
};

const RAIDA_COUNT = 25;

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
  // Icon mapping — includes starred and archive
  const folderIcons = {
    inbox: Inbox,
    sent: Send,
    drafts: FileEdit,
    trash: Trash2,
    starred: Star,
    archive: Archive,
  };

  // Per-server health state: array of 25 booleans (true = online)
  const [raidaHealth, setRaidaHealth] = useState(null);
  const [healthSummary, setHealthSummary] = useState(null);

  const checkServerHealth = async () => {
    const result = await echoRaida();
    if (result.success) {
      const statuses = result.data.raidas.map((r) => r.status === "Ready");
      setRaidaHealth(statuses);
      setHealthSummary({
        available: result.data.totalAvailable,
        error: result.data.totalError,
        timeout: result.data.totalTimeout,
        usable: result.data.arrayUsable,
      });
    }
  };

  // Check health on mount and every 2 minutes
  useEffect(() => {
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 120000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="navigation-pane">
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
              {count && count.unread > 0 && folder.name !== 'trash' && (
                <span className="email-count">{count.unread}</span>
              )}
              {count && count.unread === 0 && count.total > 0 && folder.name !== 'inbox' && folder.name !== 'trash' && (
                <span className="email-count-info">{count.total}</span>
              )}
            </a>
          );
        })}

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
          <Wallet size={18} />
          <span>Wallet</span>
          {walletBalance && (
            <span className="wallet-balance-inline">{formatBalance(walletBalance.totalValue)} CC</span>
          )}
        </a>
      </nav>

      {/* Labels — not yet implemented, commented out for now */}
      {/* <div className="labels-section">
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
      </div> */}

      <div className="refresh-container">
        <button
          className="refresh-button secondary"
          onClick={async () => {
            onRefresh();
            checkServerHealth();
          }}
          disabled={isRefreshing}
        >
          <RefreshCw size={16} className={isRefreshing ? "spinning" : ""} />
          <span>{isRefreshing ? "Refreshing..." : "Check Connection"}</span>
        </button>

        {/* RAIDA Server Health Grid: 25 dots, green=online red=offline */}
        <div className="raida-health-section">
          <div className="raida-health-grid">
            {Array.from({ length: RAIDA_COUNT }, (_, i) => {
              const isOnline = raidaHealth ? raidaHealth[i] : null;
              return (
                <div
                  key={i}
                  className={`raida-dot ${isOnline === true ? "raida-online" : isOnline === false ? "raida-offline" : "raida-unknown"}`}
                  title={`RAIDA ${i}: ${isOnline === true ? "Online" : isOnline === false ? "Offline" : "Unknown"}`}
                />
              );
            })}
          </div>
          <span className="raida-health-text">
            {healthSummary
              ? `${healthSummary.available}/${RAIDA_COUNT} servers`
              : "Checking..."}
          </span>
        </div>
      </div>
    </aside>
  );
};

export default NavigationPane;
