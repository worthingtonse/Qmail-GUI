import { useState, useEffect } from "react";
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
} from "./api/qmailApiServices";

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

  // Wait for the backend to be ready before kicking off identity /
  // version checks. The Electron splash hides the very first window
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
    const probeUrl = `http://localhost:${apiPort}/api/system/version-check`;
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

  useEffect(() => {
    const initializeApp = async () => {
      const ready = await waitForBackend();
      if (!ready) {
        setLoadingMessage(
          "QMail backend didn't respond. The app will keep trying — you can also restart QMail.",
        );
        // Don't hard-block; proceed to the normal flow and let the
        // individual screens surface their own retry affordances.
      }
      // Run version check and identity check in parallel on startup
      await Promise.all([checkForUpdates(), checkIdentity()]);
      setIsLoading(false);
    };

    initializeApp();
  }, []);

  // FIX-03: returning users with a configured identity should go
  // STRAIGHT to QMAIL, not bounce through WalletSetupScreen on every
  // launch. WalletSetupScreen is now first-run-only (post-import).
  const checkIdentity = async () => {
    try {
      const identity = await getIdentity();

      if (identity && identity.configured) {
        // Returning user — normalize and seed the dashboard directly.
        clearSkipAutoRestore();
        setProvisioningData(normalizeIdentityForUi(identity));
        setSelectedService(SERVICES.QMAIL);
        return;
      }

      // Fallback: identity endpoint may not have loaded yet, but coin files
      // may already exist in the Mail wallet. Check with has-id.
      const idCheck = await hasId();
      if (idCheck && idCheck.has_id) {
        // Coin files exist — go to QMAIL. QMailDashboard's mount-time
        // useEffect will retry getIdentity() and seed userAccount once
        // the backend has indexed the identity.
        clearSkipAutoRestore();
        setProvisioningData(null);
        setSelectedService(SERVICES.QMAIL);
        return;
      }

      // No identity at all — stay on ServiceSelectionScreen
    } catch (error) {
      console.error("Failed to restore identity:", error);
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

  const detectOS = () => {
    const platform = window.navigator.platform.toLowerCase();
    if (platform.includes("win")) return "windows";
    if (platform.includes("mac")) return "mac";
    if (platform.includes("linux")) return "linux";
    return "windows";
  };

  const handleDownload = () => {
    if (!updateAvailable) return;

    const os = detectOS();
    let downloadUrl = updateAvailable.download_url_windows;

    if (os === "mac") {
      downloadUrl = updateAvailable.download_url_mac;
    } else if (os === "linux") {
      downloadUrl = updateAvailable.download_url_linux;
    }

    window.open(downloadUrl, "_blank");
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
                  A new version of QMail is available. Please download and
                  install the latest version to continue using the application.
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
