import { useState } from "react";
import { X, UserPlus, Loader2, AlertCircle } from "lucide-react";
import { CONTACT_ADDRESS_OR_SN_ERROR } from "../../api/qmailApiServices";
import "./AddContactModal.css";

// eslint-disable-next-line react/prop-types
const AddContactModal = ({ isOpen, onClose, onAddContact }) => {
  const [name, setName] = useState("");
  const [addressOrSn, setAddressOrSn] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const resetForm = () => {
    setName("");
    setAddressOrSn("");
    setError("");
  };

  const handleClose = () => {
    if (isSaving) return;
    resetForm();
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedAddressOrSn = addressOrSn.trim();

    if (!trimmedName) {
      setError("Please provide a name or alias.");
      return;
    }

    if (!trimmedAddressOrSn) {
      setError(CONTACT_ADDRESS_OR_SN_ERROR);
      return;
    }

    setError("");
    setIsSaving(true);

    try {
      const result = await onAddContact({
        name: trimmedName,
        addressOrSn: trimmedAddressOrSn,
      });

      if (!result?.success) {
        setError(result?.error || "Failed to add contact.");
        return;
      }

      resetForm();
    } catch (err) {
      setError(err?.message || "Failed to add contact.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    handleSave();
  };

  return (
    <div className="compose-modal__overlay">
      <section
        className="compose-modal add-contact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-contact-modal-title"
      >
        <header className="compose-modal__header add-contact-modal__header">
          <h2 id="add-contact-modal-title" className="add-contact-modal__title">
            Add New Contact
          </h2>
          <button
            onClick={handleClose}
            className="compose-modal__close-button add-contact-modal__close-button"
            disabled={isSaving}
            type="button"
          >
            <X size={20} />
          </button>
        </header>
        <form
          className="compose-modal__body add-contact-modal__body"
          onSubmit={handleSubmit}
          aria-busy={isSaving}
        >
          <section className="add-contact-modal__fields" aria-label="Contact details">
            <div className="compose-modal__field add-contact-modal__field">
              <label className="add-contact-modal__label" htmlFor="contact-name">
                Name / Alias:
              </label>
            <input
              type="text"
              id="contact-name"
              className="add-contact-modal__input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder="e.g., Alice Johnson"
              disabled={isSaving}
            />
            </div>
            <div className="compose-modal__field add-contact-modal__field">
              <label className="add-contact-modal__label" htmlFor="contact-address-or-sn">
                QMail address or serial number:
              </label>
            <input
              type="text"
              id="contact-address-or-sn"
              className={`add-contact-modal__input add-contact-modal__input--mono ${
                error ? "add-contact-modal__input--error" : ""
              }`}
              value={addressOrSn}
              onChange={(e) => {
                setAddressOrSn(e.target.value);
                setError("");
              }}
              placeholder="e.g., 1234567"
              disabled={isSaving}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "add-contact-error" : "contact-address-help"}
            />
            <p id="contact-address-help" className="add-contact-modal__field-hint">
              Serial numbers work now. QMail address lookup is not available yet.
            </p>
            </div>
          </section>
          {error && (
            <div
              id="add-contact-error"
              className="add-contact-modal__error"
              role="alert"
            >
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <footer className="compose-modal__footer add-contact-modal__footer">
          <button
            className="compose-modal__send-button add-contact-modal__save-button"
            disabled={isSaving}
            type="submit"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="spinning" /> Saving...
              </>
            ) : (
              <>
                <UserPlus size={16} /> Save Contact
              </>
            )}
          </button>
          </footer>
        </form>
      </section>
    </div>
  );
};

export default AddContactModal;
