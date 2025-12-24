import React, { useState, useEffect } from "react";
import { UserPlus, Search, Trash2, RefreshCw } from "lucide-react";
import "./QMailDashboard.css";
import AddContactModal from "./AddContactModal";
import { getPopularContacts } from "../../api/qmailApiServices";

const ContactsPane = () => {
  const [contacts, setContacts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load popular contacts on component mount
  useEffect(() => {
    loadPopularContacts();
  }, []);

  const loadPopularContacts = async () => {
    setLoading(true);
    setError(null);
    const result = await getPopularContacts(20);
    if (result.success) {
      // Transform API data to match your contact structure
      const transformedContacts = result.data.contacts.map((contact) => ({
        id: contact.userId,
        name: contact.fullName,
        email: contact.autoAddress,
        status: determineStatus(contact.popularity), // Map popularity to status badge
        description: contact.description,
        popularity: contact.popularity,
        contactCount: contact.contactCount,
      }));
      setContacts(transformedContacts);
    } else {
      console.error("Failed to load contacts:", result.error);
      setError(result.error);
    }
    setLoading(false);
  };

  // Determine badge status based on popularity or contact count
  const determineStatus = (popularity) => {
    if (popularity >= 100) return "gold";
    if (popularity >= 50) return "silver";
    if (popularity >= 10) return "bronze";
    return "none";
  };

  const handleAddContact = (newContact) => {
    // Add new contact to local state
    setContacts((prevContacts) => [
      ...prevContacts,
      {
        ...newContact,
        id: Date.now(),
        status: "none",
        popularity: 0,
        contactCount: 0,
      },
    ]);
    setIsAddContactOpen(false);
  };

  const handleDeleteContact = (contactId) => {
    if (window.confirm("Are you sure you want to delete this contact?")) {
      setContacts((prevContacts) =>
        prevContacts.filter((c) => c.id !== contactId)
      );
    }
  };

  const filteredContacts = contacts.filter(
    (contact) =>
      contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <AddContactModal
        isOpen={isAddContactOpen}
        onClose={() => setIsAddContactOpen(false)}
        onAddContact={handleAddContact}
      />
      <div className="contacts-pane">
        <div className="contacts-header">
          <h2>Contacts & DRD Search</h2>
          <div className="contacts-header-actions">
            <button
              className="refresh-button secondary"
              onClick={loadPopularContacts}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? "spinning" : ""} />
            </button>
            <button
              className="add-contact-btn primary"
              onClick={() => setIsAddContactOpen(true)}
            >
              <UserPlus size={16} /> Add Contact
            </button>
          </div>
        </div>

        <div className="search-bar-container">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            placeholder="Search contacts or DRD alias..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {error && (
          <div className="error-message">
            <p>Error loading contacts: {error}</p>
            <button
              className="retry-button secondary"
              onClick={loadPopularContacts}
            >
              Retry
            </button>
          </div>
        )}

        <div className="contact-list">
          {loading ? (
            <div className="loading-state">
              <RefreshCw size={32} className="spinning" />
              <p>Loading contacts...</p>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="empty-state">
              <UserPlus size={48} />
              <p>{searchTerm ? "No contacts found" : "No contacts yet"}</p>
              <button
                className="add-contact-btn primary"
                onClick={() => setIsAddContactOpen(true)}
              >
                <UserPlus size={16} /> Add Your First Contact
              </button>
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <div key={contact.id} className="contact-item">
                <div className={`contact-avatar status-${contact.status}`}>
                  <span>{contact.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="contact-details">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-email">{contact.email}</div>
                  {contact.description && (
                    <div className="contact-description">
                      {contact.description}
                    </div>
                  )}
                  {contact.popularity > 0 && (
                    <div className="contact-stats">
                      Popularity: {contact.popularity} | Contacts:{" "}
                      {contact.contactCount}
                    </div>
                  )}
                </div>
                <button
                  className="contact-action-btn danger"
                  onClick={() => handleDeleteContact(contact.id)}
                  title="Delete contact"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="drd-mock-info">
          <p>
            💡 Contact not listed? Search the Distributed Resource Directory
            (DRD) by their alias above.
          </p>
          <p>Popular contacts are loaded from the DRD network automatically.</p>
        </div>
      </div>
    </>
  );
};

export default ContactsPane;
