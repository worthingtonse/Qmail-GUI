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
  AlertTriangle,
  LockKeyhole,
  LockOpen,
} from "lucide-react";
import { echoRaida, getServers } from "../../api/qmailApiServices";
import {
  RAIDA_COUNT,
  buildQmailStatusTitle,
  buildRaidaStatusTitle,
} from "./serverStatusUi";
import { parseQmailAddress } from "../address/qmailAddress";
import { useDrdSymbols } from "../avatar/drdSymbols";
import QmailCartoucheAvatar from "./QmailCartoucheAvatar";
import "./NavigationPane.css";

// qmailalpha.webp lives in public/; BASE_URL join matches qmailAvatar.js so
// the packaged Electron build resolves it too. Shown when the signed-in
// user's DRD symbols are unknown / not chosen (null cartouche).
const QMAIL_ALPHA_SRC = (() => {
  const baseUrl = import.meta.env?.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}qmailalpha.webp`;
})();

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
  folders,
  raidaEchoSnapshot,
  qmailAddress = "",
  coinFileState = null,
  onWalletAction,
}) => {
  const [raidaHealth, setRaidaHealth] = useState(null);
  const [raidaDetails, setRaidaDetails] = useState(null);
  const [healthSummary, setHealthSummary] = useState(null);
  const [qmailServers, setQmailServers] = useState(null);
  const [qmailSummary, setQmailSummary] = useState(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  // Viewport coordinates for the fixed-position wallet menu ({left, top} or
  // {left, bottom}), computed from the trigger when the menu opens. Fixed
  // positioning keeps the menu out of the pane's overflow-y scroll clipping.
  const [walletMenuPosition, setWalletMenuPosition] = useState(null);
  // True while a server-health check is running, so concurrent triggers (button,
  // interval, isRefreshing toggle) cannot stack overlapping echo calls.
  const checkInFlightRef = useRef(false);
  const wasRefreshingRef = useRef(false);
  const walletMenuRef = useRef(null);
  const walletTriggerRef = useRef(null);
  const walletMenuListRef = useRef(null);

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

  // Estimated menu box height (3 items + padding) used only to decide
  // whether the menu fits above the trigger; 11rem min width in px.
  const WALLET_MENU_HEIGHT_PX = 160;
  const WALLET_MENU_MIN_WIDTH_PX = 176;

  const closeWalletMenu = useCallback((restoreFocus = false) => {
    setWalletMenuOpen(false);
    if (restoreFocus) {
      walletTriggerRef.current?.focus();
    }
  }, []);

  const toggleWalletMenu = () => {
    if (walletMenuOpen) {
      setWalletMenuOpen(false);
      return;
    }
    const trigger = walletTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - WALLET_MENU_MIN_WIDTH_PX - 8),
    );
    // Prefer opening above the row; fall back to below near the viewport top.
    setWalletMenuPosition(
      rect.top >= WALLET_MENU_HEIGHT_PX
        ? { left, bottom: window.innerHeight - rect.top + 4 }
        : { left, top: rect.bottom + 4 },
    );
    setWalletMenuOpen(true);
  };

  useEffect(() => {
    if (!walletMenuOpen) return undefined;

    const handleMouseDown = (event) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(event.target)) {
        setWalletMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeWalletMenu(true);
      }
    };

    // The menu is position:fixed, so its coordinates go stale if anything
    // scrolls or the window resizes while it is open — just close it.
    const handleScrollOrResize = () => setWalletMenuOpen(false);

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [walletMenuOpen, closeWalletMenu]);

  // ARIA menu-button contract: focus moves into the menu when it opens.
  useEffect(() => {
    if (!walletMenuOpen) return;
    walletMenuListRef.current?.querySelector("button")?.focus();
  }, [walletMenuOpen]);

  // Arrow/Home/End cycle focus through the items; Tab closes and moves on.
  // Escape is handled by the document-level listener (restores focus).
  const handleWalletMenuKeyDown = (event) => {
    const items = Array.from(
      walletMenuListRef.current?.querySelectorAll("button") || [],
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      items[(currentIndex + delta + items.length) % items.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === "Tab") {
      setWalletMenuOpen(false);
    }
  };

  const openPurchasePage = () => {
    const url = "https://cloudcoin.com/pay/";
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleWalletMenuItem = (action) => {
    closeWalletMenu(true);
    if (action === "purchase") {
      openPurchasePage();
      return;
    }
    if (typeof onWalletAction === "function") {
      onWalletAction(action);
    }
  };

  const trimmedQmailAddress = String(qmailAddress || "").trim();
  const displayQmailAddress = formatQmailAddressForDisplay(trimmedQmailAddress);
  const parsedQmailAddress = useMemo(
    () => parseQmailAddress(trimmedQmailAddress),
    [trimmedQmailAddress],
  );
  const coinSecurityState = coinFileState?.state || "unknown";
  const coinSecurityLabel =
    coinSecurityState === "encrypted"
      ? "Coin Files: Encrypted"
      : coinSecurityState === "decrypted"
        ? "Coin Files: Decrypted"
        : "Coin Files: Mixed/Unknown";
  const CoinSecurityIcon =
    coinSecurityState === "encrypted"
      ? LockKeyhole
      : coinSecurityState === "decrypted"
        ? LockOpen
        : AlertTriangle;
  const ownDrdSymbols = useDrdSymbols(
    parsedQmailAddress.ok ? parsedQmailAddress.denominationCode : null,
    parsedQmailAddress.ok ? parsedQmailAddress.serialNumber : null,
  );

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
            {ownDrdSymbols ? (
              <QmailCartoucheAvatar
                firstSymbol={ownDrdSymbols.firstSymbol}
                secondSymbol={ownDrdSymbols.secondSymbol}
                denominationCode={parsedQmailAddress.denominationCode}
                serialNumber={parsedQmailAddress.serialNumber}
                className="navigation-pane__cartouche"
              />
            ) : (
              <img
                className="navigation-pane__identity-logo"
                src={QMAIL_ALPHA_SRC}
                alt="QMail alpha"
                draggable={false}
              />
            )}
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
        <div className="navigation-pane__wallet" ref={walletMenuRef}>
          <button
            type="button"
            ref={walletTriggerRef}
            className="navigation-pane__link navigation-pane__link--wallet-trigger"
            onClick={toggleWalletMenu}
            aria-haspopup="menu"
            aria-expanded={walletMenuOpen}
          >
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
          </button>
          {walletMenuOpen && (
            <div
              className="navigation-pane__wallet-menu"
              role="menu"
              aria-label="Wallet actions"
              ref={walletMenuListRef}
              style={walletMenuPosition || undefined}
              onKeyDown={handleWalletMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                className="navigation-pane__wallet-menu-item"
                onClick={() => handleWalletMenuItem("add")}
              >
                Add Funds
              </button>
              <button
                type="button"
                role="menuitem"
                className="navigation-pane__wallet-menu-item"
                onClick={() => handleWalletMenuItem("withdraw")}
              >
                Withdraw Funds
              </button>
              <button
                type="button"
                role="menuitem"
                className="navigation-pane__wallet-menu-item"
                onClick={() => handleWalletMenuItem("purchase")}
              >
                Purchase Coins
              </button>
            </div>
          )}
        </div>
        <div
          className={`navigation-pane__link navigation-pane__link--static navigation-pane__coin-security navigation-pane__coin-security--${coinSecurityState}`}
          title={coinSecurityLabel}
        >
          <CoinSecurityIcon size={18} />
          <span className="navigation-pane__link-label">
            {coinSecurityLabel}
          </span>
        </div>
        {parsedQmailAddress.ok && (
          <div
            className="navigation-pane__staked-row"
            title={`Your .${parsedQmailAddress.denominationName} mailbox key coin is staked to keep your QMail address active. It is still yours, but it is in use and not counted in the wallet total above.`}
          >
            <Key size={14} />
            <span className="navigation-pane__staked-label">Staked:</span>
            <span className="navigation-pane__staked-value">
              @{parsedQmailAddress.denominationName}{" "}
              {formatBalance(10 ** parsedQmailAddress.denominationCode)} CC
            </span>
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
          <span>{isRefreshing ? "Refreshing RAIDA Status..." : "Refresh RAIDA Status"}</span>
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
