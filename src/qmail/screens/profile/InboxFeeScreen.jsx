/* eslint-disable react/prop-types */
import { useState } from "react";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { postDrdUserProfile } from "../../../api/qmailApiServices";
import { RAIDA_COUNT } from "../serverStatusUi";
import { formatProfileSaveMessage } from "./profileHelpers";

/* Mirrors the server's fee rules (drd_fee_from_string): a non-negative
 * decimal CC amount with at most 8 fractional digits. */
const FEE_PATTERN = /^\d+(\.\d{1,8})?$/;

function normalizeFee(value) {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "");
  return raw === "" ? "0" : raw;
}

/**
 * Inbox fee editor (DRD `fee`): what senders must pay to deliver qmail to
 * this address. White-listed senders are exempt.
 */
const InboxFeeScreen = ({
  profileForm,
  registered,
  onProfileSaved,
}) => {
  const [fee, setFee] = useState(() => normalizeFee(profileForm?.fee));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const trimmed = fee.trim();
  const feeInvalid = trimmed !== "" && !FEE_PATTERN.test(trimmed);

  const handleSave = async () => {
    if (feeInvalid || saving) return;

    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        ...profileForm,
        fee: normalizeFee(trimmed),
      };
      const result = await postDrdUserProfile(payload);
      if (!result?.success) {
        setStatus({
          kind: "error",
          message: result?.error || "Failed to save inbox fee.",
        });
        return;
      }

      if (typeof onProfileSaved === "function") {
        onProfileSaved(payload);
      }
      setStatus({
        kind: "success",
        message: formatProfileSaveMessage(result, RAIDA_COUNT),
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err?.message || "Failed to save inbox fee.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="qmail-profile-form">
      {!registered ? (
        <p className="qmail-profile-modal__note">
          You are not in the directory yet — saving will create your entry.
        </p>
      ) : null}

      <p className="qmail-profile-class__explainer">
        The inbox fee is what a sender must pay for you to receive their
        qmail — you get paid for your attention, and spam becomes expensive.
        Set it to 0 for a free inbox. Addresses on your white list can
        always send to you for free, regardless of this fee.
      </p>

      <div className="qmail-profile-form__field">
        <label className="qmail-profile-form__label" htmlFor="profile-inbox-fee">
          Inbox fee (CC)
        </label>
        <input
          id="profile-inbox-fee"
          type="text"
          inputMode="decimal"
          className="qmail-profile-form__input qmail-profile-form__input--mono"
          value={fee}
          onChange={(event) => {
            setFee(event.target.value);
            setStatus(null);
          }}
          disabled={saving}
          placeholder="0"
          aria-invalid={feeInvalid}
        />
        {feeInvalid ? (
          <span className="qmail-profile-form__error" role="alert">
            Enter a non-negative CC amount with at most 8 decimal places,
            e.g. 0, 0.5 or 10992.934002.
          </span>
        ) : (
          <span className="qmail-profile-form__hint">
            Decimal CC amount, up to 8 decimal places. 0 = free inbox.
          </span>
        )}
      </div>

      <div className="qmail-profile-modal__footer" style={{ borderTop: 0, padding: 0 }}>
        {status ? (
          <p
            className={
              status.kind === "success"
                ? "qmail-profile-modal__status qmail-profile-modal__status--success"
                : "qmail-profile-modal__status qmail-profile-modal__status--error"
            }
            role={status.kind === "error" ? "alert" : "status"}
          >
            {status.kind === "success" ? (
              <CheckCircle size={16} aria-hidden="true" />
            ) : (
              <AlertCircle size={16} aria-hidden="true" />
            )}
            <span>{status.message}</span>
          </p>
        ) : (
          <span />
        )}
        <div className="qmail-profile-modal__footer-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || feeInvalid}
            onClick={handleSave}
          >
            {saving ? (
              <>
                <Loader2 className="spinning" size={16} aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InboxFeeScreen;
