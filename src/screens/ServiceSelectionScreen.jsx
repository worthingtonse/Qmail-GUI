import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  File,
  FolderOpen,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  getQMailIdentityProvisionStatus,
  getIdentity,
  hasId,
  normalizeIdentityForUi,
} from '../api/qmailApiServices';
import WalletActionModal from '../qmail/screens/WalletActionModal';
import {
  clearSkipAutoRestore,
  shouldSkipAutoRestore,
} from '../qmail/skipAutoRestore';
import './ServiceSelectionScreen.css';

const BOOTSTRAP_SOURCES = [
  {
    id: 'locker',
    label: 'Use a Locker Key',
    description: 'Download every coin into the Default wallet',
    icon: KeyRound,
  },
  {
    id: 'files',
    label: 'Use CloudCoin Files',
    description: 'Choose one or more .bin or .stack files',
    icon: File,
  },
  {
    id: 'folder',
    label: 'Use a CloudCoin Folder',
    description: 'Import supported files from a folder',
    icon: FolderOpen,
  },
];

const PURCHASE_LOCKER_URL = 'https://www.distributedmailsystem.com/register';

// eslint-disable-next-line react/prop-types
const ServiceSelectionScreen = ({ onSelectService }) => {
  const [activeAddMethod, setActiveAddMethod] = useState(null);
  const [checkingLocalIdentity, setCheckingLocalIdentity] = useState(true);
  const [localIdentityAvailable, setLocalIdentityAvailable] = useState(false);
  const [localIdentity, setLocalIdentity] = useState(null);
  const [localIdentityLoading, setLocalIdentityLoading] = useState(false);
  const [localIdentityError, setLocalIdentityError] = useState('');
  const [canFinishIdentitySetup, setCanFinishIdentitySetup] = useState(false);
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
        const [idCheck, normalized, provisionStatus] = await Promise.all([
          hasId(),
          loadConfiguredIdentity(1),
          getQMailIdentityProvisionStatus(),
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
        setCanFinishIdentitySetup(
          !hasLocalIdentity && provisionStatus?.success && provisionStatus.data?.canFinish,
        );
      } catch (error) {
        if (cancelled) return;
        console.warn('Existing identity check failed:', error);
        setLocalIdentityAvailable(false);
        setLocalIdentity(null);
        setCanFinishIdentitySetup(false);
      } finally {
        if (!cancelled) setCheckingLocalIdentity(false);
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

    try {
      const normalized = localIdentity?.configured
        ? localIdentity
        : await loadConfiguredIdentity(3);
      if (!normalized?.configured) {
        setLocalIdentityError(
          'The local identity could not be loaded. Try again, or import CloudCoins.',
        );
        setLocalIdentity(null);
        return;
      }

      clearSkipAutoRestore();
      onSelectService('qmail', normalized);
    } catch (error) {
      setLocalIdentityError(
        error?.message
          ? `The local identity could not be loaded. ${error.message}`
          : 'The local identity could not be loaded. Try again.',
      );
    } finally {
      setLocalIdentityLoading(false);
    }
  };

  const handleIdentityReady = async (assignment) => {
    const normalized = await loadConfiguredIdentity(3);
    if (!normalized?.configured) {
      throw new Error('The backend assigned the identity coin, but the identity is not readable yet.');
    }

    const mailWalletPath = assignment?.mail_wallet_path || null;
    clearSkipAutoRestore();
    setCanFinishIdentitySetup(false);
    setActiveAddMethod(null);
    onSelectService('provisioning', {
      ...normalized,
      mailWalletPath,
      mail_wallet_path: mailWalletPath,
    });
  };

  const handleModalClose = async () => {
    setActiveAddMethod(null);
    const status = await getQMailIdentityProvisionStatus();
    if (status?.success) {
      setCanFinishIdentitySetup(Boolean(status.data?.canFinish));
      // Provisioning may have succeeded even if the user bailed out of the
      // modal (e.g. identity delivery failed and they closed). Surface the
      // "Use existing local identity" path instead of the bootstrap sources
      // so a fresh deposit can't hit the Mail-already-has-identity conflict.
      if (status.data?.identityExists) {
        setLocalIdentityAvailable(true);
      }
    }
  };

  const handleBuyLockerCode = () => {
    window.open(PURCHASE_LOCKER_URL, '_blank', 'noopener,noreferrer');
    setShowBuyLockerHint(true);
  };

  const bootstrapActionsVisible = !checkingLocalIdentity && !localIdentityAvailable;
  const resumeProvisioning = activeAddMethod === 'resume';

  return (
    <div className="service-selection-screen">
      <div className="service-selection-screen__card">
        <div className="service-selection-screen__icon-header">
          <Mail className="service-selection-screen__icon" size={64} />
        </div>
        <h1 className="service-selection-screen__title">Welcome to QMail</h1>
        <p className="service-selection-screen__description">
          Choose how to provide the CloudCoin that will identify this mailbox.
        </p>

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
                  <Loader2 className="service-selection-screen__button-icon spinning" size={24} />
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

          {bootstrapActionsVisible && canFinishIdentitySetup && (
            <button
              type="button"
              onClick={() => setActiveAddMethod('resume')}
              className="service-selection-screen__button service-selection-screen__button--existing-identity"
            >
              <div className="service-selection-screen__button-content">
                <LogIn className="service-selection-screen__button-icon" size={24} />
                <span className="service-selection-screen__button-copy">
                  <strong>Finish identity setup</strong>
                  <small className="service-selection-screen__button-subtitle">
                    Use the eligible CloudCoin already in the Default wallet
                  </small>
                </span>
              </div>
            </button>
          )}

          {bootstrapActionsVisible && BOOTSTRAP_SOURCES.map((source) => {
              const Icon = source.icon;
              return (
              <button
                key={source.id}
                type="button"
                onClick={() => setActiveAddMethod(source.id)}
                className="service-selection-screen__button service-selection-screen__button--qmail"
              >
                <div className="service-selection-screen__button-content">
                  <Icon className="service-selection-screen__button-icon" size={24} />
                  <span className="service-selection-screen__button-copy">
                    <strong>{source.label}</strong>
                    <small className="service-selection-screen__button-subtitle">
                      {source.description}
                    </small>
                  </span>
                </div>
              </button>
              );
          })}

          {bootstrapActionsVisible && (
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
          )}

          {bootstrapActionsVisible && showBuyLockerInfo && (
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
                Buying is optional. You can set up QMail with any locker key,
                file, or folder containing an eligible CloudCoin worth at least 1 CC.
              </p>
            </div>
          )}

          {bootstrapActionsVisible && showBuyLockerHint && (
            <div className="service-selection-screen__notice service-selection-screen__notice--hint">
              <AlertCircle size={16} />
              <span className="service-selection-screen__notice-copy">
                Once you have your code, return here and choose Use a Locker Key.
              </span>
            </div>
          )}
        </div>

        <div className="service-selection-screen__security-note">
          <ShieldCheck size={16} />
          <span>Your coins are stored locally on this device</span>
        </div>
      </div>

      <WalletActionModal
        isOpen={Boolean(activeAddMethod)}
        initialMode="add"
        initialAddMethod={resumeProvisioning ? 'locker' : activeAddMethod || 'locker'}
        autoOpenPicker={activeAddMethod === 'files' || activeAddMethod === 'folder'}
        onboardingMode
        resumeProvisioning={resumeProvisioning}
        onClose={handleModalClose}
        onIdentityReady={handleIdentityReady}
        onProvisionDeferred={() => setCanFinishIdentitySetup(true)}
      />
    </div>
  );
};

export default ServiceSelectionScreen;
