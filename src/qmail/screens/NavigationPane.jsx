/* eslint-disable react/prop-types */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Mail,
  Inbox,
  Send,
  Trash2,
  FileEdit,
  Copy,
  Check,
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
import { parseQmailAddress } from "../address/qmailAddress";
import QmailCartoucheAvatar from "./QmailCartoucheAvatar";
import "./NavigationPane.css";

const CLOUDCOIN_PURCHASE_URL = "https://CloudCoin.com/Pay/";

// qmailalpha.webp lives in public/; BASE_URL join matches qmailAvatar.js so
// the packaged Electron build resolves it too. Shown in place of the identity
// cartouche while the cartouche system is on hold.
const QMAIL_ALPHA_SRC = (() => {
  const baseUrl = import.meta.env?.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}qmailalpha.webp`;
})();

const DMP_PAYMENT_INFO = [
  "QMail uses an open standard protocol called DMP (Distributed Mail Protocol) that helps reduce spam, phishing, and inbox overload by using an Inbox Fee.",
  "The Inbox Fee lets recipients get paid for their attention when receiving qmails. Influencers can set their own inbox fee by registering at https://DistributedMailSystem.com.",
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

// TLD names (bit, byte, kilo, mega, giga) always display lowercase.
const lowercaseWord = (value) => String(value || "").trim().toLowerCase();

const formatQmailAddressForDisplay = (address) => {
  const text = String(address || "").trim();
  if (!text) return "";

  const atIndex = text.lastIndexOf("@");
  if (atIndex === -1) return text;

  return `${text.slice(0, atIndex)}@${lowercaseWord(text.slice(atIndex + 1))}`;
};

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
  qmailAddress = "",
}) => {
  const [raidaHealth, setRaidaHealth] = useState(null);
  const [raidaDetails, setRaidaDetails] = useState(null);
  const [healthSummary, setHealthSummary] = useState(null);
  const [qmailServers, setQmailServers] = useState(null);
  const [qmailSummary, setQmailSummary] = useState(null);
  const [showWalletPaymentInfo, setShowWalletPaymentInfo] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  // True while a server-health check is running, so concurrent triggers (button,
  // interval, isRefreshing toggle) cannot stack overlapping echo calls.
  const checkInFlightRef = useRef(false);
  const wasRefreshingRef = useRef(false);

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
        if (raida.status === "Ready") {
          statuses[index] = true;
        } else if (
          raida.status === "Error" ||
          raida.status === "Timeout" ||
          raida.status === "Offline"
        ) {
          statuses[index] = false;
        } else {
          statuses[index] = null;
        }
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

  const applyQmailServersFromEcho = useCallback(async (echoData) => {
    const qmailResult = await getServers({ echoData, skipEcho: true });
    if (qmailResult.success) {
      applyQmailServers(qmailResult.data?.servers);
    } else {
      showUnknownQmailHealth();
    }
  }, [applyQmailServers, showUnknownQmailHealth]);
  const applyCachedServerStatus = useCallback(async () => {
    const loader = window.electronAPI?.getRaidaCachedStatus;
    if (typeof loader !== "function") return false;

    try {
      const cached = await loader();
      if (!cached?.success || !Array.isArray(cached.raidas)) return false;

      const echoLikeData = {
        raidas: cached.raidas.map((raida) => ({
          index: raida.index,
          status:
            raida.is_available === true
              ? "Ready"
              : raida.is_available === false
                ? "Offline"
                : "Unknown",
          latency_ms: raida.last_response_ms,
          ip: raida.ip,
          port: raida.port,
        })),
        totalAvailable: cached.totalAvailable,
        totalError: cached.totalError,
        totalTimeout: 0,
        arrayUsable: (cached.totalAvailable ?? 0) >= 16,
      };

      applyRaidaEcho(echoLikeData);
      applyQmailServers(cached.qmailServers || []);
      return true;
    } catch (error) {
      console.warn("Cached RAIDA status unavailable:", error);
      return false;
    }
  }, [applyQmailServers, applyRaidaEcho]);

  const checkServerHealth = useCallback(async () => {
    /* Re-entrancy guard: the interval, the mount effect, and the isRefreshing
     * toggle can all fire this. Without a guard, overlapping runs stack
     * concurrent echo calls onto the (rate-limited) beacon and the status
     * panels never settle. Skip if a check is already in flight. */
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    try {
      /* ONE echo for both panels. /raida/echo already returns the status of all
       * 25 RAIDAs, including the mail/beacon servers, so the QMail server panel
       * derives its availability from this same result — no second echo, no
       * extra round trip to the beacon. */
      const raidaResult = await echoRaida();
      let usedCachedStatus = false;
      if (raidaResult.success) {
        applyRaidaEcho(raidaResult.data);
      } else {
        usedCachedStatus = await applyCachedServerStatus();
        if (!usedCachedStatus) showUnknownRaidaHealth();
      }

      // Merge the shared echo into the mail-server topology (topology is cached
      // after the first call, and skipEcho prevents a second echo on failure).
      if (raidaResult.success) {
        await applyQmailServersFromEcho(raidaResult.data);
      } else if (!usedCachedStatus) {
        showUnknownQmailHealth();
      }
    } finally {
      checkInFlightRef.current = false;
    }
  }, [
    applyCachedServerStatus,
    applyRaidaEcho,
    applyQmailServersFromEcho,
    showUnknownQmailHealth,
    showUnknownRaidaHealth,
  ]);

  useEffect(() => {
    if (isRefreshing) {
      wasRefreshingRef.current = true;
      return undefined;
    }

    let cancelled = false;
    const justFinishedRefresh = wasRefreshingRef.current;
    wasRefreshingRef.current = false;
    if (!justFinishedRefresh) {
      (async () => {
        await applyCachedServerStatus();
        if (!cancelled) checkServerHealth();
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [applyCachedServerStatus, checkServerHealth, isRefreshing]);

  useEffect(() => {
    if (isRefreshing) {
      showUnknownRaidaHealth();
      showUnknownQmailHealth();
    }
  }, [isRefreshing, showUnknownQmailHealth, showUnknownRaidaHealth]);

  useEffect(() => {
    let cancelled = false;

    const applySnapshot = async () => {
      applyRaidaEcho(raidaEchoSnapshot);
      if (!raidaEchoSnapshot) return;

      const qmailResult = await getServers({
        echoData: raidaEchoSnapshot,
        skipEcho: true,
      });
      if (cancelled) return;

      if (qmailResult.success) {
        applyQmailServers(qmailResult.data?.servers);
      } else {
        showUnknownQmailHealth();
      }
    };

    applySnapshot();
    return () => {
      cancelled = true;
    };
  }, [applyQmailServers, applyRaidaEcho, raidaEchoSnapshot, showUnknownQmailHealth]);

  const walletBalanceStatus = getWalletBalanceStatus(walletBalance);
  const walletLockedValue = getWalletLockedValue(walletBalance);
  const walletCombinedValue = getWalletCombinedValue(walletBalance);
  const walletBalanceTitle = getWalletBalanceTitle(walletBalance, walletBalanceStatus);
  const trimmedQmailAddress = String(qmailAddress || "").trim();
  const displayQmailAddress = formatQmailAddressForDisplay(trimmedQmailAddress);
  const parsedQmailAddress = useMemo(
    () => parseQmailAddress(trimmedQmailAddress),
    [trimmedQmailAddress],
  );

  const handlePurchaseCoins = () => {
    window.open(CLOUDCOIN_PURCHASE_URL, "_blank", "noopener,noreferrer");
  };

  const handleCopyAddress = async () => {
    if (!trimmedQmailAddress) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trimmedQmailAddress);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = trimmedQmailAddress;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy QMail address:", error);
    }
  };

  return (
    <aside className="navigation-pane">
      <header className="navigation-pane__compose">
        <div className="navigation-pane__identity-address-row">
          <span
            className="navigation-pane__identity-address"
            title={trimmedQmailAddress || "QMail address unavailable"}
          >
            {displayQmailAddress || "No address"}
          </span>
          <button
            type="button"
            className="navigation-pane__identity-copy"
            onClick={handleCopyAddress}
            disabled={!trimmedQmailAddress}
            title={addressCopied ? "Copied!" : "Copy QMail address"}
            aria-label={addressCopied ? "QMail address copied" : "Copy QMail address"}
          >
            {addressCopied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <section
          className="navigation-pane__identity"
          aria-label="Your QMail identity"
        >
          <div className="navigation-pane__identity-cartouche">
            {/* Cartouche system ON HOLD — to restore, uncomment this block
                and remove the qmailalpha <img> below.
            {parsedQmailAddress.ok ? (
              <QmailCartoucheAvatar
                serialNumber={parsedQmailAddress.serialNumber}
                denominationCode={parsedQmailAddress.denominationCode}
                className="navigation-pane__cartouche"
              />
            ) : (
              <Mail size={34} />
            )}
            */}
            <img
              className="navigation-pane__identity-logo"
              src={QMAIL_ALPHA_SRC}
              alt="QMail alpha"
              draggable={false}
            />
          </div>
        </section>
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
