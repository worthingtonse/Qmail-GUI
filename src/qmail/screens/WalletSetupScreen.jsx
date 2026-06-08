// screens/WalletSetupScreen.jsx
import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle,
  ArrowRight,
  RefreshCw,
  User,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { healWallet } from '../../api/qmailApiServices';
import './WalletSetupScreen.css';

/* eslint-disable react/prop-types -- accountData is a free-form
   normalizeIdentityForUi() result with many optional fields; the
   project doesn't use prop-types anywhere. */

// FIX-03: accountData is a normalizeIdentityForUi() result. It carries
// BOTH camelCase and snake_case fields so this screen reads the
// snake_case ones it always read (pretty_address, email_address,
// needs_healing) without change.
//
// gpt-batch2 #3: do NOT claim "healthy and verified" when the
// identity isn't actually verified. hasVerifiedIdentity requires a
// configured=true result with a non-zero serial and a non-empty
// pretty_address.
//
// FIX-36-0B: Heal Identity is only rendered when status === 'fracked'.
// BUG-62: Check Change is temporarily hidden from the first-run welcome
// screen, so this screen now only offers Heal Identity when needed and
// Go to Dashboard.
const WalletSetupScreen = ({ accountData, onProceed }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  // Shared feedback line for the result of the last action. Success
  // entries auto-clear after 4s; error entries persist until the next
  // action so the user has time to read and act on them.
  // (gpt-batch4 reviewer-question accepted.)
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!feedback || feedback.type !== 'success') return undefined;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const prettyAddress = accountData?.pretty_address || accountData?.prettyAddress || "";
  const serialNumber = accountData?.serial_number || accountData?.serialNumber || 0;
  const hasVerifiedIdentity = Boolean(
    accountData?.configured === true && serialNumber > 0 && prettyAddress,
  );

  const initialStatus = hasVerifiedIdentity
    ? (accountData?.needs_healing ? 'fracked' : 'healthy')
    : 'pending';
  const [status, setStatus] = useState(initialStatus);

  const handleHeal = async () => {
    setIsProcessing(true);
    setFeedback(null);
    try {
      // BUG-15 FIX: healWallet returns raw JSON; check both possible success indicators
      const result = await healWallet();
      const ok = result.success || result.status === "success";
      if (ok) {
        setStatus('healthy');
        const healed = result.coins_healed || 0;
        setFeedback({
          type: 'success',
          text: healed > 0
            ? `Identity repaired (${healed} coin${healed === 1 ? '' : 's'} healed).`
            : 'Identity is healthy.',
        });
      } else {
        setFeedback({
          type: 'error',
          text: result.error || result.message || 'Heal failed. Try again later.',
        });
      }
    } catch (e) {
      setFeedback({
        type: 'error',
        text: 'Heal failed. ' + (e.message || 'Network unreachable.'),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const showHealButton = status === 'fracked';

  return (
    <main className="wallet-setup-screen">
      <section
        className="wallet-setup-screen__card glass-container"
        aria-labelledby="wallet-setup-title"
      >
        <header className="wallet-setup-screen__header">
          <User size={48} className="wallet-setup-screen__hero-icon" />
          <h1 id="wallet-setup-title" className="wallet-setup-screen__title">
            Welcome!
          </h1>
        </header>

        <section className="wallet-setup-screen__status" aria-live="polite">
          {status === 'pending' && (
            <div className="wallet-setup-screen__message wallet-setup-screen__message--warning">
              <Loader2 size={20} className="wallet-setup-screen__spinner" />
              <p>Your identity is still loading. You can proceed to the dashboard; the app will keep trying to load your details.</p>
            </div>
          )}
          {status === 'fracked' && (
            <div className="wallet-setup-screen__message wallet-setup-screen__message--warning">
              <ShieldAlert size={20} />
              <p>Warning: Identity Coin is fracked. You can heal it now or proceed anyway.</p>
            </div>
          )}
          {status === 'healthy' && (
            <div className="wallet-setup-screen__message wallet-setup-screen__message--success">
              <CheckCircle size={20} />
              <p>Your identity is healthy and verified.</p>
            </div>
          )}
        </section>

        <p className="wallet-setup-screen__address">
          <span className="wallet-setup-screen__address-label">
            Your Qmail Address is:
          </span>
          <span>{prettyAddress || "—"}</span>
        </p>

        <section className="wallet-setup-screen__actions" aria-label="Wallet setup actions">
          {showHealButton && (
            <div className="wallet-setup-screen__action-row">
              <button
                className="wallet-setup-screen__button wallet-setup-screen__button--secondary"
                onClick={handleHeal}
                disabled={isProcessing}
              >
                <RefreshCw className={isProcessing ? 'wallet-setup-screen__spinner' : ''} /> Heal Identity
              </button>
            </div>
          )}

          {/* Check Change is hidden for now per BUG-62.
          <div className="wallet-setup-screen__action-row">
            <button className="wallet-setup-screen__button wallet-setup-screen__button--secondary">
              Check Change
            </button>
          </div>
          <p className="wallet-setup-screen__hint">
            Check Change shows the denominations in your wallet. Smaller coins are used to pay fees when sending mail.
          </p>
          */}
          {/* Feedback line. Success auto-clears after 4s; errors
              persist until the next action so the user can read them. */}
          {feedback && (
            <div
              className={`wallet-setup-screen__message wallet-setup-screen__message--feedback ${
                feedback.type === 'success'
                  ? 'wallet-setup-screen__message--success'
                  : 'wallet-setup-screen__message--warning'
              }`}
              role="status"
            >
              {feedback.type === 'success'
                ? <CheckCircle size={18} />
                : <AlertCircle size={18} />}
              <p>{feedback.text}</p>
            </div>
          )}

          <button
            className="wallet-setup-screen__button wallet-setup-screen__button--primary"
            onClick={onProceed}
          >
            Go to Dashboard <ArrowRight />
          </button>
        </section>
      </section>
    </main>
  );
};

export default WalletSetupScreen;
