import React, { useState } from "react";
import { X, UserPlus } from "lucide-react";
import "./AddContactModal.css";
const AddContactModal = ({ isOpen, onClose, onAddContact }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  if (!isOpen) {
    return null;
  }

  const handleSave = () => {
    if (!name || !email) {
      alert("Please provide a name/alias and an email address.");
      return;
    }
    onAddContact({ name, email });
    setName("");
    setEmail("");
  };

  return (
    <div className="compose-modal-overlay">
      <div className="compose-modal add-contact-modal">
        <div className="compose-modal-header">
          <h3>Add New Contact</h3>
          <button onClick={onClose} className="close-modal-btn">
            <X size={20} />
          </button>
        </div>
        <div className="compose-modal-body">
          <div className="form-group">
            <label htmlFor="contact-name">Name / Alias:</label>
            <input
              type="text"
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Alice Johnson"
            />
          </div>
          <div className="form-group">
            <label htmlFor="contact-email">Email Address:</label>
            <input
              type="email"
              id="contact-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g., alice.j@example.com"
            />
          </div>
        </div>
        <div className="compose-modal-footer">
          <button className="send-button" onClick={handleSave}>
            <UserPlus size={16} /> Save Contact
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddContactModal;
