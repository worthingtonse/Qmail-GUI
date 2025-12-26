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
  X
} from "lucide-react";
import "./AccountPane.css";

const AccountPane = () => {
  // State management
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [accountSettings, setAccountSettings] = useState({
    notifications: true,
    darkMode: true,
    autoSync: false,
    biometric: true
  });

  // Dummy user data for testing UI
  const [userProfile, setUserProfile] = useState({
    fullName: "John Doe",
    email: "john.doe@example.com", 
    autoAddress: "john.doe.qmail.cloud",
    userId: "USR_789123456",
    joinDate: "2024-01-15",
    lastLogin: "2024-12-26 10:30 AM",
    status: "online"
  });

  // Dummy CloudCoin balance data
  const [balanceData, setBalanceData] = useState({
    total: 2847,
    verified: 2650,
    counterfeit: 12,
    suspect: 185,
    lastUpdated: "2024-12-26 10:25 AM"
  });

  // Dummy activity data
  const [activityData, setActivityData] = useState([
    {
      id: 1,
      type: "login",
      title: "Successful Login",
      description: "Logged in from desktop application",
      timestamp: "2 hours ago",
      icon: "login"
    },
    {
      id: 2,
      type: "transaction", 
      title: "CloudCoin Transfer",
      description: "Sent 50 CloudCoins to alice.smith.qmail.cloud",
      timestamp: "6 hours ago",
      icon: "transaction"
    },
    {
      id: 3,
      type: "security",
      title: "Security Check",
      description: "Account health verification completed",
      timestamp: "1 day ago", 
      icon: "security"
    },
    {
      id: 4,
      type: "login",
      title: "Mobile Login",
      description: "Logged in from mobile device",
      timestamp: "2 days ago",
      icon: "login"
    },
    {
      id: 5,
      type: "transaction",
      title: "CloudCoin Received", 
      description: "Received 125 CloudCoins from bob.wilson.qmail.cloud",
      timestamp: "3 days ago",
      icon: "transaction"
    }
  ]);

  // Simulate data loading
  useEffect(() => {
    loadAccountData();
  }, []);

  const loadAccountData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Data is already set in state for testing
      console.log("Account data loaded successfully");
    } catch (err) {
      console.error("Error loading account data:", err);
      setError("Failed to load account data");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    loadAccountData();
  };

  const handleEditProfile = () => {
    setIsEditing(!isEditing);
  };

  const handleProfileUpdate = (field, value) => {
    setUserProfile(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSettingToggle = (setting) => {
    setAccountSettings(prev => ({
      ...prev,
      [setting]: !prev[setting]
    }));
  };

  const handleSecurityAction = (action) => {
    console.log(`Security action triggered: ${action}`);
    // Here you would implement actual security actions
  };

  if (loading) {
    return (
      <div className="account-pane">
        <div className="loading-state">
          <RefreshCw size={48} className="spinning" />
          <p>Loading account information...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="account-pane">
        <div className="error-section">
          <AlertTriangle size={48} />
          <p>Error: {error}</p>
          <button 
            className="retry-button secondary"
            onClick={handleRefresh}
          >
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="account-pane">
      {/* Account Header */}
      <div className="account-header">
        <div className="account-header-title">
          <h2>Account Management</h2>
          <div className="account-header-actions">
            <div className={`account-status ${userProfile.status}`}>
              <div className="status-indicator"></div>
              <span>{userProfile.status === "online" ? "Online" : "Offline"}</span>
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
        {/* Profile Section */}
        <div className="profile-section">
          <div className="section-header">
            <h3 className="section-title">
              <User size={20} />
              Profile Information
            </h3>
            <button
              className={`edit-profile-btn ${isEditing ? 'danger' : 'secondary'}`}
              onClick={handleEditProfile}
            >
              {isEditing ? <X size={16} /> : <Edit size={16} />}
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
          </div>
          
          <div className="profile-details">
            <div className="profile-field">
              <label className="field-label">Full Name</label>
              <div 
                className={`field-value ${isEditing ? 'editable' : ''}`}
                contentEditable={isEditing}
                onBlur={(e) => handleProfileUpdate('fullName', e.target.textContent)}
                suppressContentEditableWarning={true}
              >
                {userProfile.fullName}
              </div>
            </div>
            
            <div className="profile-field">
              <label className="field-label">Email Address</label>
              <div 
                className={`field-value ${isEditing ? 'editable' : ''}`}
                contentEditable={isEditing}
                onBlur={(e) => handleProfileUpdate('email', e.target.textContent)}
                suppressContentEditableWarning={true}
              >
                {userProfile.email}
              </div>
            </div>
            
            <div className="profile-field">
              <label className="field-label">QMail Auto Address</label>
              <div className="field-value">
                {userProfile.autoAddress}
              </div>
            </div>
            
            <div className="profile-field">
              <label className="field-label">User ID</label>
              <div className="field-value">
                {userProfile.userId}
              </div>
            </div>
            
            <div className="profile-field">
              <label className="field-label">Join Date</label>
              <div className="field-value">
                {new Date(userProfile.joinDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long', 
                  day: 'numeric'
                })}
              </div>
            </div>
            
            <div className="profile-field">
              <label className="field-label">Last Login</label>
              <div className="field-value">
                {userProfile.lastLogin}
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
              <div className="balance-value">{balanceData.total.toLocaleString()}</div>
              <div className="balance-description">Total CloudCoins in wallet</div>
            </div>
            
            <div className="balance-card verified">
              <div className="balance-label">Verified</div>
              <div className="balance-value">{balanceData.verified.toLocaleString()}</div>
              <div className="balance-description">Authenticated CloudCoins</div>
            </div>
            
            <div className="balance-card counterfeit">
              <div className="balance-label">Counterfeit</div>
              <div className="balance-value">{balanceData.counterfeit}</div>
              <div className="balance-description">Invalid CloudCoins detected</div>
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
              onClick={() => handleSecurityAction('change-password')}
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
              onClick={() => handleSecurityAction('enable-2fa')}
            >
              <div className="security-action-icon">
                <Smartphone size={20} />
              </div>
              <div className="security-action-content">
                <div className="security-action-title">Two-Factor Authentication</div>
                <div className="security-action-description">
                  Enable 2FA for enhanced account protection
                </div>
              </div>
            </div>
            
            <div 
              className="security-action"
              onClick={() => handleSecurityAction('backup-wallet')}
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
              onClick={() => handleSecurityAction('delete-account')}
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
                  className={`toggle-switch ${accountSettings.notifications ? 'active' : ''}`}
                  onClick={() => handleSettingToggle('notifications')}
                >
                </button>
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
                  className={`toggle-switch ${accountSettings.darkMode ? 'active' : ''}`}
                  onClick={() => handleSettingToggle('darkMode')}
                >
                </button>
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
                  className={`toggle-switch ${accountSettings.autoSync ? 'active' : ''}`}
                  onClick={() => handleSettingToggle('autoSync')}
                >
                </button>
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
                  className={`toggle-switch ${accountSettings.biometric ? 'active' : ''}`}
                  onClick={() => handleSettingToggle('biometric')}
                >
                </button>
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
                  {activity.icon === 'login' && <LogIn size={16} />}
                  {activity.icon === 'transaction' && <CreditCard size={16} />}
                  {activity.icon === 'security' && <Shield size={16} />}
                </div>
                <div className="activity-content">
                  <div className="activity-title">{activity.title}</div>
                  <div className="activity-description">{activity.description}</div>
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