/* eslint-disable react/prop-types */
import { useState, useEffect, useCallback } from "react";
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

const DEFAULT_FOLDER_ICONS = {
  inbox: Inbox,
  sent: Send,
  drafts: FileEdit,
  trash: Trash2,
  starred: Star,
  archive: Archive,
};

const ALLOWED_FOLDER_ICONS = {
  archive: Archive,
  draft: FileEdit,
  drafts: FileEdit,
  fileedit: FileEdit,
  inbox: Inbox,
  mail: Mail,
  send: Send,
  sent: Send,
  star: Star,
  starred: Star,
  trash: Trash2,
};

const normalizeIconName = (value) =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const getFolderIcon = (folder) => {
  const override =
    ALLOWED_FOLDER_ICONS[normalizeIconName(folder.iconName)] ||
    ALLOWED_FOLDER_ICONS[normalizeIconName(folder.icon)];
  if (override) return override;

  return DEFAULT_FOLDER_ICONS[normalizeIconName(folder.name)] || Mail;
};

const NavigationPane = ({
  activeView,
  setActiveView,
  onComposeClick,
  mailCounts,
  onRefresh,
  isRefreshing,
  walletBalance,
  folders,
  raidaEchoSnapshot,
}) => {
  const [raidaHealth, setRaidaHealth] = useState(null);
  const [healthSummary, setHealthSummary] = useState(null);

  const applyRaidaEcho = useCallback((data) => {
    if (!data || !Array.isArray(data.raidas)) return;
    const statuses = data.raidas.map((raida) => raida.status === "Ready");
    setRaidaHealth(statuses);
    setHealthSummary({
      available: data.totalAvailable,
      error: data.totalError,
      timeout: data.totalTimeout,
      usable: data.arrayUsable,
    });
  }, []);

  const checkServerHealth = useCallback(async () => {
    const result = await echoRaida();
    if (result.success) {
      applyRaidaEcho(result.data);
    }
  }, [applyRaidaEcho]);

  useEffect(() => {
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 120000);
    return () => clearInterval(interval);
  }, [checkServerHealth]);

  useEffect(() => {
    applyRaidaEcho(raidaEchoSnapshot);
  }, [applyRaidaEcho, raidaEchoSnapshot]);

  return (
    <aside className="navigation-pane">
      <header className="navigation-pane__compose">
        <button
          className="navigation-pane__compose-button"
          onClick={onComposeClick}
          type="button"
        >
          <FileEdit size={18} />
          <span>Compose</span>
        </button>
      </header>

      <nav className="navigation-pane__nav" aria-label="Mailbox folders">
        {folders &&
          folders.map((folder) => {
            const IconComponent = getFolderIcon(folder);
            const count = mailCounts[folder.name];
            const isActive = activeView === folder.name;

            return (
              <button
                key={folder.name}
                type="button"
                className={`navigation-pane__link ${
                  isActive ? "navigation-pane__link--active" : ""
                }`}
                onClick={() => setActiveView(folder.name)}
              >
                <IconComponent size={18} />
                <span className="navigation-pane__link-label">
                  {folder.displayName}
                </span>
                {count && count.unread > 0 && folder.name !== "trash" && (
                  <span className="navigation-pane__count">{count.unread}</span>
                )}
                {count &&
                  count.unread === 0 &&
                  count.total > 0 &&
                  folder.name !== "inbox" &&
                  folder.name !== "trash" && (
                    <span className="navigation-pane__count navigation-pane__count--info">
                      {count.total}
                    </span>
                  )}
              </button>
            );
          })}

        <button
          type="button"
          className={`navigation-pane__link ${
            activeView === "contacts" ? "navigation-pane__link--active" : ""
          }`}
          onClick={() => setActiveView("contacts")}
        >
          <Users size={18} />
          <span className="navigation-pane__link-label">Contacts</span>
        </button>

        <button
          type="button"
          className={`navigation-pane__link ${
            activeView === "account" ? "navigation-pane__link--active" : ""
          }`}
          onClick={() => setActiveView("account")}
        >
          <Wallet size={18} />
          <span className="navigation-pane__link-label">Wallet</span>
          {walletBalance && (
            <span className="navigation-pane__wallet-balance">
              {formatBalance(walletBalance.totalValue)} CC
            </span>
          )}
        </button>
      </nav>

      <footer className="navigation-pane__footer">
        <button
          className="navigation-pane__refresh-button"
          onClick={onRefresh}
          disabled={isRefreshing}
          type="button"
        >
          <RefreshCw size={16} className={isRefreshing ? "spinning" : ""} />
          <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
        </button>

        <section
          className="navigation-pane__raida"
          aria-label="RAIDA server health"
        >
          <div className="navigation-pane__raida-grid">
            {Array.from({ length: RAIDA_COUNT }, (_, index) => {
              const isOnline = raidaHealth ? raidaHealth[index] : null;
              return (
                <span
                  key={index}
                  className={`navigation-pane__raida-dot ${
                    isOnline === true
                      ? "navigation-pane__raida-dot--online"
                      : isOnline === false
                        ? "navigation-pane__raida-dot--offline"
                        : "navigation-pane__raida-dot--unknown"
                  }`}
                  title={`RAIDA ${index}: ${
                    isOnline === true
                      ? "Online"
                      : isOnline === false
                        ? "Offline"
                        : "Unknown"
                  }`}
                />
              );
            })}
          </div>
          <span className="navigation-pane__raida-text">
            {healthSummary
              ? `${healthSummary.available}/${RAIDA_COUNT} servers`
              : "Checking..."}
          </span>
        </section>
      </footer>
    </aside>
  );
};

export default NavigationPane;
