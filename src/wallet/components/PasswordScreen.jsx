import { useState, useEffect } from 'react';
import { Eye, EyeOff, Dices } from 'lucide-react';
import DicewarePasswordCreator from './DicewarePasswordCreator';
import './PasswordScreen.css';

/* eslint-disable react/prop-types -- this screen receives a simple callback prop and the project does not use prop-types. */

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
    setHasExistingPassword(Boolean(existingPassword));
    if (!existingPassword) {
      setIsCreatingPassword(true);
    }
  }, []);

  const hashPassword = async (nextPassword) => {
    const encoder = new TextEncoder();
    // BUG-17 FIX: Removed .toLowerCase() — unknown why it was there, and it
    // makes passwords case-insensitive which reduces security significantly
    const data = encoder.encode(nextPassword.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
    } catch {
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
    } catch {
      setError('Error verifying password. Please try again.');
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
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
      } catch {
        setError('Error creating password. Please try again.');
      }
    }, 100);
  };

  const isCreating = isCreatingPassword;
  const title = isCreating ? 'Create Your Password' : 'Enter Your Password';
  const subtitle = isCreating
    ? 'Set up a secure password to protect your CloudCoins'
    : 'Enter your password to access your CloudCoins';

  if (useDiceware && isCreating) {
    return (
      <main className="password-screen">
        <section
          className="password-screen__card password-screen__card--wide"
          aria-labelledby="password-screen-diceware-title"
        >
          <header className="password-screen__header password-screen__header--compact">
            <button
              type="button"
              onClick={() => setUseDiceware(false)}
              className="password-screen__reset-button password-screen__back-button"
            >
              ← Back to Simple Password
            </button>
            <h1
              id="password-screen-diceware-title"
              className="password-screen__title"
            >
              Create Your Password
            </h1>
            <p className="password-screen__subtitle">
              Generate a secure Diceware passphrase for your CloudCoins.
            </p>
          </header>
          <section
            className="password-screen__diceware-panel"
            aria-label="Diceware password generator"
          >
            <DicewarePasswordCreator onPasswordCreated={handleDicewarePassword} />
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="password-screen">
      <section className="password-screen__card" aria-labelledby="password-screen-title">
        <header className="password-screen__header">
          <h1 id="password-screen-title" className="password-screen__title">
            {title}
          </h1>
          <p className="password-screen__subtitle">{subtitle}</p>
        </header>

        {isCreating && (
          <section
            className="password-screen__diceware-prompt"
            aria-label="Password creation options"
          >
            <button
              type="button"
              onClick={() => setUseDiceware(true)}
              className="password-screen__diceware-button"
            >
              <Dices size={20} className="password-screen__diceware-icon" />
              Create Secure Diceware Passphrase (Recommended)
            </button>
            <p className="password-screen__diceware-divider">— OR —</p>
          </section>
        )}

        <form onSubmit={handleSubmit} className="password-screen__form">
          <div className="password-screen__field">
            <label className="password-screen__label" htmlFor="password">
              Password:
            </label>
            <div className="password-screen__input-wrap">
              <input
                className="password-screen__input password-screen__input--with-toggle"
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  isCreating
                    ? 'Create password (min 8 characters)'
                    : 'Enter your password'
                }
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="password-screen__toggle-button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {isCreating && (
            <div className="password-screen__field">
              <label className="password-screen__label" htmlFor="confirmPassword">
                Confirm Password:
              </label>
              <input
                className="password-screen__input"
                type={showPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm your password"
                required
              />
            </div>
          )}

          {error && (
            <div className="password-screen__error" role="alert">
              {error}
            </div>
          )}

          <footer className="password-screen__actions">
            <button type="submit" className="password-screen__submit-button">
              {isCreating ? 'Create Password' : 'Login'}
            </button>
          </footer>
        </form>

        {hasExistingPassword && !isCreating && (
          <footer className="password-screen__reset-options">
            <button
              type="button"
              onClick={() => {
                setIsCreatingPassword(true);
                setPassword('');
                setConfirmPassword('');
                setError('');
              }}
              className="password-screen__reset-button"
            >
              Forgot/Reset Password
            </button>
          </footer>
        )}

        {isCreating && (
          <section
            className="password-screen__requirements"
            aria-label="Password requirements"
          >
            <h2 className="password-screen__requirements-title">
              Password Requirements:
            </h2>
            <ul>
              <li className="password-screen__requirement">
                At least 8 characters long
              </li>
              <li className="password-screen__requirement">
                Mix of letters, numbers, and special characters recommended
              </li>
              <li className="password-screen__requirement password-screen__requirement--warning">
                Store your password securely - it cannot be recovered
              </li>
            </ul>
          </section>
        )}
      </section>
    </main>
  );
};

export default PasswordScreen;
