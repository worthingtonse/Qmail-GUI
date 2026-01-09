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
  getHealthStatus,
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
  const [serverHealth, setServerHealth] = useState(null);
  const [raidaServers, setRaidaServers] = useState([]);
  const [parityServer, setParityServer] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [serversLoading, setServersLoading] = useState(false);
  const [parityLoading, setParityLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notification, setNotification] = useState(null);
  const [notificationType, setNotificationType] = useState("success");

   const [serverStats, setServerStats] = useState({
    total: 0,
    online: 0,
    offline: 0,
    uptime: 0
  });

  const [accountSettings, setAccountSettings] = useState({
    notifications: true,
    darkMode: true,
    autoSync: false,
    biometric: true,
  });

  // Dummy user data for testing UI
  const [userProfile, setUserProfile] = useState({
    fullName: "John Doe",
    email: "john.doe@example.com",
    autoAddress: "john.doe.qmail.cloud",
    userId: "USR_789123456",
    joinDate: "2024-01-15",
    lastLogin: "2024-12-26 10:30 AM",
    status: "online",
  });

  // Dummy CloudCoin balance data
  const [balanceData, setBalanceData] = useState({
    total: 2847,
    verified: 2650,
    counterfeit: 12,
    suspect: 185,
    lastUpdated: "2024-12-26 10:25 AM",
  });

  // Dummy activity data
  const [activityData, setActivityData] = useState([
    {
      id: 1,
      type: "login",
      title: "Successful Login",
      description: "Logged in from desktop application",
      timestamp: "2 hours ago",
      icon: "login",
    },
    {
      id: 2,
      type: "transaction",
      title: "CloudCoin Transfer",
      description: "Sent 50 CloudCoins to alice.smith.qmail.cloud",
      timestamp: "6 hours ago",
      icon: "transaction",
    },
    {
      id: 3,
      type: "security",
      title: "Security Check",
      description: "Account health verification completed",
      timestamp: "1 day ago",
      icon: "security",
    },
    {
      id: 4,
      type: "login",
      title: "Mobile Login",
      description: "Logged in from mobile device",
      timestamp: "2 days ago",
      icon: "login",
    },
    {
      id: 5,
      type: "transaction",
      title: "CloudCoin Received",
      description: "Received 125 CloudCoins from bob.wilson.qmail.cloud",
      timestamp: "3 days ago",
      icon: "transaction",
    },
  ]);

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
    // Load all data in parallel - don't show notifications for initial load
    const [healthResult, serversResult, parityResult] = await Promise.all([
      getHealthStatus(),
      getServers(true),
      getParityServer()
    ]);
    
    // Process health
    if (healthResult.success) {
      setServerHealth(healthResult.data);
    }
    
    // Process servers
    if (serversResult.success) {
      const servers = serversResult.data.servers || [];
      setRaidaServers(servers);
      
      const stats = {
        total: servers.length,
        online: servers.filter(s => s.is_available).length,
        offline: servers.filter(s => !s.is_available).length,
        uptime: servers.length > 0 
          ? Math.round(servers.reduce((sum, s) => sum + (s.percent_uptime || 0), 0) / servers.length)
          : 0
      };
      setServerStats(stats);
    }
    
    // Process parity
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

 const loadHealthStatus = async () => {
  setHealthLoading(true);
  try {
    const result = await getHealthStatus();
    if (result.success) {
      setServerHealth(result.data);
      console.log("Server health loaded:", result.data);
      showNotification(`Health check passed - ${result.data.service} v${result.data.version}`, 'success');
    } else {
      console.error("Failed to load server health:", result.error);
      showNotification(`Failed to load health status: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error("Health check error:", error);
    showNotification(`Health check failed: ${error.message}`, 'error');
  } finally {
    setHealthLoading(false);
  }
};

const loadServers = async () => {
  setServersLoading(true);
  
  try {
    const result = await getServers(true);
    if (result.success) {
      const servers = result.data.servers || [];
      setRaidaServers(servers);
      
      const stats = {
        total: servers.length,
        online: servers.filter(s => s.is_available).length,
        offline: servers.filter(s => !s.is_available).length,
        uptime: servers.length > 0 
          ? Math.round(servers.reduce((sum, s) => sum + (s.percent_uptime || 0), 0) / servers.length)
          : 0
      };
      setServerStats(stats);
      
      // Show notification with the stats we just calculated
      showNotification(`Loaded ${stats.online}/${stats.total} available servers`, 'info');
    } else {
      console.error("Failed to load servers:", result.error);
      showNotification(`Failed to load servers: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error("Servers loading error:", error);
    showNotification(`Failed to load servers: ${error.message}`, 'error');
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
        console.log("Parity server loaded:", result.data);

        if (result.data.status === "not_configured") {
          showNotification("Parity server is not configured", "info");
        } else if (result.data.parityServer) {
          showNotification(
            `Parity server: ${result.data.parityServer.address}`,
            "success"
          );
        }
      } else {
        console.error("Failed to load parity server:", result.error);
        showNotification(
          `Failed to load parity server: ${result.error}`,
          "error"
        );
      }
    } catch (error) {
      console.error("Parity server loading error:", error);
      showNotification(
        `Failed to load parity server: ${error.message}`,
        "error"
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
      console.log("Sync completed:", result.data);
      
      // Refresh server list after sync
      await loadServers();
      
      // Use correct field names from API response
      const message = result.data.message || 'Sync completed successfully!';
      const usersCount = result.data.usersUpdated ?? result.data.users_synced ?? 0;
      const serversCount = result.data.serversUpdated ?? result.data.servers_synced ?? 0;
      
      showNotification(
        `${message} - Users: ${usersCount}, Servers: ${serversCount}`,
        'success'
      );
    } else {
      showNotification(`Sync failed: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error("Sync error:", error);
    showNotification(`Sync failed: ${error.message || 'Unknown error'}`, 'error');
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

  const handleProfileUpdate = (field, value) => {
    setUserProfile((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSettingToggle = (setting) => {
    setAccountSettings((prev) => ({
      ...prev,
      [setting]: !prev[setting],
    }));
  };

  const handleSecurityAction = (action) => {
    console.log(`Security action triggered: ${action}`);
    // Here you would implement actual security actions
  };

  
  if (loading && !serverHealth && raidaServers.length === 0) {
    return (
      <div className="account-pane">
        <div className="loading-state">
          <RefreshCw size={48} className="spinning" />
          <p>Loading account information...</p>
        </div>
      </div>
    );
  }

  if (error && !serverHealth && raidaServers.length === 0) {
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
      {/* Notification Banner - Fixed Position */}
      {notification && (
        <div 
          className={`notification-banner notification-${notificationType}`}
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            minWidth: '400px',
            maxWidth: '600px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
          }}
        >
          {notificationType === 'success' && <Check size={16} />}
          {notificationType === 'error' && <AlertTriangle size={16} />}
          {notificationType === 'info' && <AlertCircle size={16} />}
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
            <div className={`account-status ${userProfile.status}`}>
              <div className="status-indicator"></div>
              <span>
                {userProfile.status === "online" ? "Online" : "Offline"}
              </span>
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
            <button
              className="edit-profile-btn secondary"
              onClick={loadHealthStatus}
              disabled={healthLoading}
            >
              <RefreshCw
                size={16}
                className={healthLoading ? "spinning" : ""}
              />
              Refresh
            </button>
          </div>

          <div className="profile-details">
            <div className="profile-field">
              <label className="field-label">Service Status</label>
              <div
                className={`field-value ${
                  serverHealth?.status === "healthy" ? "success" : "error"
                }`}
              >
                {healthLoading
                  ? "Checking..."
                  : serverHealth?.status || "Unknown"}
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

        {/* Profile Section */}
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
              <label className="field-label">Full Name</label>
              <div
                className={`field-value ${isEditing ? "editable" : ""}`}
                contentEditable={isEditing}
                onBlur={(e) =>
                  handleProfileUpdate("fullName", e.target.textContent)
                }
                suppressContentEditableWarning={true}
              >
                {userProfile.fullName}
              </div>
            </div>

            <div className="profile-field">
              <label className="field-label">Email Address</label>
              <div
                className={`field-value ${isEditing ? "editable" : ""}`}
                contentEditable={isEditing}
                onBlur={(e) =>
                  handleProfileUpdate("email", e.target.textContent)
                }
                suppressContentEditableWarning={true}
              >
                {userProfile.email}
              </div>
            </div>

            <div className="profile-field">
              <label className="field-label">QMail Address</label>
              <div
                className={`field-value ${isEditing ? "editable" : ""}`}
                contentEditable={isEditing}
                onBlur={(e) =>
                  handleProfileUpdate("autoAddress", e.target.textContent)
                }
                suppressContentEditableWarning={true}
              >
                {userProfile.autoAddress}
              </div>
            </div>

            <div className="profile-field">
              <label className="field-label">User ID</label>
              <div className="field-value">{userProfile.userId}</div>
            </div>

            <div className="profile-field">
              <label className="field-label">Join Date</label>
              <div className="field-value">
                {new Date(userProfile.joinDate).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>

            <div className="profile-field">
              <label className="field-label">Last Login</label>
              <div className="field-value">{userProfile.lastLogin}</div>
            </div>
          </div>
        </div>

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
              <h4 className="text-sm text-secondary" style={{marginBottom: 'var(--space-md)'}}>
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
                      <div className="server-address">{server.ip_address}:{server.port}</div>
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
                    {parityServer.parityServer.address}:{parityServer.parityServer.port}
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

        {/* CloudCoin Balance Section */}
        <div className="balance-section">
          <div className="section-header">
            <h3 className="section-title">
              <Coins size={20} />
              CloudCoin Balance
            </h3>
          </div>

          <div className="balance-grid">
            <div className="balance-card total">
              <div className="balance-label">Total Balance</div>
              <div className="balance-value">
                {balanceData.total.toLocaleString()}
              </div>
              <div className="balance-description">
                Total CloudCoins in wallet
              </div>
            </div>

            <div className="balance-card verified">
              <div className="balance-label">Verified</div>
              <div className="balance-value">
                {balanceData.verified.toLocaleString()}
              </div>
              <div className="balance-description">
                Authenticated CloudCoins
              </div>
            </div>

            <div className="balance-card counterfeit">
              <div className="balance-label">Counterfeit</div>
              <div className="balance-value">{balanceData.counterfeit}</div>
              <div className="balance-description">
                Invalid CloudCoins detected
              </div>
            </div>

            <div className="balance-card suspect">
              <div className="balance-label">Suspect</div>
              <div className="balance-value">{balanceData.suspect}</div>
              <div className="balance-description">Pending verification</div>
            </div>
          </div>

          <div className="balance-info">
            <p className="text-sm text-tertiary">
              Last updated: {balanceData.lastUpdated}
            </p>
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

        {/* Recent Activity Section */}
        <div className="activity-section">
          <div className="section-header">
            <h3 className="section-title">
              <Activity size={20} />
              Recent Activity
            </h3>
          </div>

          <div className="activity-list">
            {activityData.map((activity) => (
              <div key={activity.id} className="activity-item">
                <div className={`activity-icon ${activity.icon}`}>
                  {activity.icon === "login" && <LogIn size={16} />}
                  {activity.icon === "transaction" && <CreditCard size={16} />}
                  {activity.icon === "security" && <Shield size={16} />}
                </div>
                <div className="activity-content">
                  <div className="activity-title">{activity.title}</div>
                  <div className="activity-description">
                    {activity.description}
                  </div>
                </div>
                <div className="activity-time">{activity.timestamp}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountPane;
