import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Dices } from 'lucide-react';
import DicewarePasswordCreator from './DicewarePasswordCreator';
import './PasswordScreen.css';

const PasswordScreen = ({ onSuccess }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isCreatingPassword, setIsCreatingPassword] = useState(false);
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [useDiceware, setUseDiceware] = useState(false);

  useEffect(() => {
    const existingPassword = localStorage.getItem('cloudcoin_password_hash');
    setHasExistingPassword(!!existingPassword);
    if (!existingPassword) {
      setIsCreatingPassword(true);
    }
  }, []);

  const hashPassword = async (password) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleCreatePassword = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      const hashedPassword = await hashPassword(password);
      localStorage.setItem('cloudcoin_password_hash', hashedPassword);
      setError('');
      onSuccess();
    } catch (err) {
      setError('Error creating password. Please try again.');
    }
  };

  const handleVerifyPassword = async () => {
    try {
      const hashedPassword = await hashPassword(password);
      const storedHash = localStorage.getItem('cloudcoin_password_hash');

      if (hashedPassword === storedHash) {
        setError('');
        onSuccess();
      } else {
        setError('Incorrect password');
        setPassword('');
      }
    } catch (err) {
      setError('Error verifying password. Please try again.');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isCreatingPassword) {
      handleCreatePassword();
    } else {
      handleVerifyPassword();
    }
  };

  const handleDicewarePassword = (passphrase) => {
    setPassword(passphrase);
    setConfirmPassword(passphrase);
    setUseDiceware(false);
    setTimeout(async () => {
      try {
        const hashedPassword = await hashPassword(passphrase);
        localStorage.setItem('cloudcoin_password_hash', hashedPassword);
        setError('');
        onSuccess();
      } catch (err) {
        setError('Error creating password. Please try again.');
      }
    }, 100);
  };

  if (useDiceware && isCreatingPassword) {
    return (
      <div className="password-screen">
        <div className="password-container" style={{maxWidth: '900px'}}>
          <button
            onClick={() => setUseDiceware(false)}
            className="reset-button"
            style={{ marginBottom: '20px', textDecoration: 'none' }}
          >
            ← Back to Simple Password
          </button>
          <DicewarePasswordCreator onPasswordCreated={handleDicewarePassword} />
        </div>
      </div>
    );
  }

  return (
    <div className="password-screen">
      <div className="password-container">
        <div className="header">
          <h2>
            {isCreatingPassword ? 'Create Your Password' : 'Enter Your Password'}
          </h2>
          <p>
            {isCreatingPassword
              ? 'Set up a secure password to protect your CloudCoins'
              : 'Enter your password to access your CloudCoins'
            }
          </p>
        </div>

        {isCreatingPassword && (
          <div className="diceware-prompt">
            <button
              onClick={() => setUseDiceware(true)}
              className="diceware-button"
            >
              <Dices size={20} style={{ marginRight: '8px', display: 'inline-block' }} />
              Create Secure Diceware Passphrase (Recommended)
            </button>
            <span className="diceware-divider">
              — OR —
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="password-form">
          <div className="input-group">
            <label htmlFor="password">
              Password:
            </label>
            <div className="password-input-container">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isCreatingPassword ? 'Create password (min 8 characters)' : 'Enter your password'}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="toggle-password"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {isCreatingPassword && (
            <div className="input-group">
              <label htmlFor="confirmPassword">
                Confirm Password:
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
              />
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          <div className="actions">
            <button type="submit" className="submit-button">
              {isCreatingPassword ? 'Create Password' : 'Login'}
            </button>
          </div>
        </form>

        {hasExistingPassword && !isCreatingPassword && (
          <div className="reset-options">
            <button 
              onClick={() => {
                setIsCreatingPassword(true);
                setPassword('');
                setConfirmPassword('');
                setError('');
              }}
              className="reset-button"
            >
              Forgot/Reset Password
            </button>
          </div>
        )}

        {isCreatingPassword && (
          <div className="password-requirements">
            <h4>Password Requirements:</h4>
            <ul>
              <li>At least 8 characters long</li>
              <li>Mix of letters, numbers, and special characters recommended</li>
              <li className="warning">
                Store your password securely - it cannot be recovered
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default PasswordScreen;