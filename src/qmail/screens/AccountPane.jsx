/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import {
  User,
  Shield,
  Settings,
  RefreshCw,
  Edit,
  Key,
  Smartphone,
  Download,
  LogOut,
  AlertTriangle,
  X,
  Server,
  // Heart, <--- REMOVED with FIX-05 (Server Status section gone)
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  // getHealthStatus, <--- REMOVED IMPORT
  // healWallet, <--- REMOVED with FIX-10 interim (gpt-batch1)
  getServers,
} from "../../api/qmailApiServices";
import { isLocalStorageAvailable } from "../skipAutoRestore";
import { useNotification } from "../../components/common/notifications/NotificationContext";
import { ThemePicker } from "../../theme/ThemePicker";
import "./AccountPane.css";

const ComingSoonAction = ({ icon, title, description }) => (
  <div
    className="account-pane__security-action account-pane__security-action--coming-soon"
    aria-disabled="true"
    tabIndex={-1}
    title="This feature is on the roadmap."
  >
    <div className="account-pane__security-action-icon">{icon}</div>
    <div className="account-pane__security-action-content">
      <div className="account-pane__security-action-title">
        {title}
        <span className="account-pane__coming-soon-badge">Coming Soon</span>
      </div>
      <div className="account-pane__security-action-description">{description}</div>
    </div>
  </div>
);

const ComingSoonToggle = ({ title, description }) => (
  <div className="account-pane__setting-item account-pane__setting-item--coming-soon">
    <div className="account-pane__setting-info">
      <div className="account-pane__setting-title">
        {title}
        <span className="account-pane__coming-soon-badge">Coming Soon</span>
      </div>
      <div className="account-pane__setting-description">{description}</div>
    </div>
    <div className="account-pane__setting-control">
      <button
        className="account-pane__toggle"
        disabled
        aria-disabled="true"
        tabIndex={-1}
        title="This feature is on the roadmap."
      />
    </div>
  </div>
);

const AccountPane = ({ userAccount, walletBalance, onSignOut }) => {
  // State management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const { showSuccess, showError, showInfo } = useNotification();

  // API Data States
  // FIX-05: serverHealth state removed. The static "healthy" default
  // misrepresented service state on every Account view. NavigationPane's
  // dot grid (driven by /raida/echo) is the authoritative health view.

  const [raidaServers, setRaidaServers] = useState([]);
  
  // const [healthLoading, setHealthLoading] = useState(false); <--- REMOVED UNUSED STATE
  
  const [serversLoading, setServersLoading] = useState(false);
  // repairing state removed with handleRepairIdentity (FIX-10 interim).

  const [serverStats, setServerStats] = useState({
    total: 0,
    online: 0,
    offline: 0,
    uptime: 0,
  });

  // FIX-16-0A: accountSettings state removed. The four toggles
  // (Notifications, Dark Mode, Auto-Sync, Biometric) are not wired
  // to anything yet and now render as truly-disabled Coming-Soon
  // controls. See <ComingSoonToggle> below.

  const showNotification = (message, type = "success") => {
    if (type === "error") {
      showError(message);
      return;
    }
    if (type === "info") {
      showInfo(message);
      return;
    }
    showSuccess(message);
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
      const serversResult = await getServers();

      // Removed healthResult handling block

      if (serversResult.success) {
        const servers = serversResult.data.servers || [];
        setRaidaServers(servers);

        const onlineCount = servers.filter((s) => s.is_available).length;
        // The backend exposes live availability via /raida/echo, but does not
        // track historical percent_uptime. Use the current availability ratio
        // as a proxy so the widget reflects real state rather than 0%.
        const hasHistorical = servers.some(
          (s) => typeof s.percent_uptime === "number",
        );
        const stats = {
          total: servers.length,
          online: onlineCount,
          offline: servers.length - onlineCount,
          uptime:
            servers.length === 0
              ? 0
              : hasHistorical
                ? Math.round(
                    servers.reduce(
                      (sum, s) => sum + (s.percent_uptime || 0),
                      0,
                    ) / servers.length,
                  )
                : Math.round((onlineCount / servers.length) * 100),
        };
        setServerStats(stats);
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
      const result = await getServers();
      if (result.success) {
        const servers = result.data.servers || [];
        setRaidaServers(servers);

        const onlineCount = servers.filter((s) => s.is_available).length;
        // The backend exposes live availability via /raida/echo, but does not
        // track historical percent_uptime. Use the current availability ratio
        // as a proxy so the widget reflects real state rather than 0%.
        const hasHistorical = servers.some(
          (s) => typeof s.percent_uptime === "number",
        );
        const stats = {
          total: servers.length,
          online: onlineCount,
          offline: servers.length - onlineCount,
          uptime:
            servers.length === 0
              ? 0
              : hasHistorical
                ? Math.round(
                    servers.reduce(
                      (sum, s) => sum + (s.percent_uptime || 0),
                      0,
                    ) / servers.length,
                  )
                : Math.round((onlineCount / servers.length) * 100),
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

  // FIX-10 interim (gpt-batch1): handleRepairIdentity removed.
  // It was wired to a banner that fired on the wrong signal
  // (walletBalance.folders.fracked.coins) and called the mutating
  // healWallet() endpoint as if it were a health check. Will return
  // once CORE-F (non-mutating identity-health endpoint) lands.

  const handleRefresh = () => {
    loadAccountData();
  };

  const handleEditProfile = () => {
    setIsEditing(!isEditing);
  };

  const storageAvailable = isLocalStorageAvailable();

  const handleConfirmSignOut = () => {
    setShowSignOutConfirm(false);
    if (onSignOut) {
      onSignOut();
    }
  };

  // FIX-16-0A: handleSettingToggle and handleSecurityAction removed.
  // Both were no-op handlers attached to controls that didn't do
  // anything. Disabled controls now have no onClick at all.

  // Loading gate: show spinner only when initial RAIDA list hasn't
  // arrived yet. (FIX-05: serverHealth check removed.)
  if (loading && raidaServers.length === 0) {
    return (
      <div className="account-pane">
        <div className="account-pane__loading-state">
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
        <div className="account-pane__error">
          <AlertTriangle size={48} />
          <p>Error: {error}</p>
          <button className="btn btn--secondary account-pane__retry-button" onClick={handleRefresh}>
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="account-pane">
      {/* Account Header */}
      <div className="account-pane__header">
        <div className="account-pane__header-title">
          <h2 className="account-pane__title">Account Management</h2>
          <div className="account-pane__header-actions">
            <div className="account-pane__status account-pane__status--online">
              <div className="account-pane__status-indicator"></div>
              <span>Online</span>
            </div>
            <button
              className="btn btn--secondary account-pane__refresh-button"
              onClick={handleRefresh}
              disabled={loading}
              title="Refresh account data"
            >
              <RefreshCw size={16} className={loading ? "spinning" : ""} />
            </button>
          </div>
        </div>
      </div>

      <div className="account-pane__content">
        {/* FIX-05: Server Status section removed.
            It was hard-coded to { status: "healthy", service: "QMail
            Client Core", version: "1.0.0" } and never updated from a
            live source. A permanently-green indicator that contradicts
            the NavigationPane dot grid (which IS driven by /raida/echo)
            is worse than no indicator.
            Per the plan's FIX-05 recommendation (option A), the
            authoritative health view is the dot grid in NavigationPane.
            If a future ticket needs an aggregate "service status" in
            this pane, derive it from /api/raida/echo's arrayUsable +
            totalAvailable fields — NOT from /api/system/version-check
            (that endpoint is for update availability, not health). */}

        <div className="account-pane__profile">
          <div className="account-pane__section-header">
            <h3 className="account-pane__section-title">
              <User size={20} />
              Profile Information
            </h3>
            {userAccount && (
              <button
                className={`btn ${
                  isEditing ? "btn--danger" : "btn--secondary"
                } account-pane__edit-button`}
                onClick={handleEditProfile}
              >
                {isEditing ? <X size={16} /> : <Edit size={16} />}
                {isEditing ? "Cancel" : "Edit"}
              </button>
            )}
          </div>

          <div className="account-pane__profile-details">
            {userAccount ? (
              <>
                <div className="account-pane__profile-field">
                  <label className="account-pane__field-label">QMail Address</label>
                  <div className="account-pane__field-value">
                    {userAccount.pretty_address ||
                      `${userAccount.address}@${userAccount.domain}`}
                  </div>
                </div>

                <div className="account-pane__profile-field">
                  <label className="account-pane__field-label">Serial Number</label>
                  <div className="account-pane__field-value">
                    #{userAccount.serial_number || "N/A"}
                  </div>
                </div>

                {userAccount.recovery_email && (
                  <div className="account-pane__profile-field">
                    <label className="account-pane__field-label">Recovery Email</label>
                    <div className="account-pane__field-value">
                      {userAccount.recovery_email}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="account-pane__profile-field">
                <label className="account-pane__field-label">QMail Address</label>
                <div className="account-pane__field-value">Loading...</div>
              </div>
            )}
          </div>
        </div>

        {/* RAIDA Network Status Section */}
        <div className="account-pane__network">
          <div className="account-pane__section-header">
            <h3 className="account-pane__section-title">
              <Server size={20} />
              RAIDA Network Status
            </h3>
            <div className="account-pane__section-actions">
              {/* Sync Directory button removed: /api/admin/sync was removed
                  from the backend in QMail v2. No replacement exists yet. */}
              <button
                className="btn btn--secondary account-pane__refresh-button"
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

          {/* FIX-10 interim (gpt-batch1): the "Identity Coin Needs Healing"
              banner used to fire on walletBalance.folders.fracked.coins,
              which is a wallet-wide signal — NOT an identity-specific
              health signal. The Repair button it offered called the
              mutating healWallet() endpoint. Per the plan, full FIX-10
              is HARD-blocked on CORE-F (a non-mutating identity-health
              endpoint). Until that lands, the banner is removed
              entirely. Identity repair will return as an explicit
              manual action once CORE-F provides a safe health source. */}

          <div className="account-pane__balance-grid">
            <div className="account-pane__balance-card account-pane__balance-card--total">
              <div className="account-pane__balance-label">Total Coins</div>
              <div className="account-pane__balance-value">
                {walletBalance?.totalCoins || 0}
              </div>
              <div className="account-pane__balance-description">All coins in wallet</div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--verified">
              <div className="account-pane__balance-label">Bank (Ready)</div>
              <div className="account-pane__balance-value">
                {walletBalance?.folders.bank.coins || 0}
              </div>
              <div className="account-pane__balance-description">
                {walletBalance?.folders.bank.value.toFixed(1) || 0} CC value
              </div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--counterfeit">
              <div className="account-pane__balance-label">Fracked (Needs Repair)</div>
              <div className="account-pane__balance-value">
                {walletBalance?.folders.fracked.coins || 0}
              </div>
              <div className="account-pane__balance-description">
                {walletBalance?.folders.fracked.value.toFixed(1) || 0} CC value
              </div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--suspect">
              <div className="account-pane__balance-label">Limbo (Processing)</div>
              <div className="account-pane__balance-value">
                {walletBalance?.folders.limbo.coins || 0}
              </div>
              <div className="account-pane__balance-description">
                {walletBalance?.folders.limbo.value.toFixed(1) || 0} CC value
              </div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--network-online">
              <div className="account-pane__balance-label">Online</div>
              <div className="account-pane__balance-value">{serverStats.online}</div>
              <div className="account-pane__balance-description">Available servers</div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--network-offline">
              <div className="account-pane__balance-label">Offline</div>
              <div className="account-pane__balance-value">{serverStats.offline}</div>
              <div className="account-pane__balance-description">Unavailable servers</div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--network-unknown">
              <div className="account-pane__balance-label">Uptime</div>
              <div className="account-pane__balance-value">
                {serverStats.total > 0
                  ? Math.round((serverStats.online / serverStats.total) * 100)
                  : 0}
                %
              </div>
              <div className="account-pane__balance-description">Network availability</div>
            </div>
          </div>

          {/* Server List */}
          {raidaServers.length > 0 && (
            <div className="account-pane__server-list">
              <h4 className="account-pane__server-list-title">
                Server Details ({raidaServers.length})
              </h4>
              <div className="account-pane__server-grid">
                {raidaServers.map((server, index) => {
                  const serverId = server.server_id ?? server.raida_index ?? index;
                  return (
                    <div key={serverId} className="account-pane__server-item">
                      <div className="account-pane__server-status">
                        {server.is_available ? (
                          <Wifi size={16} className="account-pane__server-icon--online" />
                        ) : (
                          <WifiOff size={16} className="account-pane__server-icon--offline" />
                        )}
                      </div>
                      <div className="account-pane__server-info">
                        <div className="account-pane__server-id">{serverId}</div>
                        <div className="account-pane__server-address">
                          {server.ip_address}:{server.port}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Security Section */}
        <div className="account-pane__security">
          <div className="account-pane__section-header">
            <h3 className="account-pane__section-title">
              <Shield size={20} />
              Security & Privacy
            </h3>
          </div>

          {/* FIX-16-0A: Coming-Soon rows are truly disabled — no onClick,
              no pointer cursor, aria-disabled, skipped by Tab nav, reduced
              opacity. Delete Account is hidden entirely (safety-critical
              control that doesn't exist). */}
          <div className="account-pane__security-actions">
            <ComingSoonAction
              icon={<Key size={20} />}
              title="Change Password"
              description="Update your account password for better security"
            />
            <ComingSoonAction
              icon={<Smartphone size={20} />}
              title="Two-Factor Authentication"
              description="Enable 2FA for enhanced account protection"
            />
            <ComingSoonAction
              icon={<Download size={20} />}
              title="Backup Wallet"
              description="Download encrypted backup of your CloudCoin wallet"
            />
            {onSignOut && (
              <button
                type="button"
                className="account-pane__security-action account-pane__security-action--sign-out"
                onClick={() => setShowSignOutConfirm(true)}
              >
                <div className="account-pane__security-action-icon account-pane__security-action-icon--warning">
                  <LogOut size={20} />
                </div>
                <div className="account-pane__security-action-content">
                  <div className="account-pane__security-action-title">Sign Out</div>
                  <div className="account-pane__security-action-description">
                    Return to the start screen on this device
                  </div>
                </div>
              </button>
            )}
            {/* Delete Account intentionally hidden until implemented */}
          </div>
        </div>

        {/* Settings Section */}
        <div className="account-pane__settings">
          <div className="account-pane__section-header">
            <h3 className="account-pane__section-title">
              <Settings size={20} />
              Application Settings
            </h3>
          </div>

          <div className="account-pane__settings-grid">
            <ThemePicker />
            <ComingSoonToggle
              title="Email Notifications"
              description="Receive email alerts for account activities"
            />
            <ComingSoonToggle
              title="Auto-Sync"
              description="Automatically sync CloudCoin balance with RAIDA network"
            />
            <ComingSoonToggle
              title="Biometric Authentication"
              description="Use fingerprint or face recognition for quick access"
            />
          </div>
        </div>
      </div>

      {showSignOutConfirm && (
        <div
          className="account-pane__confirm-overlay"
          role="presentation"
          onClick={() => setShowSignOutConfirm(false)}
        >
          <div
            className="account-pane__confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="account-pane__confirm-header">
              <LogOut size={22} />
              <h3 id="sign-out-title">Sign Out</h3>
            </div>
            <p>
              QMail will return to the start screen and stay signed out after
              restart. Your local identity files will remain on this device.
            </p>
            {!storageAvailable && (
              <div className="account-pane__confirm-warning">
                <AlertTriangle size={16} />
                <span>
                  This browser cannot save the sign-out preference, so sign-out
                  may only last for this session.
                </span>
              </div>
            )}
            <div className="account-pane__confirm-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowSignOutConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleConfirmSignOut}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountPane;
