import React, { useState, useEffect } from "react";
import { UserPlus, Search, Trash2, RefreshCw, Users, TrendingUp, Globe } from "lucide-react";
import "./ContactsPane.css";
import AddContactModal from "./AddContactModal";
import { avatarColorFromString } from "./avatarColor";
import { getPopularContacts, getContacts, addContact, deleteContact } from "../../api/qmailApiServices";

const ContactsPane = () => {
  const [contacts, setContacts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [currentMode, setCurrentMode] = useState("contacts"); // "contacts" or "popular"
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Load regular contacts on component mount
 // Load regular contacts on component mount
useEffect(() => {
  loadContacts();
  setIsInitialLoad(false);
}, []);

  // Handle search with debouncing
// Handle search with debouncing
useEffect(() => {
  if (!searchTerm.trim()) {
    if (currentMode === "search") {
      setCurrentMode("contacts");
    }
    return;
  }

  const debounceTimer = setTimeout(() => {
    setCurrentMode("search");
    loadContacts();
  }, 300);

  return () => clearTimeout(debounceTimer);
  // BUG-23 FIX: Added currentMode to dependency array
}, [searchTerm, currentMode]);

const loadContacts = async () => {
  // Never show loader when list is empty OR when searching
  const shouldShowLoader = contacts.length > 0 && currentMode !== "search";
  
  if (shouldShowLoader) {
    setLoading(true);
  }
  setError(null);
  
  try {
    const result = await getContacts(searchTerm.trim());
    if (result.success) {
      const transformedContacts = result.data.contacts.map((contact) => ({
        id: contact.userId,
        name: contact.fullName,
        email: contact.autoAddress,
        status: "none",
        description: contact.description,
        source: "user",
      }));
      setContacts(transformedContacts);
    } else {
      console.error("Failed to load contacts:", result.error);
      setError(`Failed to load contacts: ${result.error}`);
      setContacts([]);
    }
  } catch (err) {
    console.error("Error in loadContacts:", err);
    setError(`Network error: ${err.message}. Is the QMail server running?`);
    setContacts([]);
  }
  
  setLoading(false);
};

 const loadPopularContacts = async () => {
  // Never show loader when list is empty
  if (contacts.length > 0) {
    setLoading(true);
  }
  setError(null);
  setCurrentMode("popular");
  
  try {
    const result = await getPopularContacts(50);
    if (result.success) {
      const transformedContacts = result.data.contacts.map((contact) => ({
        id: contact.userId,
        name: contact.fullName,
        email: contact.autoAddress,
        status: determineStatus(contact.popularity),
        description: contact.description,
        popularity: contact.popularity,
        contactCount: contact.contactCount,
        source: "drd",
      }));
      setContacts(transformedContacts);
    } else {
      console.error("Failed to load popular contacts:", result.error);
      setError(result.error);
      setContacts([]);
    }
  } catch (err) {
    console.error("Error in loadPopularContacts:", err);
    setError("Failed to load popular contacts");
    setContacts([]);
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

  // BUG-14 FIX: Persist contacts to backend, then refresh from server
  const handleAddContact = async (newContact) => {
    try {
      // Parse the name into first/last for the backend
      const nameParts = (newContact.name || "").trim().split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const result = await addContact({
        serial_number: newContact.serial_number || "0",
        first_name: firstName,
        last_name: lastName,
        description: newContact.email || "",
      });

      if (result.success) {
        await loadContacts(); // Refresh from server
      } else {
        setError(`Failed to add contact: ${result.error}`);
      }
    } catch (err) {
      setError(`Error adding contact: ${err.message}`);
    }
    setIsAddContactOpen(false);
  };

  const handleDeleteContact = async (contactId) => {
    if (window.confirm("Are you sure you want to delete this contact?")) {
      try {
        const result = await deleteContact(contactId);
        if (result.success) {
          await loadContacts(); // Refresh from server
        } else {
          setError(`Failed to delete contact: ${result.error}`);
        }
      } catch (err) {
        setError(`Error deleting contact: ${err.message}`);
      }
    }
  };

  const handleRefresh = () => {
  // Don't show loader when refreshing empty list
  if (contacts.length === 0) {
    if (currentMode === "popular") {
      loadPopularContacts();
    } else {
      loadContacts();
    }
    return;
  }
  
  if (currentMode === "popular") {
    loadPopularContacts();
  } else {
    loadContacts();
  }
};

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setError(null); // Clear any previous errors when typing
  };

  const switchToPopularContacts = () => {
    setSearchTerm("");
    setIsSearching(false);
    setError(null);
    loadPopularContacts();
  };

  const switchToRegularContacts = () => {
    setSearchTerm("");
    setIsSearching(false);
    setError(null);
    setCurrentMode("contacts");
    loadContacts();
  };

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
              className="refresh-btn secondary"
              onClick={handleRefresh}
              disabled={loading}
              title="Refresh contacts"
            >
              <RefreshCw size={16} className={loading ? "spinning" : ""} />
            </button>
            <button
              className={`contacts-btn ${currentMode === "contacts" ? "active" : "secondary"}`}
              onClick={switchToRegularContacts}
              disabled={loading}
              title="View your contacts"
            >
             <Users size={16} /> 
            </button>
            <button
              className={`popular-contacts-btn ${currentMode === "popular" ? "active" : "secondary"}`}
              onClick={switchToPopularContacts}
              disabled={loading}
              title="View popular contacts from DRD" 
            >
              <TrendingUp size={16} />
            </button>
            <button
              className="add-contact-btn primary"
              onClick={() => setIsAddContactOpen(true)}
              title="Add new contact"
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
            onChange={handleSearchChange}
          />
        </div>

        {error && (
          <div className="error-message">
            <p>Error loading contacts: {error}</p>
            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <button
                className="retry-button secondary"
                onClick={handleRefresh}
              >
                Retry
              </button>
              <button
                className="retry-button secondary"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="contact-list">
          {loading ? (
            <div className="loading-state">
              <RefreshCw size={32} className="spinning" />
              <p>
                {searchTerm.trim() 
                  ? `Searching for "${searchTerm}"...` 
                  : currentMode === "popular" 
                    ? "Loading popular contacts..." 
                    : "Loading contacts..."
                }
              </p>
            </div>
          ) : contacts.length === 0 ? (
            <div className="empty-state">
              <UserPlus size={48} />
              <p>
                {searchTerm.trim() 
                  ? `No contacts found for "${searchTerm}". Try a different search term or check the DRD network.` 
                  : currentMode === "popular"
                    ? "No popular contacts available at the moment."
                    : "No contacts in your list yet."
                }
              </p>
              {!searchTerm.trim() && currentMode !== "popular" && (
                <button
                  className="add-contact-btn primary"
                  onClick={() => setIsAddContactOpen(true)}
                >
                  <UserPlus size={16} /> Add Your First Contact
                </button>
              )}
            </div>
          ) : (
            <div className="contacts-results">
              {searchTerm.trim() && (
                <div className="search-results-info">
                   Found {contacts.length} contact{contacts.length !== 1 ? 's' : ''} for "{searchTerm}"
                </div>
              )}
              {!searchTerm.trim() && currentMode === "popular" && (
                <div className="mode-info">
                   Showing {contacts.length} popular contacts from the DRD network
                </div>
              )}
              {contacts.map((contact) => (
                <div key={contact.id} className={`contact-item ${contact.source === "drd" ? "contact-drd" : "contact-user"}`}>
                  <div
                    className={`contact-avatar status-${contact.status}`}
                    style={{ backgroundColor: avatarColorFromString(contact.email).bg }}
                  >
                    <span>{contact.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="contact-details">
                    <div className="contact-name-row">
                      <span className="contact-name">{contact.name}</span>
                      <span className={`contact-source-badge ${contact.source === "drd" ? "badge-drd" : "badge-user"}`}>
                        {contact.source === "drd" ? (
                          <><Globe size={10} /> DRD</>
                        ) : (
                          <><Users size={10} /> My Contact</>
                        )}
                      </span>
                    </div>
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
                  {contact.source === "user" && (
                    <button
                      className="contact-action-btn danger"
                      onClick={() => handleDeleteContact(contact.id)}
                      title="Delete contact"
                    >
                      <Trash2 size={16} color="white" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Show info text based on current mode */}
        <div className="drd-mock-info">
          {searchTerm.trim() ? (
            <p>
               Searching the Distributed Resource Directory (DRD) for "{searchTerm}".
            </p>
          ) : currentMode === "popular" ? (
            <p>
               Showing trending contacts from the DRD network. Use search to find specific contacts.
            </p>
          ) : (
            <>
              <p>
                 Contact not listed? Search the Distributed Resource Directory
                (DRD) by their alias above.
              </p>
              <p>Use the "Popular" button to see trending contacts from the DRD network.</p>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ContactsPane;