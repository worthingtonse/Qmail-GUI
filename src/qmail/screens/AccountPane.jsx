/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import {
  User,
  Shield,
  Settings,
  RefreshCw,
  Key,
  Smartphone,
  Download,
  LogOut,
  AlertTriangle,
  Server,
  Bell,
  BellOff,
  Music2,
  Volume2,
  Play,
  // Heart, <--- REMOVED with FIX-05 (Server Status section gone)
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  // getHealthStatus, <--- REMOVED IMPORT
  // healWallet, <--- REMOVED with FIX-10 interim (gpt-batch1)
  getServers,
} from "../../api/qmailApiServices";
import soundService from "../../api/soundService";
import { isLocalStorageAvailable } from "../skipAutoRestore";
import { useNotification } from "../../components/common/notifications/NotificationContext";
import { ThemePicker } from "../../theme/ThemePicker";
import {
  buildQmailStatusTitle,
  formatServerLatency,
  getQmailServerAddress,
  getQmailServerId,
  serverStatusText,
} from "./serverStatusUi";
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

const DEFAULT_SOUND_FILE = "ding-80828.mp3";
const FALLBACK_SOUND_FILES = [
  DEFAULT_SOUND_FILE,
  "floraphonic-arcade-ui-1-229498.mp3",
  "driken5482-retro-coin-3-236679.mp3",
  "u_jlnmxtfupk-notice-313085.mp3",
];

const buildSoundLabel = (filename) => {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return filename || "Sound";
  return cleaned.replace(/\b\w/g, (match) => match.toUpperCase());
};

const SoundSettings = () => {
  const initialSettings = soundService.getSettings();
  const [enabled, setEnabled] = useState(initialSettings.isEnabled);
  const [volume, setVolume] = useState(Math.round(initialSettings.volume * 100));
  const [availableSounds, setAvailableSounds] = useState([]);
  const [selectedSoundFile, setSelectedSoundFile] = useState(
    soundService.getMailSoundFile(),
  );
  const [soundLoading, setSoundLoading] = useState(true);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    soundService.setEnabled(next);
  };

  useEffect(() => {
    let cancelled = false;

    const loadSounds = async () => {
      try {
        const remoteSounds = window.electronAPI?.listSoundFiles
          ? await window.electronAPI.listSoundFiles()
          : [];
        if (cancelled) return;

        const sounds = Array.isArray(remoteSounds) && remoteSounds.length > 0
          ? remoteSounds
          : FALLBACK_SOUND_FILES.map((filename) => ({
              filename,
              label: buildSoundLabel(filename),
              src: `/sounds/${encodeURIComponent(filename)}`,
            }));

        setAvailableSounds(sounds);

        const current = soundService.getMailSoundFile();
        const next = sounds.some((sound) => sound.filename === current)
          ? current
          : sounds[0]?.filename || DEFAULT_SOUND_FILE;

        if (next && next !== current) {
          soundService.setMailSoundFile(next);
        }
        setSelectedSoundFile(next);
      } catch (error) {
        if (!cancelled) {
          const fallbackSounds = FALLBACK_SOUND_FILES.map((filename) => ({
            filename,
            label: buildSoundLabel(filename),
            src: `/sounds/${encodeURIComponent(filename)}`,
          }));
          setAvailableSounds(fallbackSounds);
          const next = fallbackSounds[0]?.filename || DEFAULT_SOUND_FILE;
          soundService.setMailSoundFile(next);
          setSelectedSoundFile(next);
        }
      } finally {
        if (!cancelled) {
          setSoundLoading(false);
        }
      }
    };

    loadSounds();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVolumeChange = (event) => {
    const next = Number(event.target.value);
    setVolume(next);
    soundService.setVolume(next / 100);
  };

  const handleSoundChange = (event) => {
    const next = event.target.value;
    setSelectedSoundFile(next);
    soundService.setMailSoundFile(next);
  };

  const handlePreview = () => {
    soundService.playMailReceived({ force: true });
  };

  return (
    <div className="account-pane__setting-item">
      <div className="account-pane__setting-info">
        <div className="account-pane__setting-title">Mail Sound Alerts</div>
        <div className="account-pane__setting-description">
          Play a chime when QMail detects a newly received message.
        </div>
      </div>

      <div className="account-pane__setting-control account-pane__sound-control">
        <div className="account-pane__sound-actions">
          <button
            type="button"
            className={
              "account-pane__toggle account-pane__sound-toggle" +
              (enabled ? " account-pane__toggle--active" : "")
            }
            onClick={handleToggle}
            aria-pressed={enabled}
            aria-label={enabled ? "Disable mail sound alerts" : "Enable mail sound alerts"}
            title={enabled ? "Mail sound alerts enabled" : "Mail sound alerts disabled"}
          >
            {enabled ? <Bell size={14} /> : <BellOff size={14} />}
          </button>
          <span className="account-pane__sound-state">
            {enabled ? "On" : "Off"}
          </span>
          <button
            type="button"
            className="btn btn--secondary account-pane__sound-preview"
            onClick={handlePreview}
            title="Play a preview sound"
          >
            <Play size={14} />
            Preview
          </button>
        </div>

        <label className="account-pane__sound-picker" htmlFor="mail-sound-file">
          <span className="account-pane__sound-picker-label">
            <Music2 size={16} />
            Sound
          </span>
          <select
            id="mail-sound-file"
            className="account-pane__sound-select"
            value={selectedSoundFile}
            onChange={handleSoundChange}
            disabled={soundLoading || availableSounds.length === 0}
          >
            {availableSounds.map((sound) => (
              <option key={sound.filename} value={sound.filename}>
                {sound.label || buildSoundLabel(sound.filename)}
              </option>
            ))}
          </select>
        </label>

        <label className="account-pane__sound-volume" htmlFor="mail-sound-volume">
          <span className="account-pane__sound-volume-label">
            <Volume2 size={16} />
            Volume
          </span>
          <input
            id="mail-sound-volume"
            className="account-pane__sound-range"
            type="range"
            min="0"
            max="100"
            step="1"
            value={volume}
            onChange={handleVolumeChange}
            aria-label="Mail sound volume"
          />
          <span className="account-pane__sound-volume-value">{volume}%</span>
        </label>
      </div>
    </div>
  );
};

const buildQmailServerStats = (servers) => {
  const onlineCount = servers.filter((s) => s.is_available === true).length;
  const offlineCount = servers.filter((s) => s.is_available === false).length;
  const hasHistorical = servers.some(
    (s) => typeof s.percent_uptime === "number",
  );

  return {
    total: servers.length,
    online: onlineCount,
    offline: offlineCount,
    uptime:
      servers.length === 0
        ? 0
        : hasHistorical
          ? Math.round(
              servers.reduce((sum, s) => sum + (s.percent_uptime || 0), 0) /
                servers.length,
            )
          : Math.round((onlineCount / servers.length) * 100),
  };
};

const AccountPane = ({ userAccount, onSignOut }) => {
  // State management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const { showSuccess, showError, showInfo } = useNotification();

  // API Data States
  // FIX-05: serverHealth state removed. The static "healthy" default
  // misrepresented service state on every Account view. NavigationPane's
  // dot grid (driven by /raida/echo) is the authoritative health view.

  const [qmailServers, setQmailServers] = useState([]);

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
        setQmailServers(servers);

        const stats = buildQmailServerStats(servers);
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
        setQmailServers(servers);

        const stats = buildQmailServerStats(servers);
        setServerStats(stats);

        showNotification(
          `Loaded ${stats.online}/${stats.total} available QMail servers`,
          "info",
        );
      } else {
        showNotification(`Failed to load QMail servers: ${result.error}`, "error");
      }
    } catch (error) {
      showNotification(`Failed to load QMail servers: ${error.message}`, "error");
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

  // Loading gate: show spinner only when initial QMail server list hasn't
  // arrived yet. (FIX-05: serverHealth check removed.)
  if (loading && qmailServers.length === 0) {
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
  if (error && qmailServers.length === 0) {
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

        {/* QMail Server Status Section */}
        <div className="account-pane__network">
          <div className="account-pane__section-header">
            <h3 className="account-pane__section-title">
              <Server size={20} />
              QMail Server Status
            </h3>
            <div className="account-pane__section-actions">
              {/* Sync Directory button removed: /api/admin/sync was removed
                  from the backend in QMail v2. No replacement exists yet. */}
              <button
                className="btn btn--secondary account-pane__refresh-button"
                onClick={loadServers}
                disabled={serversLoading}
                title="Refresh QMail server status"
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
              <div className="account-pane__balance-label">QMail Servers</div>
              <div className="account-pane__balance-value">{serverStats.total}</div>
              <div className="account-pane__balance-description">Configured relay servers</div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--network-online">
              <div className="account-pane__balance-label">Online</div>
              <div className="account-pane__balance-value">{serverStats.online}</div>
              <div className="account-pane__balance-description">Available QMail servers</div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--network-offline">
              <div className="account-pane__balance-label">Offline</div>
              <div className="account-pane__balance-value">{serverStats.offline}</div>
              <div className="account-pane__balance-description">Unavailable QMail servers</div>
            </div>

            <div className="account-pane__balance-card account-pane__balance-card--network-unknown">
              <div className="account-pane__balance-label">Availability</div>
              <div className="account-pane__balance-value">{serverStats.uptime}%</div>
              <div className="account-pane__balance-description">Current response ratio</div>
            </div>
          </div>

          {/* Server List */}
          {qmailServers.length > 0 && (
            <div className="account-pane__server-list">
              <h4 className="account-pane__server-list-title">
                QMail Server Details ({qmailServers.length})
              </h4>
              <div className="account-pane__server-grid">
                {qmailServers.map((server, index) => {
                  const serverId = getQmailServerId(server, index);
                  const availability = server.is_available ?? null;
                  const isOnline = availability === true;
                  const status = serverStatusText(availability);
                  const latency = formatServerLatency(server.latency_ms);
                  const address = getQmailServerAddress(server);
                  const offlineIconClass = availability === false
                    ? "account-pane__server-icon--offline"
                    : "account-pane__server-icon--unknown";

                  return (
                    <div
                      key={serverId}
                      className="account-pane__server-item"
                      title={buildQmailStatusTitle(server, index)}
                    >
                      <div className="account-pane__server-status">
                        {isOnline ? (
                          <Wifi size={16} className="account-pane__server-icon--online" />
                        ) : (
                          <WifiOff size={16} className={offlineIconClass} />
                        )}
                      </div>
                      <div className="account-pane__server-info">
                        <div className="account-pane__server-id">QMail {serverId}</div>
                        <div className="account-pane__server-address">{address}</div>
                        <div className="account-pane__server-meta">
                          <span>{status}</span>
                          <span>{latency}</span>
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
            <SoundSettings />
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
