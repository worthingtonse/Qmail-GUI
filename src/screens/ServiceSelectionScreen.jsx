import { useCallback, useEffect, useState } from 'react';
import { Mail, ArrowRight, Lock, ShieldCheck, Download, ExternalLink, Loader2, AlertCircle, LogIn, Info, X } from 'lucide-react';
import {
  importCredentials,
  getIdentity,
  hasId,
  normalizeIdentityForUi,
} from '../api/qmailApiServices';
import {
  clearSkipAutoRestore,
  shouldSkipAutoRestore,
} from '../qmail/skipAutoRestore';
import './ServiceSelectionScreen.css';

// FIX-13-0B: produce a status-aware error message for the user's
// very first action with the app. The original code collapsed every
// failure into "Locker is empty or invalid" — misleading when the
// backend was simply unreachable or returned a 5xx.
//
// gpt-batch4 #3: a fourth synthetic status, "no_wallet", covers
// the case where the backend IS reachable but has no registered
// wallets — that's a wallet-setup issue, not a network issue.
const formatImportError = (result) => {
  const status = result?.status;
  const backendMessage = result?.error;

  if (status === "network") {
    return "Can't reach the QMail backend. Make sure it's running and try again.";
  }
  if (status === "no_wallet") {
    return "No wallet is registered on the QMail backend. Open the QMail wallet manager to set one up, then try again.";
  }
  if (status === 400) {
    return "That doesn't look like a valid locker code. Check for typos and try again.";
  }
  if (status === 404) {
    return "We couldn't find anything in that locker. It may already have been imported, or the code may be wrong.";
  }
  if (typeof status === "number" && status >= 500) {
    return "The QMail backend returned an error. Try again in a moment.";
  }
  // Unknown status — surface the backend's own message if it gave
  // us one; otherwise fall back to the generic.
  return backendMessage || "Failed to import credentials. Try again.";
};

// eslint-disable-next-line react/prop-types
const ServiceSelectionScreen = ({ onSelectService }) => {
  const [currentStep, setCurrentStep] = useState('initial'); // initial, locker-input
  const [lockerCode, setLockerCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [checkingLocalIdentity, setCheckingLocalIdentity] = useState(false);
  const [localIdentityAvailable, setLocalIdentityAvailable] = useState(false);
  const [localIdentity, setLocalIdentity] = useState(null);
  const [localIdentityLoading, setLocalIdentityLoading] = useState(false);
  const [localIdentityError, setLocalIdentityError] = useState('');
  const [showBuyLockerHint, setShowBuyLockerHint] = useState(false);
  const [showBuyLockerInfo, setShowBuyLockerInfo] = useState(false);

  const loadConfiguredIdentity = useCallback(async (attempts = 3) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const identity = await getIdentity();
      if (identity && identity.configured) {
        return normalizeIdentityForUi(identity);
      }
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkLocalIdentity = async () => {
      const skipAutoRestore = shouldSkipAutoRestore();

      setCheckingLocalIdentity(true);
      setLocalIdentityError('');

      try {
        const [idCheck, normalized] = await Promise.all([
          hasId(),
          loadConfiguredIdentity(1),
        ]);
        if (cancelled) return;

        const hasLocalIdentity = Boolean(idCheck?.has_id || normalized?.configured);
        const configuredIdentity = normalized?.configured ? normalized : null;

        if (hasLocalIdentity && !skipAutoRestore) {
          clearSkipAutoRestore();
          onSelectService('qmail', configuredIdentity);
          return;
        }

        setLocalIdentityAvailable(Boolean(skipAutoRestore && hasLocalIdentity));
        setLocalIdentity(configuredIdentity);
      } catch (err) {
        if (cancelled) return;
        console.warn("Existing identity check failed:", err);
        setLocalIdentityAvailable(false);
        setLocalIdentity(null);
      } finally {
        if (!cancelled) {
          setCheckingLocalIdentity(false);
        }
      }
    };

    checkLocalIdentity();
    return () => {
      cancelled = true;
    };
  }, [loadConfiguredIdentity, onSelectService]);

  const handleUseLocalIdentity = async () => {
    setLocalIdentityLoading(true);
    setLocalIdentityError('');
    setError('');

    try {
      const normalized = localIdentity?.configured
        ? localIdentity
        : await loadConfiguredIdentity(3);

      if (!normalized || !normalized.configured) {
        setLocalIdentityError(
          "The local identity could not be loaded. Try again, or import a locker code.",
        );
        setLocalIdentity(null);
        return;
      }

      clearSkipAutoRestore();
      onSelectService('qmail', normalized);
    } catch (err) {
      setLocalIdentityError(
        err?.message
          ? `The local identity could not be loaded. ${err.message}`
          : "The local identity could not be loaded. Try again.",
      );
    } finally {
      setLocalIdentityLoading(false);
    }
  };

  
  // FIX-03: After a successful import, the importCredentials response
  // does NOT carry identity fields (it has coins_found, coins_saved,
  // wallet_path, mail_wallet_path). We need to call getIdentity() to
  // get the real identity, normalize it, and only THEN advance — so
  // WalletSetupScreen and the dashboard receive a real address rather
  // than blank/undefined values.
  const handleImport = async () => {
    setLoading(true);
    setError('');
    setLoadingMessage('Connecting to RAIDA servers...');

    try {
      const result = await importCredentials(lockerCode.trim());

      if (!result.success) {
        // FIX-13-0B: switch on the structured status field rather
        // than collapsing every failure into one message. Helps a
        // first-time user understand what went wrong on their very
        // first action.
        setError(formatImportError(result));
        setLoading(false);
        return;
      }

      clearSkipAutoRestore();

      setLoadingMessage('Verifying identity...');

      // The backend can lag briefly between import success and
      // identity registration. Try once, retry once after 500ms if
      // we don't see configured=true yet.
      let identity = await getIdentity();
      if (!identity || !identity.configured) {
        await new Promise((r) => setTimeout(r, 500));
        identity = await getIdentity();
      }

      const normalized = normalizeIdentityForUi(identity);

      // gpt-batch4 #2: preserve mail_wallet_path from the import
      // response so WalletSetupScreen can target the right wallet
      // for Check Change (the post-import action). Attach to the
      // normalized identity with both camelCase and snake_case for
      // consumer-shape parity.
      const mailWalletPath =
        result?.data?.mail_wallet_path || result?.data?.wallet_path || null;
      const enriched = normalized
        ? {
            ...normalized,
            mailWalletPath,
            mail_wallet_path: mailWalletPath,
          }
        : null;

      setLoadingMessage('Credentials imported successfully!');
      setTimeout(() => {
        // gpt-batch2 #2: only pass the normalized identity downstream
        // when it's actually configured. A truthy-but-unconfigured
        // object (or raw import metadata) would skip QMailDashboard's
        // mount-time retry and leave the user with placeholder data
        // for the rest of the session.
        //
        // Service argument is 'provisioning' (not 'qmail') because we
        // always want the post-import user to see WalletSetupScreen's
        // welcome — even if identity isn't visible yet, that screen
        // shows a friendly "identity loading" state and the user can
        // proceed to the dashboard which will keep retrying.
        const seedData =
          enriched && enriched.configured ? enriched : null;
        onSelectService('provisioning', seedData);
      }, 1000);
    } catch (err) {
      // FIX-13-0B: unexpected throw (typically a JS-level error,
      // not an HTTP status). Treat as network-class so the message
      // still nudges the user toward the right recovery.
      setError(formatImportError({ status: "network", error: err.message }));
      setLoading(false);
    }
  };

  // The backend accepts any non-empty locker_key. If the input still looks
  // like the QMail-native XXX-XXXX shape (<=8 alphanumerics, no other
  // characters), we apply the legacy auto-hyphenation as a typing affordance.
  // Otherwise we pass the value through unchanged so a longer/differently
  // formatted key from another tool can be pasted in.
  const looksLikeQmailShape = (raw) => {
    const alnumOnly = raw.replace(/[A-Za-z0-9]/g, '').length === 0
      || raw.replace(/[A-Za-z0-9-]/g, '').length === 0;
    const stripped = raw.replace(/-/g, '');
    return alnumOnly && stripped.length <= 8;
  };

  const formatLockerCode = (value) => {
    if (!looksLikeQmailShape(value)) return value;
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleaned.length <= 3) return cleaned;
    return cleaned.slice(0, 3) + '-' + cleaned.slice(3, 8);
  };

  const handleLockerInputChange = (e) => {
    const formatted = formatLockerCode(e.target.value);
    setLockerCode(formatted);
    setError('');
  };

  const isValidLockerCode = () => lockerCode.trim().length > 0;

  const handleBuyLockerCode = () => {
    window.open(
      'https://www.distributedmailsystem.com/register',
      '_blank',
      'noopener,noreferrer',
    );
    setShowBuyLockerHint(true);
  };

  const renderInitialScreen = () => (
    <div className="service-selection-screen__actions">
      {checkingLocalIdentity && (
        <div className="service-selection-screen__notice service-selection-screen__notice--checking">
          <Loader2 className="spinning" size={16} />
          <span className="service-selection-screen__notice-copy">
            Checking for an existing local identity...
          </span>
        </div>
      )}

      {localIdentityAvailable && (
        <button
          type="button"
          onClick={handleUseLocalIdentity}
          className="service-selection-screen__button service-selection-screen__button--existing-identity"
          disabled={localIdentityLoading}
        >
          <div className="service-selection-screen__button-content">
            {localIdentityLoading ? (
              <Loader2
                className="service-selection-screen__button-icon spinning"
                size={24}
              />
            ) : (
              <LogIn className="service-selection-screen__button-icon" size={24} />
            )}
            <span className="service-selection-screen__button-copy">
              <strong>Use existing local identity</strong>
              <small className="service-selection-screen__button-subtitle">
                An identity is already set up on this device
              </small>
            </span>
          </div>
        </button>
      )}

      {localIdentityError && (
        <div className="service-selection-screen__notice service-selection-screen__notice--error">
          <AlertCircle size={16} />
          <span className="service-selection-screen__notice-copy">{localIdentityError}</span>
          <button
            type="button"
            onClick={handleUseLocalIdentity}
            disabled={localIdentityLoading}
            className="service-selection-screen__locker-retry"
          >
            Retry
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setCurrentStep('locker-input')}
        className="service-selection-screen__button service-selection-screen__button--qmail"
      >
        <div className="service-selection-screen__button-content">
          <Download className="service-selection-screen__button-icon" size={24} />
          <span>I Have a Locker Code</span>
        </div>
      </button>

      <div className="service-selection-screen__buy-locker-row">
        <button
          type="button"
          onClick={handleBuyLockerCode}
          className="service-selection-screen__button service-selection-screen__button--wallet"
        >
          <div className="service-selection-screen__button-content">
            <ExternalLink className="service-selection-screen__button-icon" size={24} />
            <span>Buy Locker Code</span>
          </div>
        </button>
        <button
          type="button"
          className="service-selection-screen__info-button"
          onClick={() => setShowBuyLockerInfo((show) => !show)}
          aria-label="About buying a locker code"
          aria-expanded={showBuyLockerInfo}
        >
          <Info size={18} />
        </button>
      </div>

      {showBuyLockerInfo && (
        <div
          className="service-selection-screen__info-popover"
          role="dialog"
          aria-label="Locker code information"
        >
          <button
            type="button"
            className="service-selection-screen__info-close"
            onClick={() => setShowBuyLockerInfo(false)}
            aria-label="Close locker code information"
          >
            <X size={16} />
          </button>
          <p>
            You do not have to purchase a qmail address if you have a RAIDA
            locker code that contains one CloudCoin note valued more than 10
            CloudCoins. The CloudCoin will be imported from the locker into this
            program so you can stake your Qmail address. Locker codes can be
            created by using the CloudCoin Desktop software or by clicking this
            button.
          </p>
        </div>
      )}

      {showBuyLockerHint && (
        <div className="service-selection-screen__notice service-selection-screen__notice--hint">
          <AlertCircle size={16} />
          <span className="service-selection-screen__notice-copy">
            {"Once you have your code, come back here and tap 'I Have a Locker Code'."}
          </span>
        </div>
      )}
    </div>
  );

  const renderLockerInput = () => (
    <div className="service-selection-screen__locker-panel">
      <div className="service-selection-screen__locker-label">Enter Your Locker Code</div>
      <input
        type="text"
        value={lockerCode}
        onChange={handleLockerInputChange}
        onKeyPress={(e) => e.key === 'Enter' && !loading && handleImport()}
        placeholder="XXX-XXXX"
        className="service-selection-screen__locker-input"
        disabled={loading}
        autoFocus
      />
      
      {loading && (
        <div className="service-selection-screen__locker-progress">
          <span className="service-selection-screen__locker-progress-text">{loadingMessage}</span>
        </div>
      )}
      
      {error && (
        <div className="service-selection-screen__locker-error">
          <AlertCircle size={16} />
          <span>{error}</span>
          {/* FIX-13-0B: small inline Retry next to the error.
              The Continue button below already retries on click, but
              an explicit "Retry" wording is clearer when the failure
              was network-class and the input is unchanged.
              gpt-batch4: styling moved to a BEM retry class
              class so disabled/hover states are themeable. */}
          <button
            type="button"
            onClick={handleImport}
            disabled={loading || !isValidLockerCode()}
            className="service-selection-screen__locker-retry"
          >
            Retry
          </button>
        </div>
      )}
      
      <div className="service-selection-screen__locker-actions">
        <button
          type="button"
          onClick={handleImport}
          disabled={loading || !isValidLockerCode()}
          className="service-selection-screen__button service-selection-screen__button--qmail"
        >
          <div className="service-selection-screen__button-content">
            {loading ? (
              <>
                <Loader2
                  className="service-selection-screen__button-icon spinning"
                  size={24}
                />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <ArrowRight
                  className="service-selection-screen__button-icon"
                  size={24}
                />
                <span>Continue</span>
              </>
            )}
          </div>
        </button>
        
        <button
          type="button"
          onClick={() => {
            setCurrentStep('initial');
            setLockerCode('');
            setError('');
          }}
          className="service-selection-screen__button service-selection-screen__button--secondary"
          disabled={loading}
        >
          Back
        </button>
      </div>
      {/* FIX-35-0B: relaxed help text — the locker_key field accepts
          any non-empty string per the v4 plan / MVP-20. The old
          "Standard format: ABC-1234" contradicted the relaxed mask. */}
      <div className="service-selection-screen__locker-help">
        ABC-1234 standard; longer keys from other tools also accepted.
      </div>
    </div>
  );

  return (
    <div className="service-selection-screen">
      <div className="service-selection-screen__card">
        <div className="service-selection-screen__icon-header">
          <Mail className="service-selection-screen__icon" size={64} />
        </div>
        <h1 className="service-selection-screen__title">Welcome to QMail</h1>
        <p className="service-selection-screen__description">
          Experience the next generation of secure communication. Quantum-safe encryption protecting your digital legacy.
        </p>
        {currentStep === 'initial' && renderInitialScreen()}
        {currentStep === 'locker-input' && renderLockerInput()}
      </div>

      <div className="service-selection-screen__envelope-cluster">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="service-selection-screen__envelope">
            <div className="service-selection-screen__envelope-body"></div>
            <div className="service-selection-screen__envelope-flap"></div>
            <Lock className="service-selection-screen__envelope-lock" size={28} />
            <div className="service-selection-screen__envelope-badge">
              <ShieldCheck size={18} />
            </div>
            <div className="service-selection-screen__envelope-particles">
              {[...Array(5)].map((_, j) => (
                <div key={j} className="service-selection-screen__particle"></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ServiceSelectionScreen;
