/* eslint-disable react/prop-types */
import { useState } from "react";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { postDrdUserProfile } from "../../../api/qmailApiServices";
import { RAIDA_COUNT } from "../serverStatusUi";
import { formatProfileSaveMessage } from "./profileHelpers";

const CLASS_OPTIONS = [
  { value: 0, label: "Accept all classes (bit and above)" },
  { value: 1, label: "byte and above" },
  { value: 2, label: "kilo and above" },
  { value: 3, label: "mega and above" },
  { value: 4, label: "giga and above" },
];

function coerceClassRejection(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 4) return 0;
  return n;
}

/**
 * Lowest accepted QMail address class (DRD class_rejection).
 * 0 = accept all classes (bit and above).
 */
const ClassEditorScreen = ({
  profileForm,
  registered,
  onProfileSaved,
}) => {
  const [classRejection, setClassRejection] = useState(
    () => coerceClassRejection(profileForm?.classRejection),
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const handleSave = async () => {
    if (saving) return;

    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        ...profileForm,
        classRejection,
      };
      const result = await postDrdUserProfile(payload);
      if (!result?.success) {
        setStatus({
          kind: "error",
          message: result?.error || "Failed to save lowest accepted class.",
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
        message: err?.message || "Failed to save lowest accepted class.",
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
        Senders whose QMail address class is below this level will be rejected.
        Higher classes stake more coins, which makes spam more expensive.
      </p>

      <fieldset className="qmail-profile-class__fieldset" disabled={saving}>
        <legend className="qmail-profile-form__label">
          Lowest accepted class
        </legend>
        <div className="qmail-profile-class__options" role="radiogroup" aria-label="Lowest accepted class">
          {CLASS_OPTIONS.map((option) => {
            const id = `profile-class-${option.value}`;
            return (
              <label key={option.value} className="qmail-profile-class__option" htmlFor={id}>
                <input
                  id={id}
                  type="radio"
                  name="profile-class-rejection"
                  value={option.value}
                  checked={classRejection === option.value}
                  onChange={() => {
                    setClassRejection(option.value);
                    setStatus(null);
                  }}
                  disabled={saving}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

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
            disabled={saving}
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

export default ClassEditorScreen;
