// screens/WalletSetupScreen.jsx
import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle,
  ArrowRight,
  RefreshCw,
  Search,
  User,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  healWallet,
  prepareChange,
  lookupMailWalletPath,
} from '../../api/qmailApiServices';
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
//
// gpt-batch4 #1: the action formerly called "Make Change" is reframed
// as "Check Change" because the backend endpoint /coins/prepare-change
// is read-only — it returns a denomination breakdown, it does NOT
// mutate coins. The old "Change prepared." success toast was a lie.
// The actual mutating make-change flow needs /coins/break and a
// denomination-selection UI; that's a separate ticket.
//
// gpt-batch4 #2: prepareChange now targets the Mail wallet (the one
// the user just imported credentials into) rather than defaulting to
// the backend's Default wallet. Pulled from accountData.mailWalletPath
// when present; falls back to lookupMailWalletPath() if not.
const WalletSetupScreen = ({ accountData, onProceed }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  // Shared feedback line for the result of the last action. Success
  // entries auto-clear after 4s; error entries persist until the next
  // action so the user has time to read and act on them.
  // (gpt-batch4 reviewer-question accepted.)
  const [feedback, setFeedback] = useState(null);
  // Denomination breakdown from the most recent Check Change.
  const [changeReport, setChangeReport] = useState(null);

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

  const emailAddress = accountData?.email_address || accountData?.prettyAddress || prettyAddress;
  const greetingName = emailAddress
    ? emailAddress.split('@')[0]
    : (accountData?.first_name || accountData?.firstName || "");

  // Resolve the wallet path Check Change should target. Prefer the
  // path that came through onboarding (the Mail wallet that received
  // the imported credentials). Fall back to a live lookup if absent.
  const resolveWalletPath = async () => {
    const seeded =
      accountData?.mailWalletPath ||
      accountData?.mail_wallet_path ||
      null;
    if (seeded) return seeded;
    const lookup = await lookupMailWalletPath();
    return lookup.path;
  };

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

  // gpt-batch4 #1: Check Change replaces Make Change. Read-only — it
  // reports what denominations are in the wallet so the user can see
  // whether they have small-denomination coins ready for send-fees.
  const handleCheckChange = async () => {
    setIsProcessing(true);
    setFeedback(null);
    setChangeReport(null);
    try {
      const walletPath = await resolveWalletPath();
      const result = await prepareChange(walletPath);
      const ok = result && (result.success || result.status === "success");
      if (ok) {
        const denoms = Array.isArray(result.denominations) ? result.denominations : [];
        setChangeReport({
          walletPath: result.wallet_path || walletPath || "",
          denominations: denoms,
        });
        const totalCoins = denoms.reduce((sum, d) => sum + (d.count || 0), 0);
        const breakable = denoms.some((d) => d.can_break && d.count > 0);
        setFeedback({
          type: 'success',
          text: totalCoins === 0
            ? "Your wallet has no coins yet."
            : breakable
              ? `Found ${totalCoins} coin${totalCoins === 1 ? '' : 's'} across ${denoms.length} denomination${denoms.length === 1 ? '' : 's'}.`
              : `Found ${totalCoins} coin${totalCoins === 1 ? '' : 's'}, but none can be broken into smaller change.`,
        });
      } else {
        setFeedback({
          type: 'error',
          text: (result && (result.error || result.message))
            || 'Could not check change right now.',
        });
      }
    } catch (e) {
      setFeedback({
        type: 'error',
        text: 'Check Change failed. ' + (e.message || 'Network unreachable.'),
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
            {greetingName ? `Welcome, ${greetingName}!` : "Welcome!"}
          </h1>
          <p className="wallet-setup-screen__address">{prettyAddress || "—"}</p>
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

        <section className="wallet-setup-screen__actions" aria-label="Wallet setup actions">
          <div className="wallet-setup-screen__action-row">
            {showHealButton && (
              <button
                className="wallet-setup-screen__button wallet-setup-screen__button--secondary"
                onClick={handleHeal}
                disabled={isProcessing}
              >
                <RefreshCw className={isProcessing ? 'wallet-setup-screen__spinner' : ''} /> Heal Identity
              </button>
            )}
            <button
              className="wallet-setup-screen__button wallet-setup-screen__button--secondary"
              onClick={handleCheckChange}
              disabled={isProcessing}
              title="See which denominations are in your wallet. Smaller coins are used to pay fees when sending mail."
            >
              <Search /> Check Change
            </button>
          </div>

          {/* FIX-37-0B / gpt-batch4: plain-language caption beneath
              the action row. gpt requested the friendlier "fees when
              sending mail" wording. */}
          <p className="wallet-setup-screen__hint">
            Check Change shows the denominations in your wallet. Smaller coins are used to pay fees when sending mail.
          </p>

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

          {/* gpt-batch4 #1: render the denomination breakdown when
              Check Change returns successfully. This is the honest
              "what's in your wallet" view that replaces the old
              fake "Change prepared." toast. */}
          {changeReport && changeReport.denominations.length > 0 && (
            <section
              className="wallet-setup-screen__breakdown"
              aria-label="Wallet denominations"
            >
              <div className="wallet-setup-screen__breakdown-header">
                <span>Denomination</span>
                <span>Coins</span>
              </div>
              {changeReport.denominations
                .slice()
                .sort((a, b) => (b.value || 0) - (a.value || 0))
                .map((d) => (
                  <div
                    key={d.denomination}
                    className="wallet-setup-screen__breakdown-row"
                  >
                    <span>
                      {d.value} CC{d.can_break ? '' : ' (smallest)'}
                    </span>
                    <span>{d.count}</span>
                  </div>
                ))}
            </section>
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
