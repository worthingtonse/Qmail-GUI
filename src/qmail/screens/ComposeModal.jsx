/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from "react";
import {
  X,
  Send,
  Paperclip,
  Loader,
  Users,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import "./ComposeModal.css";
import {
  getDrafts,
  sendEmail,
  getTaskStatus,
  getContacts,
  getServers,
  saveDraft,
  updateDraft,
} from "../../api/qmailApiServices";

const MIN_RAIDA_FOR_SEND = 6;
const SEND_POLL_TIMEOUT_MS = 60000;
const MAX_SEND_POLL_FAILURES = 3;
const AUTOSAVE_DELAY_MS = 5000;
const COMPOSE_ADVANCED_STORAGE_KEY = "qmail.compose.showAdvanced";

const readStoredShowAdvanced = () => {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(COMPOSE_ADVANCED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const normalizeAddressToken = (value) => {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim().toLowerCase();
  const angleMatch = raw.match(/<([^>]+)>/);
  return angleMatch ? angleMatch[1].trim() : raw;
};

const identityAddressForms = (identity) => {
  if (!identity) return new Set();
  const raw = identity.raw || {};
  return new Set(
    [
      identity.serialNumber,
      identity.serial_number,
      identity.address,
      identity.autoAddress,
      identity.auto_address,
      identity.prettyAddress,
      identity.pretty_address,
      identity.email_address,
      raw.serial_number,
      raw.address,
      raw.auto_address,
      raw.pretty_address,
      raw.email_address,
      raw.identity?.serial_number,
      raw.identity?.sn,
      raw.identity?.address,
      raw.identity?.auto_address,
      raw.identity?.email,
    ]
      .map(normalizeAddressToken)
      .filter(Boolean),
  );
};

const isOwnAddress = (addr, identity) =>
  identityAddressForms(identity).has(normalizeAddressToken(addr));

const parseEmailList = (emailValue) => {
  if (Array.isArray(emailValue)) {
    return emailValue.flatMap((entry) => parseEmailList(entry));
  }

  if (emailValue === null || emailValue === undefined) {
    return [];
  }

  const emailString = String(emailValue);
  if (emailString.trim() === "") {
    return [];
  }

  return emailString
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
};

const getEmailList = (...values) => {
  for (const value of values) {
    const parsed = parseEmailList(value);
    if (parsed.length > 0) return parsed;
  }
  return [];
};

const ComposeModal = ({
  isOpen,
  onClose,
  onSend,
  onSendFailure,
  composeContext,
  onDraftSaved
}) => {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [subsubject, setSubsubject] = useState("");
  const [body, setBody] = useState("");

  // gpt-batch3 #1: track which recipient/subsubject fields have been
  // touched (either pre-populated by the caller or typed by the user)
  // since the modal opened. handleSaveDraft only includes touched
  // fields in the updateDraft payload, so saving an existing draft
  // whose recipients we never hydrated won't clobber the backend's
  // existing recipient rows.
  const [touchedFields, setTouchedFields] = useState({
    to: false,
    cc: false,
    bcc: false,
    subsubject: false,
  });
  const markTouched = (field) =>
    setTouchedFields((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  // FIX-02 (Batch 5): staged attachments. Each entry is
  // { path, name, size } as returned by window.electronAPI.pickAttachments().
  // De-duplicated by path. Cleared when the modal opens or a send
  // completes. Empty in the browser/Vite build (no electronAPI).
  const [attachments, setAttachments] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const attachmentsSupported =
    typeof window !== "undefined" &&
    !!window.electronAPI &&
    typeof window.electronAPI.pickAttachments === "function";

  const [storageWeeks, setStorageWeeks] = useState(4);
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState("");
  const [, setDrafts] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(readStoredShowAdvanced);
  const [networkStatus, setNetworkStatus] = useState(null);
  const [canSend, setCanSend] = useState(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState(null);

  // Enhanced states for new functionality
  const [contacts, setContacts] = useState([]);
  const [contactSuggestionField, setContactSuggestionField] = useState(null);
  const [contactQuery, setContactQuery] = useState("");
  const [, setTaskId] = useState(null);
  const [sendingStatus, setSendingStatus] = useState(null); // 'sending', 'completed', 'failed'
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  // BUG-04 FIX: Cancellation ref for polling loop
  const cancelledRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  const draftSavedTimerRef = useRef(null);
  const latestSaveDraftRef = useRef(null);
  const saveDraftInFlightRef = useRef(false);
  const advancedPersistenceMountedRef = useRef(false);

  const clearAutosaveTimer = () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  const clearDraftSavedTimer = () => {
    if (draftSavedTimerRef.current) {
      clearTimeout(draftSavedTimerRef.current);
      draftSavedTimerRef.current = null;
    }
  };

  const scheduleAutosave = () => {
    clearAutosaveTimer();
    if (!isOpen || isSending || sendingStatus === "completed") return;

    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      latestSaveDraftRef.current?.({ autosave: true });
    }, AUTOSAVE_DELAY_MS);
  };

  useEffect(() => {
    cancelledRef.current = !isOpen;
    return () => { cancelledRef.current = true; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setCanSend(null);
      setNetworkStatus(null);
      // Load contacts when modal opens
      loadContacts();
      checkNetworkStatus();

      // gpt-batch3 #1: reset touchedFields per open. A field is
      // "touched" when it has a non-empty initial value (provided by
      // editDraft/replyTo) OR when the user later types into it.
      // Untouched fields are omitted from the updateDraft payload.
      const initialTouched = { to: false, cc: false, bcc: false, subsubject: false };

      const { mode, sourceEmail, ownIdentity, draftId } = composeContext || {};

      if (mode === "draft" && sourceEmail) {
        // Load draft for editing
        setCurrentDraftId(draftId || sourceEmail.id);
        const draftTo = getEmailList(
          sourceEmail.to,
          sourceEmail.To,
          sourceEmail.to_addresses,
        ).join(", ");
        const draftCc = getEmailList(
          sourceEmail.cc,
          sourceEmail.CC,
          sourceEmail.cc_addresses,
        ).join(", ");
        const draftBcc = getEmailList(
          sourceEmail.bcc,
          sourceEmail.BCC,
          sourceEmail.bcc_addresses,
        ).join(", ");
        const draftSubsubject =
          sourceEmail.subsubject || sourceEmail.sub_subject || sourceEmail.SubSubject || "";
        setTo(draftTo);
        setCc(draftCc);
        setBcc(draftBcc);
        setSubject(sourceEmail.subject || "");
        setSubsubject(draftSubsubject);
        setBody(sourceEmail.body || "");
        setStorageWeeks(sourceEmail.storageWeeks || 4);
        setSendProgress("");
        // Only mark a recipient field touched if the hydrated draft
        // actually supplied content for it. Empty fields stay
        // untouched so a body-only save doesn't clobber the
        // backend's existing recipient rows. See gpt-batch3 #1.
        initialTouched.to = draftTo.length > 0;
        initialTouched.cc = draftCc.length > 0;
        initialTouched.bcc = draftBcc.length > 0;
        initialTouched.subsubject = draftSubsubject.length > 0;
        console.log("Editing draft:", sourceEmail);
      } else if (mode === "reply" && sourceEmail) {
        // Handle reply
        const senderAddr = sourceEmail.senderEmail || sourceEmail.from || "";
        setTo(senderAddr);
        setCc("");
        setBcc("");
        // FIX-07: no double "Re: "
        const sub = sourceEmail.subject || "No Subject";
        setSubject(sub.toLowerCase().startsWith("re:") ? sub : `Re: ${sub}`);
        setSubsubject("");
        setStorageWeeks(4);
        setCurrentDraftId(null);
        // Only include the body if the email has been "downloaded".
        // sourceEmail.body can still be null/empty even when isDownloaded
        // is true (e.g. a hydrated message with no body), so coerce to ""
        // before .replace().
        if (sourceEmail.isDownloaded) {
          const originalBody = sourceEmail.body || "";
          const senderLabel =
            sourceEmail.sender || sourceEmail.senderEmail || sourceEmail.from || "Unknown";
          setBody(
            `\n\n\n--- On ${sourceEmail.timestamp || ""}, ${senderLabel} wrote: ---\n> ${originalBody.replace(/\n/g, "\n> ")}`
          );
        } else {
          setBody("\n\n\n--- Original message not downloaded ---");
        }
        initialTouched.to = Boolean(senderAddr);
      } else if (mode === "replyAll" && sourceEmail) {
        // FIX-07: Reply All logic
        const senderAddr = sourceEmail.senderEmail || sourceEmail.from || "";
        setTo(senderAddr);

        // Filter out own address from original To and CC lists
        const originalTo = getEmailList(
          sourceEmail.to,
          sourceEmail.To,
          sourceEmail.to_addresses,
        );
        const originalCc = getEmailList(
          sourceEmail.cc,
          sourceEmail.CC,
          sourceEmail.cc_addresses,
        );
        const senderToken = normalizeAddressToken(senderAddr);
        const combinedCc = [...originalTo, ...originalCc]
          .filter((addr) => {
            const token = normalizeAddressToken(addr);
            return token && token !== senderToken && !isOwnAddress(token, ownIdentity);
          });

        // De-duplicate CC list
        const uniqueCc = Array.from(
          new Map(combinedCc.map((addr) => [normalizeAddressToken(addr), addr])).values(),
        ).join(", ");

        setCc(uniqueCc);
        setBcc("");
        const sub = sourceEmail.subject || "No Subject";
        setSubject(sub.toLowerCase().startsWith("re:") ? sub : `Re: ${sub}`);
        setSubsubject("");
        setStorageWeeks(4);
        setCurrentDraftId(null);
        if (sourceEmail.isDownloaded) {
          const originalBody = sourceEmail.body || "";
          const senderLabel =
            sourceEmail.sender || sourceEmail.senderEmail || sourceEmail.from || "Unknown";
          setBody(
            `\n\n\n--- On ${sourceEmail.timestamp || ""}, ${senderLabel} wrote: ---\n> ${originalBody.replace(/\n/g, "\n> ")}`
          );
        } else {
          setBody("\n\n\n--- Original message not downloaded ---");
        }
        initialTouched.to = Boolean(senderAddr);
        initialTouched.cc = uniqueCc.length > 0;
      } else if (mode === "forward" && sourceEmail) {
        // FIX-06: Forward logic
        setTo("");
        setCc("");
        setBcc("");
        const sub = sourceEmail.subject || "No Subject";
        // No double "Fwd: "
        setSubject(sub.toLowerCase().startsWith("fwd:") ? sub : `Fwd: ${sub}`);
        setSubsubject("");
        setStorageWeeks(4);
        setCurrentDraftId(null);
        if (sourceEmail.isDownloaded) {
          const originalBody = sourceEmail.body || "";
          const senderName = sourceEmail.sender || "Unknown";
          const senderAddrForHeader =
            sourceEmail.senderEmail || sourceEmail.from || "";
          const fromLine = senderAddrForHeader
            ? `${senderName} <${senderAddrForHeader}>`
            : senderName;
          setBody(
            `\n\n\n--- Forwarded message ---\nFrom: ${fromLine}\nDate: ${sourceEmail.timestamp || ""}\nSubject: ${sourceEmail.subject || ""}\n\n${originalBody.replace(/\n/g, "\n> ")}`
          );
        } else {
          setBody("\n\n\n--- Original message not downloaded ---");
        }
      } else {
        // Reset for new message (mode === "new" or fallback)
        setTo("");
        setCc("");
        setBcc("");
        setSubject("");
        setSubsubject("");
        setBody("");
        setStorageWeeks(4);
        setCurrentDraftId(null);
        // Load drafts when opening new compose
        loadDrafts();
      }

      // Reset modal-wide UI state regardless of mode so reopening the
      // modal (e.g. new compose after a reply) doesn't leak prior
      // send-progress text.
      setSendProgress("");

      setTouchedFields(initialTouched);

      // FIX-02: clear staged attachments per modal open. Attachments
      // aren't persisted with drafts in this iteration; each compose
      // session starts with an empty staging list.
      setAttachments([]);
      setAttachError(null);

      // Reset enhanced states
      setContactSuggestionField(null);
      setContactQuery("");
      setTaskId(null);
      setSendingStatus(null);
      setProgress(0);
      setError(null);
      setIsSavingDraft(false);
      setDraftSaved(false);
    }
  }, [isOpen, composeContext]);

  useEffect(() => {
    if (!isOpen) {
      clearAutosaveTimer();
      clearDraftSavedTimer();
      setContactSuggestionField(null);
      setContactQuery("");
      setIsSavingDraft(false);
      saveDraftInFlightRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!advancedPersistenceMountedRef.current) {
      advancedPersistenceMountedRef.current = true;
      return;
    }

    try {
      window.localStorage.setItem(
        COMPOSE_ADVANCED_STORAGE_KEY,
        showAdvanced ? "true" : "false",
      );
    } catch {
      // Ignore storage failures; the toggle still works for this session.
    }
  }, [showAdvanced]);

  useEffect(() => () => {
    clearAutosaveTimer();
    clearDraftSavedTimer();
  }, []);

  const loadDrafts = async () => {
    const result = await getDrafts();
    if (result.success && result.data.drafts) {
      setDrafts(result.data.drafts);
      console.log("Drafts loaded:", result.data.drafts);
    } else {
      console.log("No drafts available or error loading drafts");
      setDrafts([]);
    }
  };

  // Load contacts for suggestions
  const loadContacts = async () => {
    try {
      const result = await getContacts();
      if (result.success) {
        setContacts(result.data.contacts || []);
        console.log("Contacts loaded:", result.data.contacts);
      } else {
        console.error("Failed to load contacts:", result.error);
        setContacts([]);
      }
    } catch (error) {
      console.error("Contact loading error:", error);
      setContacts([]);
    }
  };

  const checkNetworkStatus = async () => {
    setCanSend(null);

    try {
      const serversResult = await getServers();

      if (serversResult.success) {
        const servers = serversResult.data.servers || [];
        const availableCount =
          serversResult.data.availableServers ??
          servers.filter((server) => server.is_available).length;
        const totalCount = serversResult.data.totalServers ?? servers.length;
        const sufficientServers = availableCount >= MIN_RAIDA_FOR_SEND;

        setNetworkStatus({
          availableServers: availableCount,
          totalServers: totalCount,
          sufficient: sufficientServers,
          message: sufficientServers
            ? ""
            : `Only ${availableCount}/${totalCount} RAIDA servers are reachable. Need at least ${MIN_RAIDA_FOR_SEND} to send normally.`,
        });

        setCanSend(sufficientServers);
      } else {
        setCanSend(false);
        setNetworkStatus({
          availableServers: 0,
          totalServers: 0,
          sufficient: false,
          message:
            serversResult.error ||
            "Unable to verify RAIDA availability. Retry the check or send anyway.",
        });
      }
    } catch (error) {
      console.error("Network status check failed:", error);
      setCanSend(false);
      setNetworkStatus({
        availableServers: 0,
        totalServers: 0,
        sufficient: false,
        message:
          error.message ||
          "Unable to verify RAIDA availability. Retry the check or send anyway.",
      });
    }
  };

  // Smart draft save/update functionality
  const handleSaveDraft = async ({ autosave = false } = {}) => {
    if (
      !isOpen ||
      cancelledRef.current ||
      isSending ||
      sendingStatus === "completed" ||
      saveDraftInFlightRef.current
    ) {
      return false;
    }

    // Only save if there's some content
    if (!subject.trim() && !body.trim()) {
      return false;
    }

    if (!autosave) {
      clearAutosaveTimer();
    }

    saveDraftInFlightRef.current = true;
    setIsSavingDraft(true);
    setError(null);

    try {
      // gpt-batch3 #1: only include touched recipient/subsubject fields
      // in the update. The backend treats provided-but-empty to/cc/bcc
      // as "clear the existing rows" (api_handlers_qmail_drafts.c), so
      // a body-only edit must NOT send empty to/cc/bcc strings for a
      // draft whose recipients we never hydrated.
      //
      // Subject and body are always sent (they're the modal's
      // authoritative content). saveDraft (new-draft path) also gets
      // any touched fields; untouched recipient fields don't matter on
      // create because there's nothing to preserve.
      const draftData = { subject, body };
      if (touchedFields.to) draftData.to = to;
      if (touchedFields.cc) draftData.cc = cc;
      if (touchedFields.bcc) draftData.bcc = bcc;
      if (touchedFields.subsubject) draftData.subsubject = subsubject;

      let result;

      // If we have a draft ID, update existing draft
      if (currentDraftId) {
        result = await updateDraft(currentDraftId, draftData);
        console.log("Draft updated:", result.data);
      } else {
        // Otherwise create new draft
        result = await saveDraft(draftData);
        if (result.success && result.data.draftId && !cancelledRef.current) {
          setCurrentDraftId(result.data.draftId);
        }
        console.log("New draft saved:", result.data);
      }

      if (cancelledRef.current) {
        return false;
      }

      if (result.success) {
        setDraftSaved(true);
        clearDraftSavedTimer();
        draftSavedTimerRef.current = setTimeout(() => {
          if (!cancelledRef.current) {
            setDraftSaved(false);
          }
        }, 2000);

        // Reload drafts list in modal
        await loadDrafts();

        // IMPORTANT: Call parent to refresh main draft list
        if (onDraftSaved) {
          await onDraftSaved();
        }
        return true;
      } else {
        console.error("Failed to save/update draft:", result.error);
        setError(currentDraftId ? "Failed to update draft" : "Failed to save draft");
      }
    } catch (error) {
      console.error("Draft save/update error:", error);
      if (!cancelledRef.current) {
        setError(currentDraftId ? "Failed to update draft" : "Failed to save draft");
      }
    } finally {
      saveDraftInFlightRef.current = false;
      if (!cancelledRef.current) {
        setIsSavingDraft(false);
      }
    }

    return false;
  };

  useEffect(() => {
    latestSaveDraftRef.current = handleSaveDraft;
  });

  // gpt-batch5 #2: defensive limits tracking the backend's real
  // capacity for the comma/semicolon-joined attachment string buffer
  // (MAX_PATH_LEN * 4 = 16384 bytes) and UPLOAD_MAX_ATTACHMENTS = 245.
  // We cap WELL below both — 50 files and 12000 bytes of combined
  // path length — to leave headroom for future backend changes and
  // for the comma separators themselves. Overflow is silently dropped
  // by the backend today (no error returned), so the guard has to be
  // GUI-side.
  const MAX_ATTACHMENT_COUNT = 50;
  const MAX_ATTACHMENT_PATH_BYTES = 12000;

  // gpt-batch5 #1: the backend serializes the attachment list to a
  // comma/semicolon-joined string and then strtok_r-splits it on
  // those exact characters. Until that's fixed in the backend
  // (proposed CORE-M), paths containing comma or semicolon would be
  // silently mangled into invalid sub-paths. Reject them at staging.
  const pathHasBadDelimiter = (p) => typeof p === "string" && /[,;]/.test(p);

  // FIX-02: open the Electron file picker and merge the result into
  // the staged-attachments list.
  // - De-dupes by absolute path so re-picking the same file does
  //   nothing.
  // - gpt-batch5 #1: drops paths with ',' or ';' (backend serializer
  //   mangles them) and surfaces the rejected names so the user can
  //   rename and retry.
  // - gpt-batch5 #2: caps total count and combined path length
  //   slightly under the backend's real buffer so files can't be
  //   silently dropped at send time.
  // No-op in the browser/Vite build (button is disabled there).
  const handleAttachClick = async () => {
    if (!attachmentsSupported) return;
    setAttachError(null);
    try {
      const picked = await window.electronAPI.pickAttachments();
      if (!Array.isArray(picked) || picked.length === 0) return; // canceled

      const rejected = []; // [{ name, reason }]
      setAttachments((prev) => {
        const known = new Set(prev.map((a) => a.path));
        const out = prev.slice();
        let usedBytes = prev.reduce((sum, a) => sum + (a.path?.length || 0) + 1, 0);

        for (const entry of picked) {
          if (!entry || !entry.path) continue;
          const name = entry.name || entry.path;
          if (known.has(entry.path)) {
            // de-dup: already staged; not really a rejection,
            // skip silently as before.
            continue;
          }
          if (pathHasBadDelimiter(entry.path)) {
            rejected.push({
              name,
              reason:
                "filename contains a comma or semicolon (not yet supported)",
            });
            continue;
          }
          if (out.length >= MAX_ATTACHMENT_COUNT) {
            rejected.push({
              name,
              reason: `attachment limit (${MAX_ATTACHMENT_COUNT}) reached`,
            });
            continue;
          }
          const wouldUse = usedBytes + entry.path.length + 1;
          if (wouldUse > MAX_ATTACHMENT_PATH_BYTES) {
            rejected.push({
              name,
              reason: "combined attachment path length is too large",
            });
            continue;
          }
          out.push(entry);
          known.add(entry.path);
          usedBytes = wouldUse;
        }
        return out;
      });

      if (rejected.length > 0) {
        // Show the first reason verbatim, summarize counts if many.
        const sample = rejected[0];
        const more = rejected.length - 1;
        setAttachError(
          `Couldn't attach "${sample.name}": ${sample.reason}.` +
            (more > 0 ? ` (${more} more file${more === 1 ? "" : "s"} skipped.)` : ""),
        );
      }
    } catch (e) {
      console.warn("pickAttachments failed:", e);
      setAttachError("Could not open the file picker.");
    }
  };

  const handleRemoveAttachment = (filePath) => {
    setAttachments((prev) => prev.filter((a) => a.path !== filePath));
  };

  const formatAttachmentSize = (bytes) => {
    if (typeof bytes !== "number" || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getRecipientValue = (field) => {
    if (field === "cc") return cc;
    if (field === "bcc") return bcc;
    return to;
  };

  const setRecipientValue = (field, value) => {
    if (field === "cc") {
      setCc(value);
    } else if (field === "bcc") {
      setBcc(value);
    } else {
      setTo(value);
    }
  };

  const getContactAddress = (contact) =>
    contact.autoAddress || contact.email || contact.fullName || "";

  const getRecipientSearchToken = (value) => {
    const tokens = String(value || "").split(",");
    return tokens[tokens.length - 1].trim();
  };

  const mergeContactAddress = (value, address, replaceLastToken) => {
    const currentValue = String(value || "");
    const tokens = currentValue.split(",");
    const isAppendingAfterComma = /,\s*$/.test(currentValue);

    if (currentValue.trim() && (!replaceLastToken || isAppendingAfterComma)) {
      tokens.push(address);
    } else if (tokens.length > 1 || tokens[0].trim()) {
      tokens[tokens.length - 1] = address;
    } else {
      tokens[0] = address;
    }

    return tokens
      .map((token) => token.trim())
      .filter(Boolean)
      .join(", ");
  };

  const handleRecipientChange = (field, value) => {
    setRecipientValue(field, value);
    markTouched(field);
    scheduleAutosave();

    const query = getRecipientSearchToken(value);
    setContactQuery(query);
    setContactSuggestionField(
      query.length > 1 && contacts.length > 0 ? field : null,
    );
  };

  const handleContactSelect = (field, contact) => {
    const address = getContactAddress(contact);
    if (!address) return;

    setRecipientValue(
      field,
      mergeContactAddress(
        getRecipientValue(field),
        address,
        contactQuery.trim().length > 0,
      ),
    );
    markTouched(field);
    scheduleAutosave();
    setContactSuggestionField(null);
    setContactQuery("");
  };

  const toggleContactSuggestions = (field) => {
    if (contactSuggestionField === field) {
      setContactSuggestionField(null);
      setContactQuery("");
      return;
    }

    setContactQuery("");
    setContactSuggestionField(contacts.length > 0 ? field : null);
  };

  // Filter contacts for suggestions
  const filteredContacts = contacts.filter((contact) => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return true;

    const fullName = contact.fullName || "";
    const address = getContactAddress(contact);
    return (
      fullName.toLowerCase().includes(query) ||
      address.toLowerCase().includes(query)
    );
  });

  if (!isOpen) {
    return null;
  }

  const handleSend = async () => {
    // Validation
    if (!to.trim()) {
      setError("Please enter a recipient address");
      return;
    }
    const toList = parseEmailList(to);
    const ccList = parseEmailList(cc);
    const bccList = parseEmailList(bcc);

    if (toList.length === 0) {
      setError("Please provide at least one valid recipient address.");
      return;
    }
    if (!subject.trim()) {
      setError("Please enter a subject");
      return;
    }
    if (!body.trim()) {
      setError("Please enter a message");
      return;
    }

    clearAutosaveTimer();
    setIsSending(true);
    setSendingStatus("sending");
    setSendProgress("Preparing email...");
    setError(null);

    const markSendFailed = (message) => {
      const failureMessage = message || "Failed to send email";
      setSendingStatus("failed");
      setError(failureMessage);
      setSendProgress(failureMessage);
      setIsSending(false);
      setTaskId(null);
      if (onSendFailure) {
        onSendFailure(failureMessage);
      }
    };

    try {
      const emailData = {
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: subject.trim(),
        body: body.trim(),
        subsubject: subsubject.trim(),
        // FIX-02: pass the staged file paths. sendEmail() in
        // qmailApiServices.js already iterates this array and
        // appends one attachment_file_path query param per entry.
        attachments: attachments.map((a) => a.path),
        storage_weeks: storageWeeks || 0
      };

      const result = await sendEmail(emailData);

      if (result.success && result.data.taskId) {
        const currentTaskId = result.data.taskId;
        setTaskId(currentTaskId);
        const deadline = Date.now() + SEND_POLL_TIMEOUT_MS;
        let consecutivePollFailures = 0;
        let taskFinished = false;

        while (
          !taskFinished &&
          !cancelledRef.current &&
          Date.now() < deadline
        ) {
          // Wait 1 second before checking status
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (cancelledRef.current) break;

          let taskResult;
          try {
            taskResult = await getTaskStatus(currentTaskId);
          } catch (pollError) {
            taskResult = {
              success: false,
              error: pollError.message || "Failed to track email status",
            };
          }

          if (taskResult.success) {
            consecutivePollFailures = 0;
            const { state, progress: currentProgress, message, isFinished, isSuccessful, error: taskError } = taskResult.data;
            
            setProgress(currentProgress || 0);
            setSendProgress(message || "Processing...");
            
            if (isFinished) {
              taskFinished = true; // Break the loop
              
              if (isSuccessful || state === "completed") {
                setSendingStatus("completed");
                setSendProgress("Email sent successfully!");
                setTimeout(() => {
                  if (cancelledRef.current) return;
                  onSend(emailData);
                  setIsSending(false);
                  setSendingStatus(null);
                  setSendProgress("");
                  setTaskId(null);
                }, 1500);
              } else {
                markSendFailed(taskError || message || "Failed to send email");
              }
            }
          } else {
            consecutivePollFailures += 1;
            setSendProgress(
              `Still sending... retrying status check (${consecutivePollFailures}/${MAX_SEND_POLL_FAILURES})`,
            );

            if (consecutivePollFailures >= MAX_SEND_POLL_FAILURES) {
              taskFinished = true;
              markSendFailed(taskResult.error || "Failed to track email status");
            }
          }
        }

        if (!taskFinished && !cancelledRef.current) {
          markSendFailed(
            "Send is taking longer than expected. Check Sent in a few minutes.",
          );
        }
      } else if (result.success) {
        // Fallback if no taskId is provided but success is true
        setSendingStatus("completed");
        setSendProgress("Email sent successfully!");
        setTimeout(() => {
          if (cancelledRef.current) return;
          onSend(emailData);
          setIsSending(false);
          setSendingStatus(null);
          setSendProgress("");
        }, 1500);
      } else {
        throw new Error(result.error || "Failed to send email");
      }
    } catch (error) {
      console.error("Send error:", error);
      markSendFailed(error.message || "Failed to send email");
    }
  };
  
  // Enhanced progress indicator
  const renderProgressIndicator = () => {
    if (!isSending && !sendProgress) return null;

    const getIcon = () => {
      switch (sendingStatus) {
        case "sending":
          return <Loader size={16} className="compose-modal__status-icon spinning" />;
        case "completed":
          return (
            <CheckCircle
              size={16}
              className="compose-modal__status-icon compose-modal__status-icon--success"
            />
          );
        case "failed":
          return (
            <AlertCircle
              size={16}
              className="compose-modal__status-icon compose-modal__status-icon--error"
            />
          );
        default:
          return <Loader size={16} className="compose-modal__status-icon spinning" />;
      }
    };

    return (
      <div className="compose-modal__send-progress">
        {getIcon()}
        <span>{sendProgress}</span>
        {progress > 0 && progress < 100 && (
          <span>({Math.round(progress)}%)</span>
        )}
      </div>
    );
  };

  const sendControlsLocked = isSending || sendingStatus === "completed";

  const renderContactSuggestions = (field) => {
    if (contactSuggestionField !== field || filteredContacts.length === 0) {
      return null;
    }

    return (
      <div className="compose-modal__contact-suggestions">
        {filteredContacts.slice(0, 5).map((contact, index) => {
          const address = getContactAddress(contact);
          return (
            <button
              type="button"
              key={contact.userId || `${field}-${index}`}
              className="compose-modal__contact-suggestion"
              onClick={() => handleContactSelect(field, contact)}
            >
              <div className="compose-modal__contact-name">
                {contact.fullName || address || "Unknown Contact"}
              </div>
              {address && <div className="compose-modal__contact-address">{address}</div>}
            </button>
          );
        })}
      </div>
    );
  };

  const renderRecipientField = ({ field, label, value, placeholder }) => (
    <div className="compose-modal__field compose-modal__field--recipient">
      <div className="compose-modal__recipient-row">
        <label htmlFor={field}>{label}</label>
        <div className="compose-modal__recipient-input">
          <input
            type="text"
            id={field}
            value={value}
            onChange={(e) => handleRecipientChange(field, e.target.value)}
            disabled={isSending}
            placeholder={placeholder}
          />
          <button
            type="button"
            className="compose-modal__add-contacts-button"
            onClick={() => toggleContactSuggestions(field)}
            disabled={isSending || contacts.length === 0}
            title="Show contacts"
            aria-label={`Show contacts for ${label.replace(":", "")}`}
          >
            <Users size={16} />
          </button>
          {renderContactSuggestions(field)}
        </div>
      </div>
    </div>
  );

  return (
    <div className="compose-modal__overlay">
      <section
        className="compose-modal glass-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-modal-title"
      >
        <header className="compose-modal__header">
          <h3 id="compose-modal-title" className="compose-modal__title">
            {(() => {
              const mode = composeContext?.mode;
              if (mode === "draft") return "Edit Draft";
              if (mode === "reply") return "Reply";
              if (mode === "replyAll") return "Reply All";
              if (mode === "forward") return "Forward";
              return "Compose Email";
            })()}
          </h3>
          <button
            type="button"
            className="compose-modal__close-button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="compose-modal__body">
          {/* Error Message */}
          {error && (
            <div className="compose-modal__error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Network Status Warning */}
          {networkStatus && canSend !== true && (
            <div className="compose-modal__network-warning" role="status">
              <AlertCircle size={16} />
              <div className="compose-modal__network-warning-copy">
                <strong>RAIDA network warning</strong>
                <span>{networkStatus.message}</span>
              </div>
              <button
                type="button"
                className="compose-modal__network-retry-button"
                onClick={checkNetworkStatus}
                disabled={isSending || canSend === null}
              >
                <RefreshCw
                  size={14}
                  className={canSend === null ? "spinning" : ""}
                />
                Retry
              </button>
            </div>
          )}

          {renderRecipientField({
            field: "to",
            label: "To:",
            value: to,
            placeholder: "write address here",
          })}

          {/* Advanced options toggle */}
          <div className="compose-modal__advanced-toggle">
            <button
              type="button"
              className="compose-modal__advanced-toggle-button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              disabled={isSending}
            >
              {showAdvanced ? "▼" : "▶"} Advanced Options
            </button>
          </div>

          {/* Advanced fields */}
          {showAdvanced && (
            <>
              {renderRecipientField({
                field: "cc",
                label: "CC:",
                value: cc,
                placeholder: "0006.1.87654321 (separate multiple with commas)",
              })}
              {renderRecipientField({
                field: "bcc",
                label: "BCC:",
                value: bcc,
                placeholder: "0006.1.11223344 (separate multiple with commas)",
              })}
              <div className="compose-modal__field">
                <label htmlFor="subsubject">Sub-Subject:</label>
                <input
                  type="text"
                  id="subsubject"
                  value={subsubject}
                  onChange={(e) => {
                    setSubsubject(e.target.value);
                    markTouched("subsubject");
                    scheduleAutosave();
                  }}
                  disabled={isSending}
                  placeholder="Secondary subject header (optional)"
                />
              </div>
              <div className="compose-modal__field">
                <label htmlFor="storageWeeks">Storage Duration (weeks):</label>
                <input
                  type="number"
                  id="storageWeeks"
                  min="1"
                  max="52"
                  value={storageWeeks}
                  onChange={(e) =>
                    setStorageWeeks(parseInt(e.target.value) || 4)
                  }
                  disabled={isSending}
                />
              </div>
            </>
          )}

          <div className="compose-modal__field">
            <label htmlFor="subject">Subject: </label>
            <input
              type="text"
              id="subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                scheduleAutosave();
              }}
              disabled={isSending}
              placeholder="Email subject"
            />
          </div>
          <div className="compose-modal__field compose-modal__field--message">
            <label htmlFor="body">Message: </label>
            <textarea
              id="body"
              placeholder="Write your message..."
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                scheduleAutosave();
              }}
              disabled={isSending}
              rows={12}
            />
          </div>

          {/* FIX-02 (Batch 5): attachment staging area.
              - Button opens Electron's native file picker
                (window.electronAPI.pickAttachments).
              - Picked files render as removable chips with size.
              - In a browser/Vite build (no electronAPI), the button
                renders disabled with an explanatory tooltip. */}
          <div className="compose-modal__attachments">
            <button
              type="button"
              className="compose-modal__attach-files-button"
              onClick={handleAttachClick}
              disabled={isSending || !attachmentsSupported}
              title={
                attachmentsSupported
                  ? "Attach files to this message"
                  : "File attachments require the desktop build"
              }
            >
              <Paperclip size={14} />
              {attachments.length === 0
                ? "Attach files"
                : `Attach files (${attachments.length} attached)`}
            </button>

            {attachError && (
              <span className="compose-modal__attach-error">
                {attachError}
              </span>
            )}

            {attachments.length > 0 && (
              <ul className="compose-modal__attachment-chips">
                {attachments.map((a) => (
                  <li
                    key={a.path}
                    className="compose-modal__attachment-chip"
                    title={a.path}
                  >
                    <Paperclip size={12} />
                    <span className="compose-modal__attachment-name">
                      {a.name}
                    </span>
                    <span className="compose-modal__attachment-size">
                      {formatAttachmentSize(a.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(a.path)}
                      disabled={isSending}
                      title="Remove attachment"
                      aria-label={`Remove ${a.name}`}
                      className="compose-modal__attachment-remove"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Enhanced Progress indicator */}
          {renderProgressIndicator()}

          {/* gpt-batch5 #3: attachments aren't persisted with drafts
              (backend ticket CORE-N). Without this warning, a user
              who attached files and clicked Save Draft would expect
              them to be preserved when reopened — they aren't.
              Make the trade-off visible so they can decide whether
              to send now or remove the attachments before saving. */}
          {attachments.length > 0 && (
            <div role="note" className="compose-modal__attachment-note">
              <AlertCircle size={14} className="compose-modal__attachment-note-icon" />
              <span>
                Attachments are sent with this message but are <strong>not saved</strong>{" "}
                with a draft. Save the draft first, then re-attach files when you&apos;re
                ready to send.
              </span>
            </div>
          )}
        </div>
        <footer className="compose-modal__footer">
          <button
            type="button"
            className="compose-modal__send-button"
            onClick={handleSend}
            disabled={sendControlsLocked || canSend === null}
            title={
              canSend === null
                ? "Checking RAIDA network status"
                : canSend === false
                  ? "Send anyway; the backend will make the final network decision"
                  : "Send email"
            }
          >
            {sendingStatus === "sending" ? (
              <>
                <Loader size={16} className="spinning" />
                Sending...
              </>
            ) : sendingStatus === "completed" ? (
              <>
                <CheckCircle size={16} />
                Sent!
              </>
            ) : canSend === null ? (
              <>
                <Loader size={16} className="spinning" />
                Checking network...
              </>
            ) : canSend === false ? (
              <>
                <Send size={16} />
                Send anyway
              </>
            ) : (
              <>
                <Send size={16} />
                Send
              </>
            )}
          </button>

          <button
            type="button"
            className="compose-modal__draft-button"
            onClick={() => handleSaveDraft()}
            disabled={
              sendControlsLocked ||
              isSavingDraft ||
              (!subject.trim() && !body.trim())
            }
            title="Save as draft"
          >
            {isSavingDraft ? (
              <>
                <Loader size={16} className="spinning" />
                Saving...
              </>
            ) : draftSaved ? (
              <>
                <CheckCircle size={16} />
                Saved
              </>
            ) : (
              <>Save Draft</>
            )}
          </button>
        </footer>
      </section>
    </div>
  );
};

export default ComposeModal;
