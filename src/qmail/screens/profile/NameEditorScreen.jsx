/* eslint-disable react/prop-types */
import { useState } from "react";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { postDrdUserProfile } from "../../../api/qmailApiServices";
import { RAIDA_COUNT } from "../serverStatusUi";
import {
  formatProfileSaveMessage,
  utf8ByteLength,
} from "./profileHelpers";

const MAX_NAME_BYTES = 63;
const COUNTER_SHOW_FROM = 40;

/**
 * First / last name editor with UTF-8 byte caps.
 */
const NameEditorScreen = ({
  profileForm,
  registered,
  onProfileSaved,
}) => {
  const [firstName, setFirstName] = useState(
    () => profileForm?.firstName ?? "",
  );
  const [lastName, setLastName] = useState(
    () => profileForm?.lastName ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const firstBytes = utf8ByteLength(firstName);
  const lastBytes = utf8ByteLength(lastName);
  const overLimit =
    firstBytes > MAX_NAME_BYTES || lastBytes > MAX_NAME_BYTES;

  const handleSave = async () => {
    if (overLimit || saving) return;

    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        ...profileForm,
        firstName,
        lastName,
      };
      const result = await postDrdUserProfile(payload);
      if (!result?.success) {
        setStatus({
          kind: "error",
          message: result?.error || "Failed to save name.",
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
        message: err?.message || "Failed to save name.",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderCounter = (bytes) => {
    if (bytes <= COUNTER_SHOW_FROM) return null;
    const over = bytes > MAX_NAME_BYTES;
    return (
      <span
        className={
          over
            ? "qmail-profile-form__counter qmail-profile-form__counter--error"
            : "qmail-profile-form__counter qmail-profile-form__counter--warn"
        }
      >
        {bytes} / {MAX_NAME_BYTES} bytes
      </span>
    );
  };

  return (
    <div className="qmail-profile-form">
      {!registered ? (
        <p className="qmail-profile-modal__note">
          You are not in the directory yet — saving will create your entry.
        </p>
      ) : null}

      <div className="qmail-profile-form__field">
        <label className="qmail-profile-form__label" htmlFor="profile-first-name">
          First name
        </label>
        <input
          id="profile-first-name"
          type="text"
          className="qmail-profile-form__input"
          value={firstName}
          onChange={(event) => {
            setFirstName(event.target.value);
            setStatus(null);
          }}
          disabled={saving}
          autoComplete="given-name"
        />
        {renderCounter(firstBytes)}
      </div>

      <div className="qmail-profile-form__field">
        <label className="qmail-profile-form__label" htmlFor="profile-last-name">
          Last name
        </label>
        <input
          id="profile-last-name"
          type="text"
          className="qmail-profile-form__input"
          value={lastName}
          onChange={(event) => {
            setLastName(event.target.value);
            setStatus(null);
          }}
          disabled={saving}
          autoComplete="family-name"
        />
        {renderCounter(lastBytes)}
      </div>

      {overLimit ? (
        <p className="qmail-profile-form__error" role="alert">
          Each name must be at most {MAX_NAME_BYTES} UTF-8 bytes.
        </p>
      ) : null}

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
            disabled={saving || overLimit}
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

export default NameEditorScreen;
