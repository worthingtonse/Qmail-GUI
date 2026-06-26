import { useState, useEffect, useRef } from "react";
import {
  UserPlus,
  Search,
  Trash2,
  RefreshCw,
  Users,
  TrendingUp,
  Globe,
  Check,
  AlertTriangle,
  Star,
} from "lucide-react";
import "./ContactsPane.css";
import AddContactModal from "./AddContactModal";
import {
  getPopularContacts,
  getContacts,
  addContact,
  deleteContact,
  resolveAddressOrSn,
  convertSnToEmail,
  setContactFavorite,
} from "../../api/qmailApiServices";
import { useNotification } from "../../components/common/notifications/NotificationContext";
import { parseQmailAddress } from "../address/qmailAddress";
import QmailCartoucheAvatar from "./QmailCartoucheAvatar";

const SERIAL_NUMBER_PATTERN = /^\d+$/;
const CONTACT_AVATAR_TONE_COUNT = 12;

const normalizeContactValue = (value) =>
  String(value || "").trim().toLowerCase();

const getContactIdentityValues = (contact) =>
  [contact.id, contact.email, contact.name]
    .map(normalizeContactValue)
    .filter(Boolean);

const contactMatchesSearchTerm = (contact, searchTerm) => {
  const term = normalizeContactValue(searchTerm);
  if (!term) return true;
  return getContactIdentityValues(contact).some((value) => value.includes(term));
};

const ContactsPane = () => {
  const [contacts, setContacts] = useState([]);
  const [userContacts, setUserContacts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentMode, setCurrentMode] = useState("contacts"); // "contacts" or "popular"
  const [savingDrdContactId, setSavingDrdContactId] = useState(null);
  const [pendingDeleteContact, setPendingDeleteContact] = useState(null);
  const [isDeletingContact, setIsDeletingContact] = useState(false);
  const [deleteContactError, setDeleteContactError] = useState("");
  const [lookupInput, setLookupInput] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const { addNotification, showSuccess, showError } = useNotification();
  const isMountedRef = useRef(false);

  // Load regular contacts on component mount
  useEffect(() => {
    isMountedRef.current = true;
    loadContacts();
    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

// Handle search with debouncing
useEffect(() => {
  if (currentMode === "lookup") {
    return;
  }

  if (!searchTerm.trim()) {
    if (currentMode === "search") {
      setCurrentMode("contacts");
      setContacts(userContacts);
    }
    return;
  }

  const debounceTimer = setTimeout(() => {
    setCurrentMode("search");
    loadContacts({ displayMode: "search" });
  }, 300);

  return () => clearTimeout(debounceTimer);
  // BUG-23 FIX: Added currentMode to dependency array
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchTerm, currentMode]);

  const loadContacts = async ({ displayMode = currentMode, updateDisplay = true } = {}) => {
    // Never show loader when list is empty OR when searching
    const shouldShowLoader =
      contacts.length > 0 && displayMode !== "search" && displayMode !== "lookup";

    if (shouldShowLoader) {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await getContacts();
      if (!isMountedRef.current) return;

      if (result.success) {
        const transformedContacts = result.data.contacts.map((contact) => ({
          id: contact.userId,
          name: contact.fullName,
          email: contact.autoAddress,
          status: "none",
          description: contact.description,
          isFavorite: Boolean(contact.isFavorite),
          source: "user",
        }));
        setUserContacts(transformedContacts);

        if (updateDisplay && displayMode !== "popular" && displayMode !== "lookup") {
          const term = searchTerm.trim();
          setContacts(
            term
              ? transformedContacts.filter((contact) =>
                  contactMatchesSearchTerm(contact, term),
                )
              : transformedContacts,
          );
        }
      } else {
        console.error("Failed to load contacts:", result.error);
        setError(`Failed to load contacts: ${result.error}`);
        if (updateDisplay && displayMode !== "popular" && displayMode !== "lookup") {
          setContacts([]);
        }
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error("Error in loadContacts:", err);
      setError(`Network error: ${err.message}. Is the QMail server running?`);
      if (updateDisplay && displayMode !== "popular" && displayMode !== "lookup") {
        setContacts([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
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
    if (!isMountedRef.current) return;

    if (result.success) {
      const transformedContacts = result.data.contacts.map((contact) => ({
        id: contact.userId,
        name: contact.fullName,
        email: contact.autoAddress,
        status: determineStatus(contact.popularity),
        description: contact.description,
        popularity: contact.popularity,
        contactCount: contact.contactCount,
        isFavorite: Boolean(contact.isFavorite),
        source: "drd",
      }));
      setContacts(transformedContacts);
    } else {
      console.error("Failed to load popular contacts:", result.error);
      setError(result.error);
      setContacts([]);
    }
  } catch (err) {
    if (!isMountedRef.current) return;
    console.error("Error in loadPopularContacts:", err);
    setError("Failed to load popular contacts");
    setContacts([]);
  } finally {
    if (isMountedRef.current) {
      setLoading(false);
    }
  }
};

  // Determine badge status based on popularity or contact count
  const determineStatus = (popularity) => {
    if (popularity >= 100) return "gold";
    if (popularity >= 50) return "silver";
    if (popularity >= 10) return "bronze";
    return "none";
  };

  const getContactKey = (contact) =>
    String(contact.id || contact.email || contact.name || "");

  const getContactInitial = (contact) => {
    const value = String(contact?.name || contact?.email || contact?.id || "?").trim();
    // Addresses begin with "@" — skip leading punctuation and use the first
    // real letter/digit so the avatar shows "T" for "@torch.bay.kilo", not "@".
    const match = value.match(/[A-Za-z0-9]/);
    return match ? match[0].toUpperCase() : "?";
  };

  const getContactAvatarToneClass = (contact) => {
    const value = String(contact?.email || contact?.name || contact?.id || "").trim().toLowerCase();
    if (!value) {
      return "contacts-pane__avatar--tone-0";
    }

    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
    }

    return `contacts-pane__avatar--tone-${hash % CONTACT_AVATAR_TONE_COUNT}`;
  };

  const isContactSavedLocally = (contact) => {
    const targetValues = new Set(getContactIdentityValues(contact));
    if (targetValues.size === 0) return false;

    return userContacts.some((localContact) =>
      getContactIdentityValues(localContact).some((value) =>
        targetValues.has(value),
      ),
    );
  };

  const findLocalContactMatches = (value) => {
    const term = normalizeContactValue(value);
    if (!term) return [];

    return userContacts.filter((contact) =>
      getContactIdentityValues(contact).some(
        (candidate) => candidate === term || candidate.includes(term),
      ),
    );
  };

  const handleLookupContact = async () => {
    const value = lookupInput.trim();
    if (!value) {
      setLookupResult({
        type: "error",
        message: "Enter a serial number, QMail address, or contact name.",
      });
      return;
    }

    setLookupLoading(true);
    setLookupResult(null);

    try {
      const localMatches = findLocalContactMatches(value);
      if (localMatches.length > 0) {
        setLookupResult({
          type: "local",
          message: "Matched local contacts. This lookup does not query the DRD.",
          contacts: localMatches,
        });
        return;
      }

      if (SERIAL_NUMBER_PATTERN.test(value)) {
        const result = await convertSnToEmail(value);
        if (result.success) {
          setLookupResult({
            type: "remote",
            message: "Serial number resolved by the local QMail service.",
            contacts: [
              {
                id: value,
                name:
                  `${result.firstName || ""} ${result.lastName || ""}`.trim() ||
                  `Serial ${value}`,
                email: result.email,
                source: "lookup",
              },
            ],
          });
          return;
        }

        setLookupResult({
          type: "empty",
          message:
            "No local contact matched, and the local service did not return an address for that serial number.",
        });
        return;
      }

      // A full QMail address ("51.254@bit", "51.254.0", "0.51.254.0")
      // resolves locally to a serial number + denomination.
      const parsedAddress = parseQmailAddress(value);
      if (parsedAddress.ok) {
        const result = await convertSnToEmail(
          parsedAddress.serialNumber,
          parsedAddress.denominationCode,
        );
        if (result.success) {
          setLookupResult({
            type: "remote",
            message: "Address resolved by the local QMail service.",
            contacts: [
              {
                id: String(parsedAddress.serialNumber),
                name:
                  `${result.firstName || ""} ${result.lastName || ""}`.trim() ||
                  parsedAddress.canonical,
                email: result.email || parsedAddress.canonical,
                source: "lookup",
              },
            ],
          });
          return;
        }

        setLookupResult({
          type: "empty",
          message:
            "No local contact matched, and the local service did not return a name for that address.",
        });
        return;
      }

      setLookupResult({
        type: "empty",
        message:
          "No local contact matched. Enter a QMail address (like 51.254@bit) or a serial number.",
      });
    } catch (err) {
      setLookupResult({
        type: "error",
        message: `Lookup failed: ${err.message}`,
      });
    } finally {
      setLookupLoading(false);
    }
  };

  const buildContactPayload = async ({ name, addressOrSn, description }) => {
    const nameParts = (name || "").trim().split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    const resolved = await resolveAddressOrSn(addressOrSn);

    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }

    return {
      success: true,
      data: {
        serial_number: resolved.data.serial_number,
        // Present when the input was a full QMail address (e.g.
        // "51.254@bit"); absent for a bare serial number, in which case
        // the backend default applies.
        ...(resolved.data.denomination !== undefined && {
          denomination: resolved.data.denomination,
        }),
        ...(resolved.data.class_name && { class_name: resolved.data.class_name }),
        first_name: firstName,
        last_name: lastName,
        description: (description || "").trim(),
      },
    };
  };

  // BUG-14 FIX: Persist contacts to backend, then refresh from server
  const handleAddContact = async (newContact) => {
    try {
      const payload = await buildContactPayload({
        name: newContact.name,
        addressOrSn: newContact.addressOrSn,
        description: newContact.description,
      });

      if (!payload.success) {
        return { success: false, error: payload.error };
      }

      const result = await addContact(payload.data);

      if (result.success) {
        await loadContacts(); // Refresh from server
        setIsAddContactOpen(false);
        return { success: true };
      } else {
        return { success: false, error: `Failed to add contact: ${result.error}` };
      }
    } catch (err) {
      return { success: false, error: `Error adding contact: ${err.message}` };
    }
  };

  const handleAddPopularContact = async (contact) => {
    const contactKey = getContactKey(contact);
    setSavingDrdContactId(contactKey);
    setError(null);

    try {
      const payload = await buildContactPayload({
        name: contact.name,
        addressOrSn: contact.id || contact.email,
        description: contact.description,
      });

      if (!payload.success) {
        showError(payload.error || "Could not add DRD contact.");
        return;
      }

      const result = await addContact(payload.data);
      if (!result.success) {
        showError(`Failed to add contact: ${result.error}`);
        return;
      }

      await loadContacts({ updateDisplay: false });
      showSuccess(`${contact.name} added to your contacts.`);
    } catch (err) {
      showError(`Error adding contact: ${err.message}`);
    } finally {
      setSavingDrdContactId(null);
    }
  };

  const restoreDeletedContact = async (contact, payload) => {
    try {
      const result = await addContact(payload);
      if (!result.success) {
        showError(`Failed to restore contact: ${result.error}`);
        return;
      }

      showSuccess(`${contact.name} restored.`);
    } catch (err) {
      showError(`Error restoring contact: ${err.message}`);
    }
  };

  const handleToggleFavorite = async (contact) => {
    if (!contact || !contact.id) return;
    const nextValue = !contact.isFavorite;

    // Optimistic flip on both lists so the star updates instantly.
    const flipInList = (list) =>
      list.map((c) => (c.id === contact.id ? { ...c, isFavorite: nextValue } : c));
    setUserContacts((prev) => flipInList(prev));
    setContacts((prev) => flipInList(prev));

    const result = await setContactFavorite(contact.id, nextValue);
    if (!result.success) {
      // Rollback.
      const restoreInList = (list) =>
        list.map((c) =>
          c.id === contact.id ? { ...c, isFavorite: !nextValue } : c,
        );
      setUserContacts((prev) => restoreInList(prev));
      setContacts((prev) => restoreInList(prev));
      showError(
        `Failed to update favorite: ${result.error || "unknown error"}`,
      );
    }
  };

  const handleDeleteContact = (contact) => {
    setError(null);
    setDeleteContactError("");
    setPendingDeleteContact(contact);
  };

  const handleCancelDeleteContact = () => {
    if (isDeletingContact) return;
    setDeleteContactError("");
    setPendingDeleteContact(null);
  };

  const handleConfirmDeleteContact = async () => {
    if (!pendingDeleteContact) return;
    const contact = pendingDeleteContact;
    setIsDeletingContact(true);
    setError(null);
    setDeleteContactError("");

    try {
      const payload = await buildContactPayload({
        name: contact.name,
        addressOrSn: contact.id || contact.email,
        description: contact.description,
      });

      if (!payload.success) {
        if (!isMountedRef.current) return;
        setDeleteContactError(
          payload.error || "Could not prepare contact for deletion.",
        );
        return;
      }

      const result = await deleteContact(contact.id);
      if (!isMountedRef.current) return;

      if (!result.success) {
        // Keep delete errors inline so the confirmation stays open for retry.
        setDeleteContactError(`Failed to delete contact: ${result.error}`);
        return;
      }

      setPendingDeleteContact(null);
      setDeleteContactError("");
      await loadContacts();
      if (!isMountedRef.current) return;

      addNotification(`${contact.name} deleted. Click to undo.`, "success", {
        duration: 10000,
        onClick: () => restoreDeletedContact(contact, payload.data),
      });
    } catch (err) {
      if (!isMountedRef.current) return;
      // Keep delete errors inline so the confirmation stays open for retry.
      setDeleteContactError(`Error deleting contact: ${err.message}`);
    } finally {
      if (isMountedRef.current) {
        setIsDeletingContact(false);
      }
    }
  };

  const handleRefresh = () => {
  // Don't show loader when refreshing empty list
  if (contacts.length === 0) {
    if (currentMode === "popular") {
      loadPopularContacts();
    } else if (currentMode === "lookup") {
      loadContacts({ updateDisplay: false });
    } else {
      loadContacts();
    }
    return;
  }
  
  if (currentMode === "popular") {
    loadPopularContacts();
  } else if (currentMode === "lookup") {
    loadContacts({ updateDisplay: false });
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
    setError(null);
    setLookupResult(null);
    loadPopularContacts();
  };

  const switchToRegularContacts = () => {
    setSearchTerm("");
    setError(null);
    setLookupResult(null);
    setCurrentMode("contacts");
    loadContacts({ displayMode: "contacts" });
  };

  const switchToLookup = () => {
    setSearchTerm("");
    setError(null);
    setCurrentMode("lookup");
    loadContacts({ updateDisplay: false });
  };

  return (
    <>
      <AddContactModal
        isOpen={isAddContactOpen}
        onClose={() => setIsAddContactOpen(false)}
        onAddContact={handleAddContact}
      />
      {pendingDeleteContact && (
        <div
          className="contacts-pane__delete-overlay"
          role="presentation"
          onClick={handleCancelDeleteContact}
        >
          <section
            className="contacts-pane__delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-contact-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="contacts-pane__delete-header">
              <AlertTriangle size={22} />
              <h3 id="delete-contact-title">Delete Contact?</h3>
            </header>
            <p className="contacts-pane__delete-copy">
              This will remove {pendingDeleteContact.name} from your local
              contacts.
            </p>
            {pendingDeleteContact.email && (
              <p className="contacts-pane__delete-address">
                {pendingDeleteContact.email}
              </p>
            )}
            {deleteContactError && (
              <div className="contacts-pane__delete-error" role="alert">
                {deleteContactError}
              </div>
            )}
            <footer className="contacts-pane__delete-actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={isDeletingContact}
                onClick={handleCancelDeleteContact}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={isDeletingContact}
                onClick={handleConfirmDeleteContact}
              >
                {isDeletingContact ? (
                  <>
                    <RefreshCw size={16} className="spinning" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete
                  </>
                )}
              </button>
            </footer>
          </section>
        </div>
      )}
      <section className="contacts-pane" aria-label="Contacts and DRD search">
        <header className="contacts-pane__header">
          <h2>Contacts & DRD Search</h2>
          <div
            className="contacts-pane__header-actions"
            role="toolbar"
            aria-label="Contacts actions"
          >
            <button
             type="button"
             className="btn btn--secondary contacts-pane__refresh-button"
             onClick={handleRefresh}
             disabled={loading}
             title="Refresh contacts"
             aria-label="Refresh contacts"
            >
             <RefreshCw size={16} className={loading ? "spinning" : ""} />
            </button>
            <button
             type="button"
             className={`btn btn--secondary contacts-pane__mode-button${currentMode === "contacts" ? " contacts-pane__mode-button--active" : ""}`}
             onClick={switchToRegularContacts}
             disabled={loading}
             title="View your contacts"
             aria-label="View your contacts"
             aria-pressed={currentMode === "contacts"}
            >
             <Users size={16} />
            </button>
            <button
             type="button"
             className={`btn btn--secondary contacts-pane__mode-button${currentMode === "popular" ? " contacts-pane__mode-button--active" : ""}`}
             onClick={switchToPopularContacts}
             disabled={loading}
             title="View popular contacts from DRD"
             aria-label="View popular contacts from DRD"
             aria-pressed={currentMode === "popular"}
            >
             <TrendingUp size={16} />
            </button>
            <button
             type="button"
             className={`btn btn--secondary contacts-pane__mode-button${currentMode === "lookup" ? " contacts-pane__mode-button--active" : ""}`}
             onClick={switchToLookup}
             disabled={loading}
             title="Lookup serial numbers and saved contact addresses"
             aria-label="Lookup serial numbers and saved contact addresses"
             aria-pressed={currentMode === "lookup"}
            >
             <Search size={16} />
            </button>
            <button
             type="button"
             className="btn btn--primary contacts-pane__add-button"
             onClick={() => setIsAddContactOpen(true)}
             title="Add new contact"
            >
             <UserPlus size={16} /> Add Contact
            </button>
          </div>
        </header>

        {currentMode !== "lookup" && (
          <div className="contacts-pane__search" role="search">
            <Search size={20} className="contacts-pane__search-icon" />
            <input
             type="text"
             placeholder="Search contacts or DRD alias..."
             className="contacts-pane__search-input"
             value={searchTerm}
             onChange={handleSearchChange}
            />
          </div>
        )}

        {error && (
          <div className="contacts-pane__error" role="alert">
            <p>Error loading contacts: {error}</p>
            <div className="contacts-pane__error-actions">
              <button
                type="button"
               className="btn btn--secondary contacts-pane__retry-button"
                onClick={handleRefresh}
              >
                Retry
              </button>
              <button
                type="button"
               className="btn btn--secondary contacts-pane__retry-button"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {currentMode === "lookup" ? (
          <section className="contacts-pane__lookup-panel" aria-labelledby="contact-lookup-title">
            <div className="contacts-pane__lookup-card">
              <h3 id="contact-lookup-title">Contact Lookup</h3>
              <p>
                Serial number lookup uses the local QMail service. Address and
                name lookup searches saved contacts only and does not query the
                DRD.
              </p>
              <div className="contacts-pane__lookup-form">
                <input
                  type="text"
                  value={lookupInput}
                  onChange={(event) => {
                    setLookupInput(event.target.value);
                    setLookupResult(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleLookupContact();
                    }
                  }}
                  placeholder="Serial number, QMail address, or contact name"
                  disabled={lookupLoading}
                />
                <button
                  type="button"
                  className="btn btn--primary contacts-pane__lookup-button"
                  onClick={handleLookupContact}
                  disabled={lookupLoading}
                >
                  {lookupLoading ? (
                    <RefreshCw size={16} className="spinning" />
                  ) : (
                    <Search size={16} />
                  )}
                  Lookup
                </button>
              </div>
              {lookupResult && (
                <div className={`contacts-pane__lookup-result contacts-pane__lookup-result--${lookupResult.type}`}>
                  <p>{lookupResult.message}</p>
                  {lookupResult.contacts?.map((contact) => (
                    <div
                      key={`${contact.id || contact.email}-${contact.name}`}
                      className="contacts-pane__lookup-match"
                    >
                      <span className="contacts-pane__lookup-name">
                        {contact.name || "Unknown Contact"}
                      </span>
                      {contact.email && (
                        <span className="contacts-pane__lookup-email">
                          {contact.email}
                        </span>
                      )}
                      {contact.id && (
                        <span className="contacts-pane__lookup-serial">
                          SN {contact.id}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="contacts-pane__list">
            {loading ? (
              <div className="contacts-pane__loading-state">
                <RefreshCw size={32} className="spinning" />
                <p>
                  {searchTerm.trim()
                    ? `Searching for "${searchTerm}"...`
                    : currentMode === "popular"
                      ? "Loading popular contacts..."
                      : "Loading contacts..."}
                </p>
              </div>
            ) : contacts.length === 0 ? (
              <div className="contacts-pane__empty-state">
                <UserPlus size={48} />
                <p>
                  {searchTerm.trim()
                    ? `No contacts found for "${searchTerm}". Try a different search term or check the DRD network.`
                    : currentMode === "popular"
                      ? "No popular contacts available at the moment."
                      : "No contacts in your list yet."}
                </p>
                {!searchTerm.trim() && currentMode !== "popular" && (
                  <button
                    type="button"
                    className="btn btn--primary contacts-pane__add-button"
                    onClick={() => setIsAddContactOpen(true)}
                  >
                    <UserPlus size={16} /> Add Your First Contact
                  </button>
                )}
              </div>
            ) : (
              <div className="contacts-pane__results">
                {searchTerm.trim() && (
                  <div className="contacts-pane__search-results-info">
                    Found {contacts.length} contact{contacts.length !== 1 ? "s" : ""} for &quot;{searchTerm}&quot;
                  </div>
                )}
                {!searchTerm.trim() && currentMode === "popular" && (
                  <div className="contacts-pane__mode-info">
                    Showing {contacts.length} popular contacts from the DRD network
                  </div>
                )}
                {contacts.map((contact) => {
                  const contactKey = getContactKey(contact);
                  const isSavingDrdContact = savingDrdContactId === contactKey;
                  const isSavedDrdContact = isContactSavedLocally(contact);
                  const parsedContactAddress = parseQmailAddress(contact.email);
                  return (
                    <article
                      key={contactKey}
                      className={`contacts-pane__item contacts-pane__item--${contact.source === "drd" ? "drd" : "user"}`}
                    >
                      <div className={`contacts-pane__identity-mark contacts-pane__identity-mark--${contact.status}`}>
                        {parsedContactAddress.ok ? (
                          <QmailCartoucheAvatar
                            serialNumber={parsedContactAddress.serialNumber}
                            denominationCode={parsedContactAddress.denominationCode}
                            className="contacts-pane__avatar-cartouche"
                          />
                        ) : (
                          <div
                            className={`contacts-pane__avatar contacts-pane__avatar--${contact.status} ${getContactAvatarToneClass(contact)}`}
                          >
                            <span>{getContactInitial(contact)}</span>
                          </div>
                        )}
                      </div>
                      <div className="contacts-pane__details">
                        <div className="contacts-pane__name-row">
                          <span className="contacts-pane__name">{contact.name}</span>
                          <span
                            className={`contacts-pane__source-badge ${contact.source === "drd" ? "contacts-pane__source-badge--drd" : "contacts-pane__source-badge--user"}`}
                          >
                            {contact.source === "drd" ? (
                              <>
                                <Globe size={10} /> DRD
                              </>
                            ) : (
                              <>
                                <Users size={10} /> My Contact
                              </>
                            )}
                          </span>
                          {contact.source === "user" && (
                            <span className="contacts-pane__inline-actions">
                              <button
                                type="button"
                                className={`contacts-pane__action-button contacts-pane__action-button--favorite${
                                  contact.isFavorite
                                    ? " contacts-pane__action-button--favorite-on"
                                    : ""
                                }`}
                                onClick={() => handleToggleFavorite(contact)}
                                title={contact.isFavorite ? "Unfavorite" : "Mark as favorite"}
                                aria-label={
                                  contact.isFavorite
                                    ? `Remove ${contact.name} from favorites`
                                    : `Mark ${contact.name} as favorite`
                                }
                                aria-pressed={contact.isFavorite ? "true" : "false"}
                              >
                                <Star
                                  size={16}
                                  fill={contact.isFavorite ? "currentColor" : "none"}
                                />
                              </button>
                              <button
                                type="button"
                                className="contacts-pane__action-button contacts-pane__action-button--danger"
                                onClick={() => handleDeleteContact(contact)}
                                title="Delete contact"
                                aria-label={`Delete ${contact.name}`}
                              >
                                <Trash2 size={16} />
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="contacts-pane__email">{contact.email}</div>
                        {contact.description && (
                          <div className="contacts-pane__description">
                            {contact.description}
                          </div>
                        )}
                        {contact.popularity > 0 && (
                          <div className="contacts-pane__stats">
                            Popularity: {contact.popularity} | Contacts:{" "}
                            {contact.contactCount}
                          </div>
                        )}
                      </div>
                      {contact.source === "drd" && (
                        <button
                          type="button"
                          className={`contacts-pane__action-button contacts-pane__action-button--add${isSavedDrdContact ? " contacts-pane__action-button--saved" : ""}`}
                          onClick={() => handleAddPopularContact(contact)}
                          disabled={isSavingDrdContact || isSavedDrdContact}
                          title={
                            isSavedDrdContact
                              ? "Added to your contacts"
                              : "Add to My Contacts"
                          }
                          aria-label={
                            isSavedDrdContact
                              ? `${contact.name} is already in your contacts`
                              : `Add ${contact.name} to your contacts`
                          }
                        >
                          {isSavingDrdContact ? (
                            <RefreshCw size={16} className="spinning" />
                          ) : isSavedDrdContact ? (
                            <Check size={16} />
                          ) : (
                            <UserPlus size={16} />
                          )}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Show info text based on current mode */}
        <div className="contacts-pane__info-panel">
          {searchTerm.trim() ? (
            <p>
               Searching the Distributed Resource Directory (DRD) for &quot;{searchTerm}&quot;.
            </p>
          ) : currentMode === "popular" ? (
            <p>
               Showing trending contacts from the DRD network. Use search to find specific contacts.
            </p>
          ) : currentMode === "lookup" ? (
            <p>
               Lookup results are for saved contacts and the local QMail serial-number service only.
            </p>
          ) : (
            <>
              <p>
                 Contact not listed? Search the Distributed Resource Directory
                (DRD) by their alias above.
              </p>
              <p>Use the &quot;Popular&quot; button to see trending contacts from the DRD network.</p>
            </>
          )}
        </div>
      </section>
    </>
  );
};

export default ContactsPane;
