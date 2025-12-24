import React, { useState } from 'react';
import { runEchoTest, createWalletBackup } from '../../../api/apiService.js';

const SettingsTab = () => {
  // Echo Test State
  const [echoResult, setEchoResult] = useState(null);
  const [echoError, setEchoError] = useState(null);
  const [isEchoRunning, setIsEchoRunning] = useState(false);
  
  // Backup State
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState(null);
  const [backupError, setBackupError] = useState(null);
  const [backupDestination, setBackupDestination] = useState('');
  
  // Other Settings State
  const [autoBackup, setAutoBackup] = useState(false);
  const [notificationPref, setNotificationPref] = useState('all');

  const handleEchoTest = async () => {
    setIsEchoRunning(true);
    setEchoResult(null);
    setEchoError(null);
    // Clear backup state
    setBackupResult(null);
    setBackupError(null);

    const result = await runEchoTest();

    if (result.success) {
      setEchoResult(result.data);
    } else {
      setEchoError(result.error);
    }

    setIsEchoRunning(false);
  };

  const handleChangePassword = () => {
    // TODO: Implement change password logic
    console.log('Change password clicked');
  };

  const handleCreateBackup = async () => {
    if (!backupDestination.trim()) {
      setBackupError('Please provide an absolute destination path.');
      return;
    }
    
    setIsBackingUp(true);
    setBackupResult(null);
    setBackupError(null);
    // Clear echo state
    setEchoResult(null);
    setEchoError(null);

    const result = await createWalletBackup(backupDestination);

    if (result.success) {
      setBackupResult(result.data); // data is the success response object
      setBackupDestination(''); // Clear input on success
    } else {
      setBackupError(result.error);
    }

    setIsBackingUp(false);
  };

  // Calculate pass/fail count for the summary
  const passCount = echoResult?.servers?.filter(s => s.status === 'Ready').length || 0;
  const serverCount = echoResult?.servers?.length || 0;

  return (
    <div className="tab-content">
      <h3>Settings</h3>
      <div className="settings-options">
        {/* Auto-backup Setting */}
        <div className="setting-item">
          <label htmlFor="auto-backup">Auto-backup enabled</label>
          <input 
            id="auto-backup" 
            type="checkbox" 
            checked={autoBackup}
            onChange={(e) => setAutoBackup(e.target.checked)}
          />
        </div>

        {/* Notification Preferences */}
        <div className="setting-item">
          <label htmlFor="notifications">Notification preferences</label>
          <select 
            id="notifications"
            value={notificationPref}
            onChange={(e) => setNotificationPref(e.target.value)}
          >
            <option value="all">All notifications</option>
            <option value="important">Important only</option>
            <option value="none">None</option>
          </select>
        </div>

        {/* Change Password */}
        <div className="setting-item">
          <span>Manage your password</span>
          <button className="change-password-btn" onClick={handleChangePassword}>
            Change Password
          </button>
        </div>

        {/* Create Backup */}
        <div className="setting-item cli-test-section"> {/* Re-using CLI test styles */}
          <div className="cli-test-content">
            <h4>Wallet Backup</h4>
            <p className="backup-description">
              Create a complete .zip backup of your active wallet.
              <strong>Must be an absolute path</strong> (e.g., C:\Backups or /home/user/backups).
              The directory will be created if it doesn't exist.
            </p>
            
            <div className="backup-form">
              <input
                type="text"
                placeholder="Enter absolute destination path..."
                value={backupDestination}
                onChange={(e) => setBackupDestination(e.target.value)}
                className="backup-path-input"
                disabled={isBackingUp}
              />
              <button 
                className="backup-btn"
                onClick={handleCreateBackup}
                disabled={isBackingUp || !backupDestination.trim()}
              >
                {isBackingUp ? 'Backing up...' : 'Create Backup'}
              </button>
            </div>

            {/* Status Messages */}
            {isBackingUp && (
              <div className="echo-status-output">
                <h5>Creating backup...</h5>
              </div>
            )}

            {backupError && (
              <div className="echo-status-output error">
                <h5>Backup Failed:</h5>
                <pre>{backupError}</pre>
              </div>
            )}

            {backupResult && (
              <div className="echo-status-output success">
                <h5>Backup Successful!</h5>
                <p><strong>Wallet:</strong> {backupResult.wallet}</p>
                <p><strong>Filename:</strong> {backupResult.filename}</p>
                <p><strong>Full Path:</strong> {backupResult.full_path}</p>
                <p><em>{backupResult.message}</em></p>
              </div>
            )}
          </div>
        </div>
        
        {/* RAIDA Network Test */}
        <div className="setting-item cli-test-section">
          <div className="cli-test-content">
            <h4>RAIDA Network Test (Echo)</h4>
            <button 
              className="test-cli-btn"
              onClick={handleEchoTest}
              disabled={isEchoRunning}
            >
              {isEchoRunning ? 'Pinging...' : 'Run Echo Test'}
            </button>

            {isEchoRunning && (
              <div className="echo-status-output">
                <h5>Pinging RAIDA Network...</h5>
              </div>
            )}

            {echoError && (
              <div className="echo-status-output error">
                <h5>Error:</h5>
                <pre>{echoError}</pre>
              </div>
            )}

            {echoResult && echoResult.servers && (
              <div className="echo-status-output">
                <h5>
                  Echo Results: 
                  <span style={{ 
                    color: passCount === serverCount ? 'var(--accent-success)' : 'var(--accent-error)', 
                    paddingLeft: '8px' 
                  }}>
                    {passCount} / {serverCount} Passed
                  </span>
                </h5>
                <div className="raida-grid">
                  {echoResult.servers.map((server) => (
                    <div 
                      key={server.index} 
                      className={`raida-server-card ${server.status === 'Ready' ? 'success' : 'fail'}`}
                      title={`Status: ${server.status}\nLatency: ${server.network_latency_ms}ms\nExecution: ${server.execution_time_ns}ns`}
                    >
                      <span className="raida-index">RAIDA {server.index}</span>
                      <span className="raida-latency">
                        {server.network_latency_ms} ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;