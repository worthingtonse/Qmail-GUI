/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Pencil, X } from "lucide-react";
import "./AddContactModal.css";

const EditContactModal = ({ contact, onClose, onSaveContact }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(contact?.name || "");
    setDescription(contact?.description || "");
    setError("");
  }, [contact]);

  if (!contact) return null;

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError("Please provide a name or alias.");
      return;
    }

    setError("");
    setIsSaving(true);
    try {
      const result = await onSaveContact({
        name: trimmedName,
        description: description.trim(),
      });
      if (!result?.success) {
        setError(result?.error || "Failed to update contact.");
      }
    } catch (err) {
      setError(err?.message || "Failed to update contact.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="compose-modal__overlay" onClick={handleClose} role="presentation">
      <section
        className="compose-modal add-contact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-contact-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="compose-modal__header add-contact-modal__header">
          <h2 id="edit-contact-modal-title" className="add-contact-modal__title">
            Edit Contact
          </h2>
          <button
            onClick={handleClose}
            className="compose-modal__close-button add-contact-modal__close-button"
            disabled={isSaving}
            type="button"
            aria-label="Close edit contact dialog"
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
              <label className="add-contact-modal__label" htmlFor="edit-contact-name">
                Name / Alias:
              </label>
              <input
                id="edit-contact-name"
                className="add-contact-modal__input"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                disabled={isSaving}
                autoFocus
              />
            </div>
            <div className="compose-modal__field add-contact-modal__field">
              <label className="add-contact-modal__label" htmlFor="edit-contact-address">
                QMail address:
              </label>
              <input
                id="edit-contact-address"
                className="add-contact-modal__input add-contact-modal__input--mono"
                value={contact.email || contact.id || ""}
                disabled
                readOnly
              />
              <p className="add-contact-modal__field-hint">
                The address identifies this contact and cannot be changed.
              </p>
            </div>
            <div className="compose-modal__field add-contact-modal__field">
              <label className="add-contact-modal__label" htmlFor="edit-contact-description">
                Description:
              </label>
              <textarea
                id="edit-contact-description"
                className="add-contact-modal__input add-contact-modal__textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional notes about this contact"
                disabled={isSaving}
                rows={4}
              />
            </div>
          </section>
          {error && (
            <div className="add-contact-modal__error" role="alert">
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
                  <Pencil size={16} /> Save Changes
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};

export default EditContactModal;
