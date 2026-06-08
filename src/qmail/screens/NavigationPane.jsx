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
  Key,
  Archive,
  Plus,
  Upload,
  AlertTriangle,
  ExternalLink,
  Info,
  X,
} from "lucide-react";
import { echoRaida, getServers } from "../../api/qmailApiServices";
import {
  RAIDA_COUNT,
  buildQmailStatusTitle,
  buildRaidaStatusTitle,
} from "./serverStatusUi";
import "./NavigationPane.css";

const CLOUDCOIN_PURCHASE_URL = "https://cloudcoin.com";

const DMP_PAYMENT_INFO = [
  "QMail uses an open standard protocol called DMP (Distributed Mail Protocol) that helps reduce spam, phishing, and inbox overload by using an Inbox Fee.",
  "The Inbox Fee lets recipients get paid for their attention when receiving email. Influencers can set their own inbox fee by registering at https://DistributedMailSystem.com.",
  "The DMP open standard can support up to 65 thousand different payment currencies. In Phase 1, QMail uses CloudCoin: a quantum-safe, energy-efficient, instant digital cash technology that does not require usernames, logins, or private keys. Like physical cash, it provides strong privacy.",
  "Places you can purchase CloudCoin include CloudCoin.com.",
];

const formatBalance = (value) => {
  if (value == null) return "0";
  const rounded = Math.ceil(value);
  return rounded.toLocaleString();
};

const getNumericWalletValue = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const getWalletSpendableValue = (walletBalance) =>
  getNumericWalletValue(walletBalance?.spendableValue ?? walletBalance?.totalValue);

const getWalletLockedValue = (walletBalance) =>
  getNumericWalletValue(walletBalance?.lockedValue ?? walletBalance?.lockerPool?.lockedValue);

const getWalletCombinedValue = (walletBalance) => {
  if (!walletBalance) return 0;
  const combinedValue = Number(walletBalance.combinedTotalValue);
  if (Number.isFinite(combinedValue)) return combinedValue;
  return getWalletSpendableValue(walletBalance) + getWalletLockedValue(walletBalance);
};

const getWalletBalanceStatus = (walletBalance) => {
  if (!walletBalance) return "unknown";
  const total = getWalletCombinedValue(walletBalance);
  if (total <= 0) return "empty";
  if (total <= 100) return "low";
  return "funded";
};

const getWalletBalanceTitle = (walletBalance, status) => {
  if (!walletBalance) return "Default wallet balance";

  const total = formatBalance(getWalletCombinedValue(walletBalance));
  const spendable = formatBalance(getWalletSpendableValue(walletBalance));
  const locked = walletBalance.lockerPoolError
    ? "unknown"
    : formatBalance(getWalletLockedValue(walletBalance));
  const breakdown = `Total ${total} CC (${spendable} spendable, ${locked} in lockers).`;

  if (status === "empty") return "Wallet is empty. Purchase or add CloudCoins before sending mail.";
  if (status === "low") return `Wallet balance is low. ${breakdown}`;
  return `Default wallet balance. ${breakdown}`;
};

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
  onAddFundsClick,
  onWithdrawClick,
  folders,
  raidaEchoSnapshot,
}) => {
  const [raidaHealth, setRaidaHealth] = useState(null);
  const [raidaDetails, setRaidaDetails] = useState(null);
  const [healthSummary, setHealthSummary] = useState(null);
  const [qmailServers, setQmailServers] = useState(null);
  const [qmailSummary, setQmailSummary] = useState(null);
  const [showWalletPaymentInfo, setShowWalletPaymentInfo] = useState(false);

  const showUnknownRaidaHealth = useCallback(() => {
    setRaidaHealth(null);
    setRaidaDetails(null);
    setHealthSummary(null);
  }, []);

  const showUnknownQmailHealth = useCallback(() => {
    setQmailServers((previous) =>
      Array.isArray(previous)
        ? previous.map((server) => ({
            ...server,
            is_available: null,
            latency_ms: null,
          }))
        : null,
    );
    setQmailSummary(null);
  }, []);

  const applyRaidaEcho = useCallback((data) => {
    if (!data || !Array.isArray(data.raidas)) {
      showUnknownRaidaHealth();
      return;
    }

    const statuses = Array.from({ length: RAIDA_COUNT }, () => null);
    const details = Array.from({ length: RAIDA_COUNT }, () => null);
    data.raidas.forEach((raida, fallbackIndex) => {
      const index = Number.isInteger(raida.index) ? raida.index : fallbackIndex;
      if (index >= 0 && index < RAIDA_COUNT) {
        statuses[index] = raida.status === "Ready";
        details[index] = raida;
      }
    });

    setRaidaHealth(statuses);
    setRaidaDetails(details);
    setHealthSummary({
      available:
        data.totalAvailable ?? statuses.filter((status) => status === true).length,
      error: data.totalError ?? statuses.filter((status) => status === false).length,
      timeout: data.totalTimeout ?? 0,
      usable: data.arrayUsable,
    });
  }, [showUnknownRaidaHealth]);

  const applyQmailServers = useCallback((servers) => {
    if (!Array.isArray(servers)) {
      showUnknownQmailHealth();
      return;
    }

    setQmailServers(servers);
    setQmailSummary({
      available: servers.filter((server) => server.is_available === true).length,
      total: servers.length,
    });
  }, [showUnknownQmailHealth]);

  const checkServerHealth = useCallback(async () => {
    const qmailResult = await getServers();

    if (qmailResult.success) {
      applyQmailServers(qmailResult.data?.servers);
      if (qmailResult.data?.raidaEcho) {
        applyRaidaEcho(qmailResult.data.raidaEcho);
      } else {
        showUnknownRaidaHealth();
      }
      return;
    }

    showUnknownQmailHealth();
    const raidaResult = await echoRaida();
    if (raidaResult.success) {
      applyRaidaEcho(raidaResult.data);
    } else {
      showUnknownRaidaHealth();
    }
  }, [
    applyQmailServers,
    applyRaidaEcho,
    showUnknownQmailHealth,
    showUnknownRaidaHealth,
  ]);

  useEffect(() => {
    if (isRefreshing) return undefined;

    checkServerHealth();
    const interval = setInterval(checkServerHealth, 120000);
    return () => clearInterval(interval);
  }, [checkServerHealth, isRefreshing]);

  useEffect(() => {
    if (isRefreshing) {
      showUnknownRaidaHealth();
      showUnknownQmailHealth();
    }
  }, [isRefreshing, showUnknownQmailHealth, showUnknownRaidaHealth]);

  useEffect(() => {
    applyRaidaEcho(raidaEchoSnapshot);
  }, [applyRaidaEcho, raidaEchoSnapshot]);

  const walletBalanceStatus = getWalletBalanceStatus(walletBalance);
  const walletLockedValue = getWalletLockedValue(walletBalance);
  const walletCombinedValue = getWalletCombinedValue(walletBalance);
  const walletBalanceTitle = getWalletBalanceTitle(walletBalance, walletBalanceStatus);

  const handlePurchaseCoins = () => {
    window.open(CLOUDCOIN_PURCHASE_URL, "_blank", "noopener,noreferrer");
  };

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
                {count && count.unread > 0 && folder.name !== "sent" && folder.name !== "trash" && (
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


        {/* Future wallet details navigation:
            onClick={() => setActiveView("account")} */}
        <div className="navigation-pane__link navigation-pane__link--static">
          <Wallet size={18} />
          <span className="navigation-pane__link-label">Wallet</span>
          {walletBalance && (
            <span
              className={`navigation-pane__wallet-balance navigation-pane__wallet-balance--${walletBalanceStatus}`}
              title={walletBalanceTitle}
              aria-label={walletBalanceTitle}
            >
              {(walletBalanceStatus === "empty" || walletBalanceStatus === "low") && (
                <AlertTriangle size={12} className="navigation-pane__wallet-balance-icon" />
              )}
              {formatBalance(walletCombinedValue)} CC
            </span>
          )}
        </div>
        <div className="navigation-pane__link navigation-pane__link--static">
          <Key size={18} />
          <span className="navigation-pane__link-label">In Lockers</span>
          {walletBalance && (
            <span
              className="navigation-pane__locker-balance"
              title="Coins pre-funded into locker codes"
              aria-label={`In lockers ${walletBalance.lockerPoolError ? "unknown" : formatBalance(walletLockedValue)} CC`}
            >
              {walletBalance.lockerPoolError ? "--" : formatBalance(walletLockedValue)} CC
            </span>
          )}
        </div>
        <div className="navigation-pane__wallet-actions" aria-label="Wallet actions">
          <button
            type="button"
            className="navigation-pane__wallet-action"
            onClick={onAddFundsClick}
            title="Add Funds"
            aria-label="Add Funds"
          >
            <Plus size={14} />
            <span>Add Funds</span>
          </button>
          <button
            type="button"
            className="navigation-pane__wallet-action"
            onClick={onWithdrawClick}
            title="Withdraw"
            aria-label="Withdraw"
          >
            <Upload size={14} />
            <span>Withdraw</span>
          </button>
        </div>
        <div className="navigation-pane__wallet-purchase-row">
          <button
            type="button"
            className="navigation-pane__wallet-action navigation-pane__wallet-action--purchase"
            onClick={handlePurchaseCoins}
            title="Purchase Coins"
            aria-label="Purchase Coins"
          >
            <ExternalLink size={14} />
            <span>Purchase Coins</span>
          </button>
          <button
            type="button"
            className="navigation-pane__wallet-info-button"
            onClick={() => setShowWalletPaymentInfo((show) => !show)}
            title="Why payments are needed"
            aria-label="Why payments are needed"
            aria-expanded={showWalletPaymentInfo}
          >
            <Info size={14} />
          </button>
        </div>
        {showWalletPaymentInfo && (
          <div
            className="navigation-pane__wallet-info-popover"
            role="dialog"
            aria-label="Why QMail payments are needed"
          >
            <button
              type="button"
              className="navigation-pane__wallet-info-close"
              onClick={() => setShowWalletPaymentInfo(false)}
              aria-label="Close payment information"
            >
              <X size={14} />
            </button>
            {DMP_PAYMENT_INFO.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        )}
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
          className="navigation-pane__status"
          aria-label="Server health"
        >
          <div className="navigation-pane__status-row">
            <div className="navigation-pane__status-header">
              <span>QMail</span>
              <span>
                {qmailSummary
                  ? `${qmailSummary.available}/${qmailSummary.total} servers`
                  : "Checking..."}
              </span>
            </div>
            {Array.isArray(qmailServers) && qmailServers.length > 0 && (
              <div className="navigation-pane__status-grid navigation-pane__status-grid--qmail">
                {qmailServers.map((server, index) => {
                  const serverId = server.server_id ?? server.raida_index ?? index;
                  const isOnline = server.is_available;
                  return (
                    <span
                      key={serverId}
                      className={`navigation-pane__raida-dot ${
                        isOnline === true
                          ? "navigation-pane__raida-dot--online"
                          : isOnline === false
                            ? "navigation-pane__raida-dot--offline"
                            : "navigation-pane__raida-dot--unknown"
                      }`}
                      title={buildQmailStatusTitle(server, index)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="navigation-pane__status-row">
            <div className="navigation-pane__status-header">
              <span>RAIDA</span>
              <span>
                {healthSummary
                  ? `${healthSummary.available}/${RAIDA_COUNT} servers`
                  : "Checking..."}
              </span>
            </div>
            <div className="navigation-pane__status-grid navigation-pane__status-grid--raida">
              {Array.from({ length: RAIDA_COUNT }, (_, index) => {
                const isOnline = raidaHealth ? raidaHealth[index] : null;
                const detail = raidaDetails ? raidaDetails[index] : null;
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
                    title={buildRaidaStatusTitle(index, isOnline, detail)}
                  />
                );
              })}
            </div>
          </div>
        </section>
      </footer>
    </aside>
  );
};

export default NavigationPane;
