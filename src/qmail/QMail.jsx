import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getCoinEncryptionStatus } from "../api/qmailApiServices";
import CoinEncryptionModal from "./screens/CoinEncryptionModal";
import QMailDashboard from "./screens/QMailDashboard";
import "./screens/QMailDashboard.css";

// FIX-03: forward initialIdentity from App so QMailDashboard can seed
// userAccount synchronously when App already has the identity.
// eslint-disable-next-line react/prop-types
const QMail = ({ initialIdentity, onSignOut }) => {
  const [coinFileState, setCoinFileState] = useState(null);
  const [startupUnlocked, setStartupUnlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const prepareCoinFiles = async () => {
      let diskState = null;
      try {
        diskState = await window.electronAPI?.getCoinFileState?.();
      } catch (error) {
        console.warn("Could not inspect coin-file state:", error);
      }

      if (!diskState) {
        const apiState = await getCoinEncryptionStatus();
        diskState = {
          state: apiState.success
            ? apiState.data?.encryptedFilesExist
              ? "encrypted"
              : "decrypted"
            : "mixed",
          encryptedCount: 0,
          decryptedCount: 0,
          ignoredCount: 0,
        };
      }
      if (cancelled) return;
      setCoinFileState(diskState);

      if (diskState.state !== "encrypted" && diskState.state !== "mixed") {
        setStartupUnlocked(true);
        return;
      }

      // The filesystem check can finish before core.exe binds its HTTP port.
      // Give the backend time to become callable before showing the mandatory
      // password prompt.
      const deadline = Date.now() + 15000;
      while (!cancelled && Date.now() < deadline) {
        const status = await getCoinEncryptionStatus();
        if (status.success) {
          if (status.data.keySet) setStartupUnlocked(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    };

    prepareCoinFiles();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!coinFileState) {
    return (
      <div className="coin-encryption-startup" role="status">
        <Loader2 size={24} className="spinning" />
        <span>Checking coin-file security...</span>
      </div>
    );
  }

  if (
    !startupUnlocked &&
    (coinFileState.state === "encrypted" || coinFileState.state === "mixed")
  ) {
    return (
      <CoinEncryptionModal
        action="unlock"
        required
        onComplete={() => setStartupUnlocked(true)}
      />
    );
  }

  return (
    <QMailDashboard
      initialIdentity={initialIdentity}
      initialCoinFileState={coinFileState}
      onSignOut={onSignOut}
    />
  );
};

export default QMail;
