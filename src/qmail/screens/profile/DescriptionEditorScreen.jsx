/* eslint-disable react/prop-types */
import { useState } from "react";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { postDrdUserProfile } from "../../../api/qmailApiServices";
import { RAIDA_COUNT } from "../serverStatusUi";
import { formatProfileSaveMessage } from "./profileHelpers";

const MAX_DESCRIPTION_CHARS = 512;

/**
 * Plain-text profile description editor (API encodes websafe-base64).
 */
const DescriptionEditorScreen = ({
  profileForm,
  registered,
  onProfileSaved,
}) => {
  const [description, setDescription] = useState(
    () => profileForm?.description ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const length = description.length;
  const overLimit = length > MAX_DESCRIPTION_CHARS;

  const handleChange = (event) => {
    setDescription(event.target.value);
    setStatus(null);
  };

  const handleSave = async () => {
    if (overLimit || saving) return;

    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        ...profileForm,
        description,
      };
      const result = await postDrdUserProfile(payload);
      if (!result?.success) {
        setStatus({
          kind: "error",
          message: result?.error || "Failed to save description.",
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
        message: err?.message || "Failed to save description.",
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

      <div className="qmail-profile-form__field">
        <label
          className="qmail-profile-form__label"
          htmlFor="profile-description"
        >
          Description
        </label>
        <textarea
          id="profile-description"
          className="qmail-profile-form__textarea"
          value={description}
          onChange={handleChange}
          disabled={saving}
          rows={8}
          aria-invalid={overLimit}
        />
        <span
          className={
            overLimit
              ? "qmail-profile-form__counter qmail-profile-form__counter--error"
              : length > MAX_DESCRIPTION_CHARS * 0.85
                ? "qmail-profile-form__counter qmail-profile-form__counter--warn"
                : "qmail-profile-form__counter"
          }
        >
          {length} / {MAX_DESCRIPTION_CHARS}
        </span>
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

export default DescriptionEditorScreen;
