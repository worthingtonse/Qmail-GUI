import React, { useState, useEffect } from "react";
import { AlertTriangle, Download, X, Loader2 } from "lucide-react";
import "./App.css";
import ServiceSelectionScreen from "./screens/ServiceSelectionScreen";
import WalletSetupScreen from "./qmail/screens/WalletSetupScreen";
import Wallet from "./wallet/Wallet";
import QMail from "./qmail/QMail";
import { NotificationProvider } from "./components/common/notifications/NotificationContext";
import NotificationContainer from "./components/common/notifications/NotificationContainer";
import { checkVersion, getIdentity } from "./api/qmailApiServices";

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

  useEffect(() => {
    const initializeApp = async () => {
      // Run version check and identity check in parallel on startup
      await Promise.all([checkForUpdates(), checkIdentity()]);
      setIsLoading(false);
    };

    initializeApp();
  }, []);

  const checkIdentity = async () => {
    try {
      const identity = await getIdentity();
      
      if (identity && identity.configured) {
        // Identity found: Set data and navigate to Wallet Setup Screen
        setProvisioningData(identity);
        setSelectedService(SERVICES.PROVISIONING);
      }
      // If not configured, we stay on SERVICES.NONE (ServiceSelectionScreen)
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

  const handleSelectService = (service, data = null) => {
    if (data) {
      setProvisioningData(data);
      setSelectedService(SERVICES.PROVISIONING);
    } else {
      setSelectedService(service);
    }
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
        return <QMail />;
      case SERVICES.NONE:
      default:
        return <ServiceSelectionScreen onSelectService={handleSelectService} />;
    }
  };

  // Show loading spinner while checking identity
  if (isLoading) {
    return (
      <div className="App" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Loader2 className="spinning" size={64} style={{ color: 'var(--accent-primary)' }} />
      </div>
    );
  }

  return (
    <NotificationProvider>
      <div className="App">
        {/* Update Modal */}
        {showUpdateModal && updateAvailable && (
          <div className="update-modal-overlay">
            <div className="update-modal">
              <div className="update-modal-header">
                <AlertTriangle size={48} className="update-icon" />
                <h2>Update Available</h2>
                <button
                  className="update-modal-close"
                  onClick={() => setShowUpdateModal(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="update-modal-content">
                <p className="update-message">{updateAvailable.message}</p>

                <div className="update-version-info">
                  <div className="version-row">
                    <span className="version-label">Current Version:</span>
                    <span className="version-value">
                      {updateAvailable.current_version}
                    </span>
                  </div>
                  <div className="version-row">
                    <span className="version-label">Latest Version:</span>
                    <span className="version-value highlight">
                      {updateAvailable.latest_version}
                    </span>
                  </div>
                </div>

                <p className="update-description">
                  A new version of QMail is available. Please download and
                  install the latest version to continue using the application.
                </p>
              </div>

              <div className="update-modal-actions">
                <button
                  className="update-download-btn primary"
                  onClick={handleDownload}
                >
                  <Download size={20} />
                  Download Update
                </button>
                <button
                  className="update-later-btn secondary"
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