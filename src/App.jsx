import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, CheckCircle, Download, X, Loader2 } from "lucide-react";
import "./App.css";
import "./UpdateModal.css";
import ServiceSelectionScreen from "./screens/ServiceSelectionScreen";
import WalletSetupScreen from "./qmail/screens/WalletSetupScreen";
import Wallet from "./wallet/Wallet";
import QMail from "./qmail/QMail";
import { clearSkipAutoRestore } from "./qmail/skipAutoRestore";
import { NotificationProvider } from "./components/common/notifications/NotificationContext";
import NotificationContainer from "./components/common/notifications/NotificationContainer";
import {
  checkVersion,
  getIdentity,
  hasId,
  normalizeIdentityForUi,
  peekBeacon,
} from "./api/qmailApiServices";

// Where all QMail software downloads live. The "Download Update" button
// opens this page in the user's default browser.
const DOWNLOAD_PAGE_URL = "https://cloudcoinconsortium.com/use.php";
const DEFAULT_TITLE_BAR_COLOR = "#C9CC3F";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const QMAIL_DISCLAIMER_TEXT = `DISCLAIMER:
This software is provided 'as-is', without any express or implied warranty.
In no event shall the authors be held liable for any damages arising from
the use of this software.

This software deals with digital currency. The value of digital currency
can fluctuate. There is no guarantee of value, and you could lose money.
Use this software at your own risk. The developers, CloudCoin Consortium,
and its affiliates are not responsible for any financial losses or damages
incurred from the use or misuse of this software.

By using this software, you acknowledge that you understand and agree to
these terms. You are solely responsible for securing your digital assets.`;
const SERVICES = {
  NONE: "none",
  PROVISIONING: "provisioning",
  WALLET: "wallet",
  QMAIL: "qmail",
};

function App() {
  const [selectedService, setSelectedService] = useState(SERVICES.NONE);
  const [provisioningData, setProvisioningData] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Starting QMail…");
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(false);
  // Guards prewarmInbox() so the background beacon check fires at most once,
  // even if both the fast path and the backend identity check confirm QMAIL.
  const inboxPrewarmedRef = useRef(false);

  const openTitleBarColorPicker = useCallback(async (initial = {}) => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      !window.electronAPI?.setTitleBarColor
    ) {
      return;
    }

    let currentColor =
      typeof initial.color === "string" && HEX_COLOR_PATTERN.test(initial.color)
        ? initial.color
        : DEFAULT_TITLE_BAR_COLOR;

    if (!initial.color && window.electronAPI.getTitleBarColor) {
      try {
        const result = await window.electronAPI.getTitleBarColor();
        if (result?.color && HEX_COLOR_PATTERN.test(result.color)) {
          currentColor = result.color;
        }
      } catch {
        /* Keep the default color. */
      }
    }

    document
      .querySelectorAll("input[data-qmail-titlebar-color-picker]")
      .forEach((node) => node.remove());

    const input = document.createElement("input");
    input.type = "color";
    input.value = currentColor;
    input.setAttribute("data-qmail-titlebar-color-picker", "true");
    input.style.position = "fixed";
    input.style.left = "-1000px";
    input.style.top = "0";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";

    input.addEventListener(
      "change",
      async () => {
        try {
          await window.electronAPI.setTitleBarColor(input.value);
        } catch (error) {
          console.error("Failed to set title bar color:", error);
        } finally {
          input.remove();
        }
      },
      { once: true }
    );

    document.body.appendChild(input);
    input.click();
  }, []);

  // Wait for the backend to be ready before kicking off identity checks. The Electron splash hides the very first window
  // of "nothing is happening", but the backend itself (core.exe) may
  // take a second or two more to bind the port. Without this probe,
  // the first identity check often fails on a cold start and the
  // app lands on ServiceSelectionScreen even when the user has a
  // valid local identity.
  const waitForBackend = async () => {
    const apiPort =
      new URLSearchParams(window.location.search).get("backendPort") ||
      import.meta.env.VITE_API_PORT ||
      "8080";
    const probeUrl = `http://localhost:${apiPort}/api/system/disclaimer`;
    const deadline = Date.now() + 15000; // 15s ceiling
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const r = await fetch(probeUrl, { method: "GET" });
        if (r.ok) return true;
      } catch {
        // expected during the cold-start window — keep trying
      }
      if (attempt === 3) {
        setLoadingMessage("Waiting for QMail backend…");
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    return false;
  };

  // Pre-warm the inbox in the BACKGROUND once we know the user has an
  // identity, so new mail is already fetched to the local DB by the time the
  // user finishes reading the disclaimer and clicks Accept. Use the quick
  // beacon PEEK, not long-poll PING; PING can legally hold the single backend
  // HTTP worker for 10 minutes. Fire-and-forget: failures are non-fatal.
  // Runs at most once (inboxPrewarmedRef).
  const prewarmInbox = () => {
    if (inboxPrewarmedRef.current) return;
    inboxPrewarmedRef.current = true;
    (async () => {
      try {
        await waitForBackend();
        await peekBeacon();
        console.log("[prewarmInbox] background beacon peek complete");
      } catch (error) {
        console.warn("[prewarmInbox] background peek failed (non-fatal):", error);
      }
    })();
  };

  useEffect(() => {
    const initializeApp = async () => {
      // The version check hits a remote URL and the local identity check
      // reads the filesystem via IPC — NEITHER depends on the backend HTTP
      // server. Kick the version check off immediately; it resolves on its
      // own schedule and the prompt is gated on backend readiness before
      // any download is attempted.
      checkForUpdates();

      // FAST PATH: the local coin-file check (hasId) does NOT wait on
      // core.exe. Run it FIRST, before waitForBackend(), so a returning
      // user lands on QMAIL immediately while the backend is still binding
      // its port. QMailDashboard's mount-time useEffect retries
      // getIdentity() to seed userAccount once the backend has indexed it.
      try {
        const idCheck = await hasId();
        console.log("[initializeApp] fast-path hasId returned:", idCheck);
        if (idCheck && idCheck.has_id) {
          clearSkipAutoRestore();
          setProvisioningData(null);
          setSelectedService(SERVICES.QMAIL);
          setIsLoading(false);
          // Start fetching mail in the background while the user reads the
          // disclaimer, so the inbox is fresh by the time they click Accept.
          prewarmInbox();
          return;
        }
      } catch (error) {
        // Fall through to the full backend-dependent flow below.
        console.error("[initializeApp] fast-path hasId failed:", error);
      }

      const ready = await waitForBackend();
      if (!ready) {
        setLoadingMessage(
          "The background of the program failed to start. There may be a conflict with ports. Try to start the program again.",
        );
        // Don't hard-block; proceed to the normal flow and let the
        // individual screens surface their own retry affordances.
      }
      // No fast-path identity — fall back to the backend identity check.
      await checkIdentity();
      // If selectedService is still SERVICES.NONE after checkIdentity(),
      // it means the identity check failed and we should stay on the service selection screen
      console.log("[initializeApp] selectedService after checks:", selectedService);
      setIsLoading(false);
    };

    initializeApp();
  }, []);

  // Listen for backend-ready signal from Electron main process.
  // When core.exe is ready to accept requests, retry identity checks
  // if they failed during the initial startup window.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;

    const handleBackendReady = async () => {
      console.log('[App] Backend ready signal received, retrying identity check...');
      // Only retry if identity check failed previously (still on ServiceSelectionScreen)
      if (selectedService === SERVICES.NONE) {
        await checkIdentity();
      }
    };

    // Listen for backend-ready event from Electron IPC
    const unsubscribe = window.electronAPI.onBackendReady(handleBackendReady);
    return unsubscribe;
  }, [selectedService]);

  useEffect(() => {
    const unsubscribe =
      window.electronAPI?.onTitleBarColorPick?.(openTitleBarColorPicker);
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [openTitleBarColorPicker]);

  // FIX-03: returning users with a configured identity should go
  // STRAIGHT to QMAIL, not bounce through WalletSetupScreen on every
  // launch. WalletSetupScreen is now first-run-only (post-import).
  const checkIdentity = async () => {
    try {
      console.log("[checkIdentity] Starting identity check...");
      const identity = await getIdentity();
      console.log("[checkIdentity] getIdentity returned:", identity);
      console.log("[checkIdentity] identity.configured =", identity?.configured);

      if (identity && identity.configured) {
        console.log("[checkIdentity] ✓ User has configured identity, going to QMAIL");
        // Returning user — normalize and seed the dashboard directly.
        clearSkipAutoRestore();
        const normalized = normalizeIdentityForUi(identity);
        console.log("[checkIdentity] Normalized identity:", normalized);
        setProvisioningData(normalized);
        setSelectedService(SERVICES.QMAIL);
        console.log("[checkIdentity] Called setSelectedService(SERVICES.QMAIL)");
        prewarmInbox();
        return;
      }

      console.log("[checkIdentity] Identity not configured (identity:", identity, "), checking hasId...");
      // Fallback: identity endpoint may not have loaded yet, but coin files
      // may already exist in the Mail wallet. Check with has-id.
      const idCheck = await hasId();
      console.log("[checkIdentity] hasId returned:", idCheck);
      if (idCheck && idCheck.has_id) {
        console.log("[checkIdentity] ✓ Coin files exist, going to QMAIL");
        // Coin files exist — go to QMAIL. QMailDashboard's mount-time
        // useEffect will retry getIdentity() and seed userAccount once
        // the backend has indexed the identity.
        clearSkipAutoRestore();
        setProvisioningData(null);
        setSelectedService(SERVICES.QMAIL);
        console.log("[checkIdentity] Called setSelectedService(SERVICES.QMAIL)");
        prewarmInbox();
        return;
      }

      console.log("[checkIdentity] ✗ No identity found, staying on ServiceSelectionScreen");
      // No identity at all — stay on ServiceSelectionScreen
    } catch (error) {
      console.error("[checkIdentity] ✗ Exception caught:", error);
      setSelectedService(SERVICES.NONE);
    }
  };

  const checkForUpdates = async () => {
    try {
      const result = await checkVersion();
      if (result.success && result.data.update_available) {
        setUpdateAvailable(result.data);
        setShowUpdateModal(true);
      }
    } catch (error) {
      console.error("Update check failed:", error);
    }
  };

  // Open the downloads page in the user's default browser. Prefers the
  // Electron shell (proper external open); falls back to window.open in a
  // plain browser/Vite build.
  const handleDownload = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(DOWNLOAD_PAGE_URL);
    } else {
      window.open(DOWNLOAD_PAGE_URL, "_blank", "noopener,noreferrer");
    }
    setShowUpdateModal(false);
  };

  // FIX-03: After a successful first-run locker import,
  // ServiceSelectionScreen calls onSelectService('provisioning',
  // identity-or-null). We always route post-import to PROVISIONING
  // (WalletSetupScreen) so the user sees the friendly welcome and
  // Heal/Make Change affordances. From there they click
  // "Go to Dashboard" to land on QMAIL.
  //
  // gpt-batch2 #2: the post-import data may be null when identity
  // hasn't registered yet — that's still a valid post-import flow.
  // The previous "if (data)" check conflated "we have data" with
  // "we're in the post-import flow"; using the service argument is
  // the correct signal.
  //
  // Returning users (auto-restore via App.checkIdentity) skip
  // PROVISIONING entirely and go straight to QMAIL.
  const handleSelectService = (service, data = null) => {
    setProvisioningData(data);
    switch (service) {
      case 'provisioning':
      case SERVICES.PROVISIONING:
        setSelectedService(SERVICES.PROVISIONING);
        break;
      case 'qmail':
      case SERVICES.QMAIL:
        setSelectedService(SERVICES.QMAIL);
        break;
      case 'wallet':
      case SERVICES.WALLET:
        setSelectedService(SERVICES.WALLET);
        break;
      default:
        setSelectedService(service);
    }
  };

  const handleSignOut = () => {
    setProvisioningData(null);
    setSelectedService(SERVICES.NONE);
  };

  const renderService = () => {
    switch (selectedService) {
      case SERVICES.PROVISIONING:
        // This is the "Wallet Screen" with Heal/Make Change buttons
        return (
          <WalletSetupScreen
            accountData={provisioningData}
            onProceed={() => setSelectedService(SERVICES.QMAIL)}
          />
        );
      case SERVICES.WALLET:
        return <Wallet />;
      case SERVICES.QMAIL:
        // FIX-03: Thread the normalized identity through so the dashboard
        // can seed userAccount synchronously. The `has_id` fallback path
        // sets provisioningData = null; in that case QMailDashboard will
        // fetch on mount.
        return (
          <QMail
            initialIdentity={provisioningData}
            onSignOut={handleSignOut}
          />
        );
      case SERVICES.NONE:
      default:
        return <ServiceSelectionScreen onSelectService={handleSelectService} />;
    }
  };

  if (!hasAcceptedDisclaimer) {
    return (
      <div className="app-shell">
        <section
          className="app-shell__disclaimer"
          aria-labelledby="qmail-disclaimer-title"
        >
          <header className="app-shell__disclaimer-header">
            <AlertTriangle size={28} className="app-shell__disclaimer-icon" />
            <h1 id="qmail-disclaimer-title">Disclaimer</h1>
          </header>
          <div className="app-shell__disclaimer-copy">
            {QMAIL_DISCLAIMER_TEXT.split("\n").map((line, index) =>
              line ? <p key={index}>{line}</p> : <br key={index} />,
            )}
          </div>
          <button
            className="app-shell__disclaimer-accept"
            type="button"
            onClick={() => setHasAcceptedDisclaimer(true)}
          >
            <CheckCircle size={18} />
            <span>Accept</span>
          </button>
        </section>
      </div>
    );
  }
  // Show loading spinner while checking identity / waiting for backend
  if (isLoading) {
    return (
      <div className="app-shell">
        <div className="app-shell__loading">
          <Loader2 className="app-shell__loading-icon spinning" size={64} />
          <div className="app-shell__loading-message">
            {loadingMessage}
          </div>
        </div>
      </div>
    );
  }

  return (
    <NotificationProvider>
      <div className="app-shell">
        {/* Update Modal */}
        {showUpdateModal && updateAvailable && (
          <div className="update-modal__overlay">
            <div className="update-modal">
              <div className="update-modal__header">
                <AlertTriangle size={48} className="update-modal__icon" />
                <h2>Update Available</h2>
                <button
                  className="update-modal__close"
                  onClick={() => setShowUpdateModal(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="update-modal__content">
                <p className="update-modal__message">{updateAvailable.message}</p>

                <div className="update-modal__version-info">
                  <div className="update-modal__version-row">
                    <span className="update-modal__version-label">Current Version:</span>
                    <span className="update-modal__version-value">
                      {updateAvailable.current_version}
                    </span>
                  </div>
                  <div className="update-modal__version-row">
                    <span className="update-modal__version-label">Latest Version:</span>
                    <span className="update-modal__version-value update-modal__version-value--highlight">
                      {updateAvailable.latest_version}
                    </span>
                  </div>
                </div>

                <p className="update-modal__description">
                  A new version of QMail is available. Click below to open the
                  downloads page in your browser, then download and install the
                  latest version.
                </p>
              </div>

              <div className="update-modal__actions">
                <button
                  className="update-modal__download-button"
                  onClick={handleDownload}
                >
                  <Download size={20} />
                  Download Update
                </button>
                <button
                  className="update-modal__later-button"
                  onClick={() => setShowUpdateModal(false)}
                >
                  Remind Me Later
                </button>
              </div>
            </div>
          </div>
        )}

        {renderService()}
      </div>
      <NotificationContainer />
    </NotificationProvider>
  );
}

export default App;
