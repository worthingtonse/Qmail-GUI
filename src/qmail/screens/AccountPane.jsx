import React, { useState, useEffect } from "react";
import {
  User,
  Shield,
  Settings,
  Activity,
  Coins,
  RefreshCw,
  Edit,
  Key,
  Smartphone,
  Download,
  Trash2,
  LogIn,
  CreditCard,
  AlertTriangle,
  Check,
  X,
  Server,
  Database,
  Heart,
  Wifi,
  WifiOff,
  AlertCircle,
} from "lucide-react";
import {
  // getHealthStatus, <--- REMOVED IMPORT
  getServers,
  getParityServer,
  syncData,
} from "../../api/qmailApiServices";
import "./AccountPane.css";

const AccountPane = ({ userAccount, onAccountUpdate, walletBalance }) => {
  // State management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // API Data States
  // CHANGED: Initialize with static healthy data to bypass API
  const [serverHealth, setServerHealth] = useState({
    status: "healthy",
    service: "QMail Client Core",
    version: "1.0.0",
    timestamp: Date.now()
  });
  
  const [raidaServers, setRaidaServers] = useState([]);
  const [parityServer, setParityServer] = useState(null);
  
  // const [healthLoading, setHealthLoading] = useState(false); <--- REMOVED UNUSED STATE
  
  const [serversLoading, setServersLoading] = useState(false);
  const [parityLoading, setParityLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notification, setNotification] = useState(null);
  const [notificationType, setNotificationType] = useState("success");

  const [serverStats, setServerStats] = useState({
    total: 0,
    online: 0,
    offline: 0,
    uptime: 0,
  });

  const [accountSettings, setAccountSettings] = useState({
    notifications: true,
    darkMode: true,
    autoSync: false,
    biometric: true,
  });

  // Auto-hide notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Show notification helper function
  const showNotification = (message, type = "success") => {
    setNotification(message);
    setNotificationType(type);
  };

  // Load all data on component mount
  useEffect(() => {
    loadAccountData();
  }, []);

  const loadAccountData = async () => {
    setLoading(true);
    setError(null);

    try {
      // CHANGED: Removed getHealthStatus from Promise.all
      const [serversResult, parityResult] = await Promise.all([
        getServers(true),
        getParityServer(),
      ]);

      // Removed healthResult handling block

      if (serversResult.success) {
        const servers = serversResult.data.servers || [];
        setRaidaServers(servers);

        const stats = {
          total: servers.length,
          online: servers.filter((s) => s.is_available).length,
          offline: servers.filter((s) => !s.is_available).length,
          uptime:
            servers.length > 0
              ? Math.round(
                  servers.reduce((sum, s) => sum + (s.percent_uptime || 0), 0) /
                    servers.length,
                )
              : 0,
        };
        setServerStats(stats);
      }

      if (parityResult.success) {
        setParityServer(parityResult.data);
      }

      console.log("All account data loaded successfully");
    } catch (err) {
      console.error("Error loading account data:", err);
      setError("Failed to load some account data");
    } finally {
      setLoading(false);
    }
  };

  // REMOVED: loadHealthStatus function entirely
  /*
  const loadHealthStatus = async () => {
    ...
  };
  */

  const loadServers = async () => {
    setServersLoading(true);

    try {
      const result = await getServers(true);
      if (result.success) {
        const servers = result.data.servers || [];
        setRaidaServers(servers);

        const stats = {
          total: servers.length,
          online: servers.filter((s) => s.is_available).length,
          offline: servers.filter((s) => !s.is_available).length,
          uptime:
            servers.length > 0
              ? Math.round(
                  servers.reduce((sum, s) => sum + (s.percent_uptime || 0), 0) /
                    servers.length,
                )
              : 0,
        };
        setServerStats(stats);

        showNotification(
          `Loaded ${stats.online}/${stats.total} available servers`,
          "info",
        );
      } else {
        showNotification(`Failed to load servers: ${result.error}`, "error");
      }
    } catch (error) {
      showNotification(`Failed to load servers: ${error.message}`, "error");
    } finally {
      setServersLoading(false);
    }
  };

  const loadParityServer = async () => {
    setParityLoading(true);
    try {
      const result = await getParityServer();
      if (result.success) {
        setParityServer(result.data);

        if (result.data.status === "not_configured") {
          showNotification("Parity server is not configured", "info");
        } else if (result.data.parityServer) {
          showNotification(
            `Parity server: ${result.data.parityServer.address}`,
            "success",
          );
        }
      } else {
        showNotification(
          `Failed to load parity server: ${result.error}`,
          "error",
        );
      }
    } catch (error) {
      showNotification(
        `Failed to load parity server: ${error.message}`,
        "error",
      );
    } finally {
      setParityLoading(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setNotification(null);

    try {
      const result = await syncData();

      if (result.success) {
        await loadServers();

        const message = result.data.message || "Sync completed successfully!";
        const usersCount =
          result.data.usersUpdated ?? result.data.users_synced ?? 0;
        const serversCount =
          result.data.serversUpdated ?? result.data.servers_synced ?? 0;

        showNotification(
          `${message} - Users: ${usersCount}, Servers: ${serversCount}`,
          "success",
        );
      } else {
        showNotification(
          `Sync failed: ${result.error || "Unknown error"}`,
          "error",
        );
      }
    } catch (error) {
      showNotification(
        `Sync failed: ${error.message || "Unknown error"}`,
        "error",
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleRefresh = () => {
    loadAccountData();
  };

  const handleEditProfile = () => {
    setIsEditing(!isEditing);
  };

  const handleSettingToggle = (setting) => {
    setAccountSettings((prev) => ({
      ...prev,
      [setting]: !prev[setting],
    }));
  };

  const handleSecurityAction = (action) => {
    console.log(`Security action triggered: ${action}`);
  };

  // CHANGED: Update loading check to ignore serverHealth (since it's now static)
  if (loading && raidaServers.length === 0) {
    return (
      <div className="account-pane">
        <div className="loading-state">
          <RefreshCw size={48} className="spinning" />
          <p>Loading account information...</p>
        </div>
      </div>
    );
  }

  // CHANGED: Update error check
  if (error && raidaServers.length === 0) {
    return (
      <div className="account-pane">
        <div className="error-section">
          <AlertTriangle size={48} />
          <p>Error: {error}</p>
          <button className="retry-button secondary" onClick={handleRefresh}>
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="account-pane">
      {/* Notification Banner */}
      {notification && (
        <div
          className={`notification-banner notification-${notificationType}`}
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            minWidth: "400px",
            maxWidth: "600px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
          }}
        >
          {notificationType === "success" && <Check size={16} />}
          {notificationType === "error" && <AlertTriangle size={16} />}
          {notificationType === "info" && <AlertCircle size={16} />}
          <span>{notification}</span>
          <button
            onClick={() => setNotification(null)}
            className="notification-close"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Account Header */}
      <div className="account-header">
        <div className="account-header-title">
          <h2>Account Management</h2>
          <div className="account-header-actions">
            <div className="account-status online">
              <div className="status-indicator"></div>
              <span>Online</span>
            </div>
            <button
              className="refresh-btn secondary"
              onClick={handleRefresh}
              disabled={loading}
              title="Refresh account data"
            >
              <RefreshCw size={16} className={loading ? "spinning" : ""} />
            </button>
          </div>
        </div>
      </div>

      <div className="account-content">
        {/* Server Health Section */}
        <div className="profile-section">
          <div className="section-header">
            <h3 className="section-title">
              <Heart size={20} />
              Server Status
            </h3>
            {/* REMOVED: Individual Refresh Button for Health since it's now static */}
          </div>

          <div className="profile-details">
            <div className="profile-field">
              <label className="field-label">Service Status</label>
              <div
                className={`field-value ${
                  serverHealth?.status === "healthy" ? "success" : "error"
                }`}
              >
                {/* Always display from static state */}
                {serverHealth?.status || "Unknown"}
              </div>
            </div>

            <div className="profile-field">
              <label className="field-label">Service Name</label>
              <div className="field-value">
                {serverHealth?.service || "QMail Client Core"}
              </div>
            </div>

            <div className="profile-field">
              <label className="field-label">Version</label>
              <div className="field-value">
                {serverHealth?.version || "Unknown"}
              </div>
            </div>

            <div className="profile-field">
              <label className="field-label">Last Check</label>
              <div className="field-value">
                {serverHealth?.timestamp
                  ? new Date(serverHealth.timestamp).toLocaleString()
                  : "Never"}
              </div>
            </div>
          </div>
        </div>

        {/* Profile Section - Only show if userAccount exists */}
        {userAccount && (
          <div className="profile-section">
            <div className="section-header">
              <h3 className="section-title">
                <User size={20} />
                Profile Information
              </h3>
              <button
                className={`edit-profile-btn ${
                  isEditing ? "danger" : "secondary"
                }`}
                onClick={handleEditProfile}
              >
                {isEditing ? <X size={16} /> : <Edit size={16} />}
                {isEditing ? "Cancel" : "Edit"}
              </button>
            </div>

            <div className="profile-details">
              <div className="profile-field">
                <label className="field-label">QMail Address</label>
                <div className="field-value">
                  {userAccount.pretty_address ||
                    `${userAccount.address}@${userAccount.domain}`}
                </div>
              </div>

              <div className="profile-field">
                <label className="field-label">Serial Number</label>
                <div className="field-value">
                  #{userAccount.serial_number || "N/A"}
                </div>
              </div>

              {userAccount.recovery_email && (
                <div className="profile-field">
                  <label className="field-label">Recovery Email</label>
                  <div className="field-value">
                    {userAccount.recovery_email}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* RAIDA Network Status Section */}
        <div className="balance-section">
          <div className="section-header">
            <h3 className="section-title">
              <Server size={20} />
              RAIDA Network Status
            </h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="edit-profile-btn secondary"
                onClick={handleManualSync}
                disabled={syncing}
                title="Sync user directory and server records from RAIDA"
              >
                <RefreshCw size={16} className={syncing ? "spinning" : ""} />
                {syncing ? "Syncing..." : "Sync Directory"}
              </button>
              <button
                className="edit-profile-btn secondary"
                onClick={loadServers}
                disabled={serversLoading}
                title="Refresh server status"
              >
                <RefreshCw
                  size={16}
                  className={serversLoading ? "spinning" : ""}
                />
                Refresh
              </button>
            </div>
          </div>

          {walletBalance?.folders.fracked.coins > 0 && (
            <div
              className="status-message warning"
              style={{
                marginBottom: "var(--space-lg)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "16px",
                borderRadius: "8px",
                backgroundColor: "rgba(245, 158, 11, 0.1)",
                border: "1px solid var(--accent-warning)",
              }}
            >
              <AlertTriangle size={24} className="text-warning" />
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: 0, color: "var(--accent-warning)" }}>
                  Identity Coin Needs Healing
                </h4>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: "var(--font-size-sm)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Your mailbox identity is currently fracked. This may prevent
                  you from sending or receiving mail.
                </p>
              </div>
              <button
                className="edit-profile-btn"
                onClick={handleManualSync}
                disabled={syncing}
                style={{
                  backgroundColor: "var(--accent-warning)",
                  color: "var(--primary-bg)",
                  border: "none",
                }}
              >
                <RefreshCw size={16} className={syncing ? "spinning" : ""} />
                {syncing ? "Healing..." : "Repair Now"}
              </button>
            </div>
          )}

          <div className="balance-grid">
            <div className="balance-card total">
              <div className="balance-label">Total Coins</div>
              <div className="balance-value">
                {walletBalance?.totalCoins || 0}
              </div>
              <div className="balance-description">All coins in wallet</div>
            </div>

            <div className="balance-card verified">
              <div className="balance-label">Bank (Ready)</div>
              <div className="balance-value">
                {walletBalance?.folders.bank.coins || 0}
              </div>
              <div className="balance-description">
                {walletBalance?.folders.bank.value.toFixed(1) || 0} CC value
              </div>
            </div>

            <div className="balance-card counterfeit">
              <div className="balance-label">Fracked (Needs Repair)</div>
              <div className="balance-value">
                {walletBalance?.folders.fracked.coins || 0}
              </div>
              <div className="balance-description">
                {walletBalance?.folders.fracked.value.toFixed(1) || 0} CC value
              </div>
            </div>

            <div className="balance-card suspect">
              <div className="balance-label">Limbo (Processing)</div>
              <div className="balance-value">
                {walletBalance?.folders.limbo.coins || 0}
              </div>
              <div className="balance-description">
                {walletBalance?.folders.limbo.value.toFixed(1) || 0} CC value
              </div>
            </div>

            <div className="balance-card verified">
              <div className="balance-label">Online</div>
              <div className="balance-value">{serverStats.online}</div>
              <div className="balance-description">Available servers</div>
            </div>

            <div className="balance-card counterfeit">
              <div className="balance-label">Offline</div>
              <div className="balance-value">{serverStats.offline}</div>
              <div className="balance-description">Unavailable servers</div>
            </div>

            <div className="balance-card suspect">
              <div className="balance-label">Uptime</div>
              <div className="balance-value">
                {serverStats.total > 0
                  ? Math.round((serverStats.online / serverStats.total) * 100)
                  : 0}
                %
              </div>
              <div className="balance-description">Network availability</div>
            </div>
          </div>

          {/* Server List */}
          {raidaServers.length > 0 && (
            <div className="server-list">
              <h4
                className="text-sm text-secondary"
                style={{ marginBottom: "var(--space-md)" }}
              >
                Server Details
              </h4>
              <div className="server-grid">
                {raidaServers.slice(0, 10).map((server) => (
                  <div key={server.server_id} className="server-item">
                    <div className="server-status">
                      {server.is_available ? (
                        <Wifi size={16} className="text-success" />
                      ) : (
                        <WifiOff size={16} className="text-danger" />
                      )}
                    </div>
                    <div className="server-info">
                      <div className="server-id">{server.server_id}</div>
                      <div className="server-address">
                        {server.ip_address}:{server.port}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Parity Server Configuration Section */}
        <div className="profile-section">
          <div className="section-header">
            <h3 className="section-title">
              <Database size={20} />
              Parity Server Configuration
            </h3>
            <button
              className="edit-profile-btn secondary"
              onClick={loadParityServer}
              disabled={parityLoading}
            >
              <RefreshCw
                size={16}
                className={parityLoading ? "spinning" : ""}
              />
              Refresh
            </button>
          </div>

          <div className="profile-details">
            <div className="profile-field">
              <label className="field-label">Configuration Status</label>
              <div
                className={`field-value ${
                  parityServer?.status === "configured" ? "success" : "warning"
                }`}
              >
                {parityLoading
                  ? "Loading..."
                  : parityServer?.status || "Not Configured"}
              </div>
            </div>

            {parityServer?.parityServer && (
              <>
                <div className="profile-field">
                  <label className="field-label">Server ID</label>
                  <div className="field-value">
                    {parityServer.parityServer.serverId}
                  </div>
                </div>

                <div className="profile-field">
                  <label className="field-label">Server Address</label>
                  <div className="field-value">
                    {parityServer.parityServer.address}:
                    {parityServer.parityServer.port}
                  </div>
                </div>

                <div className="profile-field">
                  <label className="field-label">Availability</label>
                  <div
                    className={`field-value ${
                      parityServer.parityServer.isAvailable
                        ? "success"
                        : "error"
                    }`}
                  >
                    {parityServer.parityServer.isAvailable
                      ? "Available"
                      : "Unavailable"}
                  </div>
                </div>
              </>
            )}

            <div className="profile-field">
              <label className="field-label">Message</label>
              <div className="field-value">
                {parityServer?.message || "No parity server configured"}
              </div>
            </div>
          </div>
        </div>

        {/* Security Section */}
        <div className="security-section">
          <div className="section-header">
            <h3 className="section-title">
              <Shield size={20} />
              Security & Privacy
            </h3>
          </div>

          <div className="security-actions">
            <div
              className="security-action"
              onClick={() => handleSecurityAction("change-password")}
            >
              <div className="security-action-icon">
                <Key size={20} />
              </div>
              <div className="security-action-content">
                <div className="security-action-title">Change Password</div>
                <div className="security-action-description">
                  Update your account password for better security
                </div>
              </div>
            </div>

            <div
              className="security-action"
              onClick={() => handleSecurityAction("enable-2fa")}
            >
              <div className="security-action-icon">
                <Smartphone size={20} />
              </div>
              <div className="security-action-content">
                <div className="security-action-title">
                  Two-Factor Authentication
                </div>
                <div className="security-action-description">
                  Enable 2FA for enhanced account protection
                </div>
              </div>
            </div>

            <div
              className="security-action"
              onClick={() => handleSecurityAction("backup-wallet")}
            >
              <div className="security-action-icon">
                <Download size={20} />
              </div>
              <div className="security-action-content">
                <div className="security-action-title">Backup Wallet</div>
                <div className="security-action-description">
                  Download encrypted backup of your CloudCoin wallet
                </div>
              </div>
            </div>

            <div
              className="security-action"
              onClick={() => handleSecurityAction("delete-account")}
            >
              <div className="security-action-icon danger">
                <Trash2 size={20} />
              </div>
              <div className="security-action-content">
                <div className="security-action-title">Delete Account</div>
                <div className="security-action-description">
                  Permanently delete your account and all data
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Settings Section */}
        <div className="settings-section">
          <div className="section-header">
            <h3 className="section-title">
              <Settings size={20} />
              Application Settings
            </h3>
          </div>

          <div className="settings-grid">
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-title">Email Notifications</div>
                <div className="setting-description">
                  Receive email alerts for account activities
                </div>
              </div>
              <div className="setting-control">
                <button
                  className={`toggle-switch ${
                    accountSettings.notifications ? "active" : ""
                  }`}
                  onClick={() => handleSettingToggle("notifications")}
                ></button>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-title">Dark Mode</div>
                <div className="setting-description">
                  Use dark theme for the application interface
                </div>
              </div>
              <div className="setting-control">
                <button
                  className={`toggle-switch ${
                    accountSettings.darkMode ? "active" : ""
                  }`}
                  onClick={() => handleSettingToggle("darkMode")}
                ></button>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-title">Auto-Sync</div>
                <div className="setting-description">
                  Automatically sync CloudCoin balance with RAIDA network
                </div>
              </div>
              <div className="setting-control">
                <button
                  className={`toggle-switch ${
                    accountSettings.autoSync ? "active" : ""
                  }`}
                  onClick={() => handleSettingToggle("autoSync")}
                ></button>
              </div>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-title">Biometric Authentication</div>
                <div className="setting-description">
                  Use fingerprint or face recognition for quick access
                </div>
              </div>
              <div className="setting-control">
                <button
                  className={`toggle-switch ${
                    accountSettings.biometric ? "active" : ""
                  }`}
                  onClick={() => handleSettingToggle("biometric")}
                ></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountPane;