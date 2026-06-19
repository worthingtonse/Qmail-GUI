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
  getQMailCanSend,
  getTaskStatus,
  getObjectTransferStatus,
  cancelObjectTransfer,
  resumeObjectTransfer,
  getContacts,
  getPopularContacts,
  getServers,
  saveDraft,
  updateDraft,
  addContact,
} from "../../api/qmailApiServices";
import { parseQmailAddress } from "../address/qmailAddress";
import { findUnknownRecipients } from "../address/newRecipients";
import {
  deriveUploadByteProgress,
  extractTransferOperationIds,
  extractTransferState,
  formatByteProgress,
  formatProgressPercentage,
} from "../transferProgress";
import { normalizeTransferError } from "../transferErrors";
import {
  forgetActiveTransfer,
  rememberActiveTransfer,
} from "../activeTransferRegistry";

const MIN_RAIDA_FOR_SEND = 6;
const SEND_POLL_TIMEOUT_MS = 60000;
const MAX_SEND_POLL_FAILURES = 3;
const utf8ByteLength = (value) =>
  new TextEncoder().encode(String(value || "")).length;
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

// Client-side mirror of the backend's qmail_address_validate() rules so the
// user gets immediate feedback before a network round-trip. Valid forms are
// dotted decimal: "0.51.254.0", "51.254.0" or "51.254@bit" (see
// src/qmail/address/qmailAddress.js — same rules and error strings as the
// backend, which remains the authoritative validator).
const validateQmailAddress = (address) => {
  const result = parseQmailAddress(address);
  return result.ok ? null : result.error;
};

// Validate a parsed list of addresses; returns a user-facing message for the
// first invalid one, or null when all are valid.
const findInvalidRecipient = (list, fieldLabel) => {
  for (const addr of list) {
    const reason = validateQmailAddress(addr);
    if (reason) return `Invalid ${fieldLabel} address "${addr}": ${reason}`;
  }
  return null;
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
  // Most-likely recipients from /qmail/db/contacts/list-popular — already
  // ranked by (is_favorite, send_count, last_sent_at) on the backend. Shown
  // as the dropdown when the user opens the "Show contacts" panel with an
  // empty query, and used to bias the substring filter when typing.
  const [popularContacts, setPopularContacts] = useState([]);
  const [contactSuggestionField, setContactSuggestionField] = useState(null);
  const [contactQuery, setContactQuery] = useState("");
  const [, setTaskId] = useState(null);
  const [sendingStatus, setSendingStatus] = useState(null); // 'sending', 'completed', 'failed'
  const [progress, setProgress] = useState(0);
  const [uploadByteProgress, setUploadByteProgress] = useState(null);
  const [transferOperationIds, setTransferOperationIds] = useState([]);
  const [transferState, setTransferState] = useState("");
  const [transferControlPending, setTransferControlPending] = useState("");
  const [transferFailure, setTransferFailure] = useState(null);
  const [error, setError] = useState(null);
  // Invalid recipient-address modal: { message } when an address fails
  // format validation on send. Unlike the inline `error` banner, this
  // opens a dialog that also explains what a valid address looks like.
  const [invalidAddress, setInvalidAddress] = useState(null);
  // "Save this recipient as a contact?" prompt shown after a successful
  // send to addresses the user typed by hand that aren't known contacts.
  // { addresses: [string], index, firstName, lastName, saving }.
  const [newRecipientPrompt, setNewRecipientPrompt] = useState(null);

  // BUG-04 FIX: Cancellation ref for polling loop
  const cancelledRef = useRef(false);
  // Recipient addresses typed this send that aren't known contacts — set in
  // handleSend, consumed on send success to offer saving them as contacts.
  const unknownRecipientsRef = useRef([]);
  const uploadCancellationRequestedRef = useRef(false);
  const transferOperationIdsRef = useRef([]);
  const autosaveTimerRef = useRef(null);
  const draftSavedTimerRef = useRef(null);
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
    // Drafts are explicit-only: typing in compose must not create or update one.
    clearAutosaveTimer();
  };

  useEffect(() => {
    cancelledRef.current = !isOpen;
    return () => { cancelledRef.current = true; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setCanSend(null);
      setNetworkStatus(null);
      setInvalidAddress(null);
      setNewRecipientPrompt(null);
      unknownRecipientsRef.current = [];
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
        // Per user request: a Reply does NOT quote the original message.
        // The composer starts with an empty body so the user types only
        // their own response. Forwarding still includes the original
        // (see "forward" branch below).
        setBody("");
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
        // Per user request: Reply All does NOT quote the original message.
        setBody("");
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
      setUploadByteProgress(null);
      setTransferOperationIds([]);
      transferOperationIdsRef.current = [];
      setTransferState("");
      setTransferControlPending("");
      setTransferFailure(null);
      uploadCancellationRequestedRef.current = false;
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

  // Load contacts for suggestions, plus the popularity-ranked subset so the
  // dropdown can show "most likely recipients" before the user types and
  // bias substring matches by send_count once they do.
  const loadContacts = async () => {
    try {
      const [allResult, popularResult] = await Promise.all([
        getContacts(),
        getPopularContacts(20),
      ]);

      if (allResult.success) {
        setContacts(allResult.data.contacts || []);
      } else {
        console.error("Failed to load contacts:", allResult.error);
        setContacts([]);
      }

      if (popularResult.success) {
        setPopularContacts(popularResult.data.contacts || []);
      } else {
        // Popular endpoint is non-critical — substring filter still works.
        setPopularContacts([]);
      }
    } catch (error) {
      console.error("Contact loading error:", error);
      setContacts([]);
      setPopularContacts([]);
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
        let usedBytes = prev.reduce(
          (sum, a) => sum + utf8ByteLength(a.path) + 1,
          0,
        );

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
          const wouldUse = usedBytes + utf8ByteLength(entry.path) + 1;
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

  const contactText = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  };

  const getContactAddress = (contact) =>
    contactText(contact?.autoAddress, contact?.email, contact?.address, contact?.fullName);

  const getContactName = (contact) =>
    contactText(
      contact?.fullName,
      [contact?.firstName, contact?.middleName, contact?.lastName]
        .map((part) => contactText(part))
        .filter(Boolean)
        .join(" "),
      contact?.denomination,
      contact?.userId ? `User ${contact.userId}` : "",
      "Unknown Contact",
    );

  // Typed To: addresses that aren't known contacts (offered for saving
  // after a successful send). Pure logic lives in ../address/newRecipients.
  const collectUnknownRecipients = (toList) =>
    findUnknownRecipients(toList, contacts, getContactAddress);

  const getRecipientSearchToken = (value) => {
    const tokens = String(value || "").split(",");
    return tokens[tokens.length - 1].trim();
  };

  const normalizePastedRecipientText = (value) =>
    String(value || "")
      .replace(/[\r\n\t]+/g, ", ")
      .replace(/\s*,\s*/g, ", ")
      .trim();

  const handleRecipientPaste = (event, field, currentValue) => {
    const pastedText = event.clipboardData?.getData("text/plain");
    if (!pastedText) return;

    event.preventDefault();

    const input = event.currentTarget;
    const value = String(currentValue || "");
    const start =
      typeof input.selectionStart === "number" ? input.selectionStart : value.length;
    const end =
      typeof input.selectionEnd === "number" ? input.selectionEnd : start;
    const nextValue =
      value.slice(0, start) +
      normalizePastedRecipientText(pastedText) +
      value.slice(end);

    handleRecipientChange(field, nextValue);
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
    // Open suggestions on the FIRST typed character (not the second), and
    // keep them open on an empty query when the popular list has rows so
    // clearing back to empty still surfaces likely recipients.
    const haveTypedMatchSource = query.length >= 1 && contacts.length > 0;
    const haveEmptyPopular = query.length === 0 && popularContacts.length > 0;
    setContactSuggestionField(
      haveTypedMatchSource || haveEmptyPopular ? field : null,
    );
  };

  // Open the suggestion panel when a recipient field is focused with an
  // empty token, so the user immediately sees the most-likely recipients
  // without needing to click the "Show contacts" button. Non-empty fields
  // are left alone — those rely on handleRecipientChange.
  const handleRecipientFocus = (field, value) => {
    if (isSending) return;
    const query = getRecipientSearchToken(value);
    if (query.length === 0 && popularContacts.length > 0) {
      setContactQuery("");
      setContactSuggestionField(field);
    }
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

  // ---- first-time-recipient "save as contact?" prompt -------------------

  // Close the prompt and complete the send (close the compose modal). Used
  // by Skip and by Save once the contact is stored, and after the last
  // recipient in a multi-recipient prompt is handled.
  const dismissNewRecipientPrompt = (prompt) => {
    const emailData = prompt?.emailData;
    setNewRecipientPrompt(null);
    unknownRecipientsRef.current = [];
    if (emailData) onSend(emailData);
  };

  const handleSaveNewRecipient = async () => {
    if (!newRecipientPrompt || newRecipientPrompt.saving) return;
    const current = newRecipientPrompt.addresses[newRecipientPrompt.index];
    const firstName = newRecipientPrompt.firstName.trim();
    const lastName = newRecipientPrompt.lastName.trim();

    if (!firstName && !lastName) {
      // Nothing to save — treat as skip for this recipient.
      advanceNewRecipientPrompt();
      return;
    }

    setNewRecipientPrompt((prev) => ({ ...prev, saving: true }));
    try {
      await addContact({
        serial_number: String(current.serialNumber),
        denomination: String(current.denominationCode),
        class_name: current.denominationName,
        first_name: firstName,
        last_name: lastName,
      });
      // Refresh the local contact list so the new name shows immediately
      // and a repeat send to the same address won't re-prompt.
      await loadContacts();
    } catch (error) {
      console.error("Failed to save new contact:", error);
    }
    advanceNewRecipientPrompt();
  };

  // Move to the next unknown recipient, or finish if this was the last one.
  const advanceNewRecipientPrompt = () => {
    setNewRecipientPrompt((prev) => {
      if (!prev) return null;
      const nextIndex = prev.index + 1;
      if (nextIndex >= prev.addresses.length) {
        const emailData = prev.emailData;
        unknownRecipientsRef.current = [];
        if (emailData) onSend(emailData);
        return null;
      }
      return { ...prev, index: nextIndex, firstName: "", lastName: "", saving: false };
    });
  };

  const toggleContactSuggestions = (field) => {
    if (contactSuggestionField === field) {
      setContactSuggestionField(null);
      setContactQuery("");
      return;
    }

    setContactQuery("");
    setContactSuggestionField(
      contacts.length > 0 || popularContacts.length > 0 ? field : null,
    );
  };

  // Popularity lookup keyed by userId so the typed-substring sort can pull
  // ranking signals onto entries from the broader `contacts` list (which
  // doesn't carry send_count itself).
  const popularityByUserId = new Map(
    popularContacts.filter(Boolean).map((c) => [
      String(c.userId),
      {
        popularity: Number(c.popularity) || 0,
        lastSentAt: Number(c.daysSinceLastContact) >= 0
          ? -Number(c.daysSinceLastContact) // recent = larger
          : Number.NEGATIVE_INFINITY,
        isFavorite: Boolean(c.isFavorite),
      },
    ]),
  );

  // Filter + rank contacts for suggestions.
  //   - empty query: show the popular-contacts list as-is (already ranked
  //     by the backend); fall back to the full list if popularity hasn't
  //     loaded yet.
  //   - non-empty query: substring-filter the full list, then sort by
  //     (favorite, popularity, recency) so the most-likely match surfaces.
  const filteredContacts = (() => {
    const query = String(contactQuery || "").trim().toLowerCase();
    if (!query) {
      return (popularContacts.length > 0 ? popularContacts : contacts).filter(Boolean);
    }

    const matches = contacts.filter(Boolean).filter((contact) => {
      const fullName = getContactName(contact);
      const address = getContactAddress(contact);
      return (
        fullName.toLowerCase().includes(query) ||
        address.toLowerCase().includes(query)
      );
    });

    return matches.slice().sort((a, b) => {
      const aRank = popularityByUserId.get(String(a.userId)) || {
        popularity: 0,
        lastSentAt: Number.NEGATIVE_INFINITY,
        isFavorite: false,
      };
      const bRank = popularityByUserId.get(String(b.userId)) || {
        popularity: 0,
        lastSentAt: Number.NEGATIVE_INFINITY,
        isFavorite: false,
      };
      if (aRank.isFavorite !== bRank.isFavorite) {
        return aRank.isFavorite ? -1 : 1;
      }
      if (bRank.popularity !== aRank.popularity) {
        return bRank.popularity - aRank.popularity;
      }
      return bRank.lastSentAt - aRank.lastSentAt;
    });
  })();

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

    // Validate every recipient address format before sending so the user
    // gets immediate, specific feedback (the backend also enforces this).
    // Format problems open an explanatory modal rather than the inline
    // error banner, so the user sees what a valid address looks like.
    const addressError =
      findInvalidRecipient(toList, "To") ||
      findInvalidRecipient(ccList, "Cc") ||
      findInvalidRecipient(bccList, "Bcc");
    if (addressError) {
      setInvalidAddress({ message: addressError });
      return;
    }

    // Remember which To: addresses aren't known contacts, so we can offer
    // to save them once the send succeeds. Cc/Bcc are excluded — the prompt
    // is about people you're actually addressing.
    unknownRecipientsRef.current = collectUnknownRecipients(toList);

    if (!subject.trim()) {
      setError("Please enter a subject");
      return;
    }
    if (!body.trim()) {
      setError("Please enter a message");
      return;
    }

    if (attachments.length > 0) {
      if (typeof window.electronAPI?.statAttachments !== "function") {
        setAttachError("Attachments can only be verified by the desktop app.");
        return;
      }
      let currentFiles;
      try {
        currentFiles = await window.electronAPI.statAttachments(
          attachments.map((attachment) => attachment.path),
        );
      } catch {
        setAttachError("Could not verify the selected attachments.");
        return;
      }
      if (!Array.isArray(currentFiles)) {
        setAttachError("Could not verify the selected attachments.");
        return;
      }
      const currentByPath = new Map(
        currentFiles.map((entry) => [entry.path, entry]),
      );
      const changed = attachments.some((attachment) => {
        const current = currentByPath.get(attachment.path);
        return !current?.success || Number(current.size) !== Number(attachment.size);
      });
      if (changed) {
        setAttachments((currentAttachments) =>
          currentAttachments.map((attachment) => {
            const current = currentByPath.get(attachment.path);
            return current?.success ? { ...attachment, ...current } : attachment;
          }),
        );
        setAttachError(
          "An attachment was removed or changed after selection. Review the attachment list and send again.",
        );
        return;
      }
    }

    const fundingCheck = await getQMailCanSend({
      to: toList,
      cc: ccList,
      bcc: bccList,
    });
    if (!fundingCheck.success) {
      setError(
        fundingCheck.error || "Could not check whether QMail can send right now.",
      );
      return;
    }
    if (!fundingCheck.data.canSend) {
      setError(
        fundingCheck.data.message ||
          "Add funds to your Default wallet before sending mail.",
      );
      return;
    }

    clearAutosaveTimer();
    setIsSending(true);
    setSendingStatus("sending");
    setSendProgress("Preparing qmail...");
    setTransferOperationIds([]);
    transferOperationIdsRef.current = [];
    setTransferState("");
    setTransferControlPending("");
    setTransferFailure(null);
    uploadCancellationRequestedRef.current = false;
    const attachmentTotalBytes = attachments.reduce(
      (total, attachment) =>
        total +
        (Number.isFinite(Number(attachment.size))
          ? Math.max(0, Math.trunc(Number(attachment.size)))
          : 0),
      0,
    );
    setUploadByteProgress(
      attachmentTotalBytes > 0
        ? {
            completedBytes: "0",
            totalBytes: String(attachmentTotalBytes),
            percentage: 0,
            estimated: true,
          }
        : null,
    );
    setError(null);
    const knownOperationIds = new Set();
    const uploadLabel =
      attachments.length === 1
        ? attachments[0].name || "Qmail attachment"
        : attachments.length > 1
          ? `${attachments.length} qmail attachments`
          : subject.trim() || "Qmail send";
    const rememberUploadOperations = (
      operationIds,
      state,
      currentTaskId = null,
      errorMessage = null,
    ) => {
      operationIds.forEach((operationId) => {
        knownOperationIds.add(operationId);
        rememberActiveTransfer({
          operationId,
          direction: "upload",
          taskId: currentTaskId,
          label: uploadLabel,
          totalBytes: String(attachmentTotalBytes),
          state,
          error: errorMessage,
        });
      });
      transferOperationIdsRef.current = [
        ...new Set([...transferOperationIdsRef.current, ...operationIds]),
      ];
    };

    const markSendFailed = (message, source = null) => {
      const normalizedFailure =
        source?.transferError ||
        normalizeTransferError(source || {
          state: "failed",
          error: message,
        }, {
          fallbackMessage: message || "Failed to send qmail",
          terminal: true,
        });
      const failureMessage =
        normalizedFailure?.message || message || "Failed to send qmail";
      rememberUploadOperations(
        [...knownOperationIds],
        "failed",
        null,
        failureMessage,
      );
      setSendingStatus("failed");
      setTransferFailure(normalizedFailure);
      setError(failureMessage);
      setSendProgress(failureMessage);
      setIsSending(false);
      setTaskId(null);
      if (onSendFailure) {
        onSendFailure(failureMessage);
      }
    };

    const markSendCancelled = () => {
      rememberUploadOperations(
        [...knownOperationIds],
        "cancelled",
        null,
        "Upload cancelled.",
      );
      setSendingStatus("cancelled");
      setTransferState("cancelled");
      setTransferFailure(
        normalizeTransferError({
          state: "cancelled",
          error: "Upload cancelled.",
        }),
      );
      setSendProgress("Upload cancelled.");
      setIsSending(false);
      setTaskId(null);
    };

    // Finish a successful send. If the user typed any To: addresses that
    // aren't known contacts, open the "save as contact?" prompt and defer
    // the modal close until they answer; otherwise close normally.
    const finishSend = (emailData) => {
      setIsSending(false);
      setSendingStatus(null);
      setSendProgress("");
      setTaskId(null);

      const unknown = unknownRecipientsRef.current;
      if (unknown.length > 0) {
        setNewRecipientPrompt({
          addresses: unknown,
          index: 0,
          firstName: "",
          lastName: "",
          saving: false,
          emailData,
        });
        return;
      }
      onSend(emailData);
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
      const initialOperationIds = extractTransferOperationIds(result.data);
      const initialTransferState = extractTransferState(result.data);
      rememberUploadOperations(
        initialOperationIds,
        initialTransferState || "queued",
        result.data?.taskId || null,
      );
      if (initialOperationIds.length > 0) {
        setTransferOperationIds(initialOperationIds);
        transferOperationIdsRef.current = initialOperationIds;
      }
      if (initialTransferState) {
        setTransferState(initialTransferState);
      }

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
              error: pollError.message || "Failed to track qmail status",
            };
          }

          if (taskResult.success) {
            consecutivePollFailures = 0;
            const { state, progress: currentProgress, message, isFinished, isSuccessful, error: taskError } = taskResult.data;
            const discoveredOperationIds =
              extractTransferOperationIds(taskResult.data);
            const observedTransferState =
              extractTransferState(taskResult.data);

            if (discoveredOperationIds.length > 0) {
              rememberUploadOperations(
                discoveredOperationIds,
                observedTransferState || state || "running",
                currentTaskId,
                taskResult.data.error,
              );
              setTransferOperationIds((current) => [
                ...new Set([...current, ...discoveredOperationIds]),
              ]);
              transferOperationIdsRef.current = [
                ...new Set([
                  ...transferOperationIdsRef.current,
                  ...discoveredOperationIds,
                ]),
              ];
            }
            if (observedTransferState) {
              setTransferState(observedTransferState);
              if (observedTransferState === "paused") {
                const pausedFailure =
                  taskResult.data.transferError ||
                  normalizeTransferError({
                    ...taskResult.data.result,
                    state: "paused",
                    error: taskResult.data.error || message,
                  });
                setTransferFailure(pausedFailure);
                setSendingStatus("paused");
                setSendProgress(
                  pausedFailure?.message ||
                    taskResult.data.error ||
                    message ||
                    "Upload paused. Resume when the connection is available.",
                );
              } else if (
                observedTransferState === "cancelled" ||
                observedTransferState === "cancelling"
              ) {
                setSendingStatus(observedTransferState);
              } else {
                setTransferFailure(null);
                setSendingStatus("sending");
              }
            }
            
            setProgress(currentProgress || 0);
            if (observedTransferState !== "paused") {
              setSendProgress(message || "Processing...");
            }
            setUploadByteProgress(
              deriveUploadByteProgress(
                taskResult.data,
                attachmentTotalBytes,
              ),
            );
            
            if (isFinished) {
              taskFinished = true; // Break the loop
              
              if (isSuccessful || state === "completed") {
                knownOperationIds.forEach((operationId) =>
                  forgetActiveTransfer(operationId),
                );
                setSendingStatus("completed");
                setTransferFailure(null);
                setSendProgress("Qmail sent successfully!");
                setUploadByteProgress(
                  deriveUploadByteProgress(
                    { ...taskResult.data, isSuccessful: true },
                    attachmentTotalBytes,
                  ),
                );
                setTimeout(() => {
                  if (cancelledRef.current) return;
                  finishSend(emailData);
                }, 1500);
              } else if (
                uploadCancellationRequestedRef.current ||
                observedTransferState === "cancelled"
              ) {
                markSendCancelled();
              } else {
                markSendFailed(
                  taskError || message || "Failed to send qmail",
                  taskResult.data,
                );
              }
            }
          } else {
            consecutivePollFailures += 1;
            setSendProgress(
              `Still sending... retrying status check (${consecutivePollFailures}/${MAX_SEND_POLL_FAILURES})`,
            );

            if (consecutivePollFailures >= MAX_SEND_POLL_FAILURES) {
              taskFinished = true;
              if (uploadCancellationRequestedRef.current) {
                markSendCancelled();
              } else {
                markSendFailed(
                  taskResult.error || "Failed to track qmail status",
                  taskResult,
                );
              }
            }
          }
        }

        if (!taskFinished && !cancelledRef.current) {
          if (uploadCancellationRequestedRef.current) {
            markSendCancelled();
          } else {
            markSendFailed(
              "Send is taking longer than expected. Check Sent in a few minutes.",
            );
          }
        }
      } else if (result.success) {
        // Fallback if no taskId is provided but success is true
        knownOperationIds.forEach((operationId) =>
          forgetActiveTransfer(operationId),
        );
        setSendingStatus("completed");
        setTransferFailure(null);
        setSendProgress("Qmail sent successfully!");
        setProgress(100);
        setUploadByteProgress(
          attachmentTotalBytes > 0
            ? {
                completedBytes: String(attachmentTotalBytes),
                totalBytes: String(attachmentTotalBytes),
                percentage: 100,
                estimated: true,
              }
            : null,
        );
        setTimeout(() => {
          if (cancelledRef.current) return;
          finishSend(emailData);
        }, 1500);
      } else {
        const sendError = new Error(result.error || "Failed to send qmail");
        sendError.transferError = result.transferError || null;
        throw sendError;
      }
    } catch (error) {
      console.error("Send error:", error);
      markSendFailed(error.message || "Failed to send qmail", error);
    }
  };

  const handleCancelUpload = async () => {
    const operationIds = [...transferOperationIdsRef.current];
    if (
      operationIds.length === 0 ||
      transferControlPending
    ) {
      return;
    }

    setTransferControlPending("cancel");
    uploadCancellationRequestedRef.current = true;
    setSendingStatus("cancelling");
    setTransferState("cancelling");
    setSendProgress("Requesting upload cancellation...");
    operationIds.forEach((operationId) =>
      rememberActiveTransfer({
        operationId,
        direction: "upload",
        state: "cancelling",
      }),
    );

    const results = await Promise.all(
      operationIds.map((operationId) =>
        cancelObjectTransfer(operationId),
      ),
    );
    const successfulIds = operationIds.filter(
      (_operationId, index) => results[index]?.success,
    );
    const failedResults = results.filter((result) => !result.success);

    if (successfulIds.length === 0) {
      const cancellationError = results.find((result) => result.error);
      uploadCancellationRequestedRef.current = false;
      setSendingStatus("sending");
      setTransferState("");
      setTransferFailure(cancellationError?.transferError || null);
      setError(
        cancellationError?.error ||
          "Could not cancel the upload.",
      );
      setSendProgress("Upload cancellation failed.");
    } else {
      successfulIds.forEach((operationId) =>
        rememberActiveTransfer({
          operationId,
          direction: "upload",
          state: "cancelling",
        }),
      );
      if (failedResults.length > 0) {
        const cancellationError = failedResults.find((result) => result.error);
        setTransferFailure(cancellationError?.transferError || null);
        setError(
          cancellationError?.error ||
            "Some upload transfers could not be cancelled.",
        );
        setSendProgress(
          `Cancellation requested for ${successfulIds.length} of ${operationIds.length} transfers.`,
        );
      } else {
        setSendProgress("Cancellation requested. Finishing active requests...");
      }
    }
    setTransferControlPending("");
  };

  const handleResumeUpload = async () => {
    const operationIds = [...transferOperationIdsRef.current];
    if (
      operationIds.length === 0 ||
      transferControlPending
    ) {
      return;
    }

    setTransferControlPending("resume");
    uploadCancellationRequestedRef.current = false;
    setSendProgress("Resuming upload...");

    const results = await Promise.all(
      operationIds.map((operationId) =>
        resumeObjectTransfer(operationId),
      ),
    );
    const successfulIds = operationIds.filter(
      (_operationId, index) => results[index]?.success,
    );

    if (successfulIds.length === 0) {
      const resumeError = results.find((result) => result.error);
      setTransferFailure(resumeError?.transferError || null);
      setError(
        resumeError?.error ||
          "Could not resume the upload.",
      );
      setSendProgress("Upload remains paused.");
    } else {
      successfulIds.forEach((operationId) =>
        rememberActiveTransfer({
          operationId,
          direction: "upload",
          state: "uploading",
          error: "",
        }),
      );
      setSendingStatus("sending");
      setTransferState("uploading");
      setIsSending(true);
      setTransferFailure(null);
      setError(null);
      setSendProgress("Upload resumed.");

      void (async () => {
        const deadline = Date.now() + SEND_POLL_TIMEOUT_MS;
        while (!cancelledRef.current && Date.now() < deadline) {
          const statuses = [];
          for (const operationId of successfulIds) {
            statuses.push(await getObjectTransferStatus(operationId));
          }
          const successfulStatuses = statuses
            .filter((status) => status.success)
            .map((status) => status.data);
          if (successfulStatuses.length > 0) {
            const completedBytes = successfulStatuses.reduce(
              (total, status) => total + BigInt(status.completedBytes || "0"),
              0n,
            );
            const totalBytes = successfulStatuses.reduce(
              (total, status) => total + BigInt(status.totalBytes || "0"),
              0n,
            );
            const percentage =
              totalBytes > 0n
                ? Number((completedBytes * 1000n) / totalBytes) / 10
                : 0;
            setUploadByteProgress({
              completedBytes: completedBytes.toString(),
              totalBytes: totalBytes.toString(),
              percentage,
              estimated: false,
            });

            const failedStatus = successfulStatuses.find(
              (status) => status.isFinished && !status.isSuccessful,
            );
            if (failedStatus) {
              const failure =
                failedStatus.transferError ||
                normalizeTransferError(failedStatus, { terminal: true });
              setSendingStatus("failed");
              setTransferState(failedStatus.state);
              setTransferFailure(failure);
              setError(failure?.message || failedStatus.error);
              setSendProgress(
                failure?.message || failedStatus.error || "Upload failed.",
              );
              setIsSending(false);
              return;
            }
            if (
              successfulStatuses.length === successfulIds.length &&
              successfulStatuses.every((status) => status.isSuccessful)
            ) {
              setTransferState("completed");
              setSendingStatus("sending");
              setSendProgress(
                "Attachment upload completed. Finalizing the qmail in the background.",
              );
              return;
            }
            if (successfulStatuses.some((status) => status.state === "paused")) {
              setTransferState("paused");
              setSendingStatus("paused");
              setSendProgress("Upload paused again.");
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      })();
    }
    setTransferControlPending("");
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
        case "cancelled":
        case "paused":
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
        <div className="compose-modal__send-progress-content">
          <div className="compose-modal__send-progress-summary">
            <span>{transferFailure?.title || sendProgress}</span>
            {sendingStatus === "sending" && (
              <strong>{formatProgressPercentage(progress)}%</strong>
            )}
          </div>
          {transferFailure && (
            <span className="compose-modal__transfer-error-message">
              {transferFailure.message}
            </span>
          )}
          {transferFailure?.detail && (
            <span className="compose-modal__transfer-error-detail">
              {transferFailure.detail}
            </span>
          )}
          {uploadByteProgress && (
            <>
              <div
                className="compose-modal__transfer-progress-track"
                role="progressbar"
                aria-label="Attachment upload progress"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(uploadByteProgress.percentage)}
              >
                <span
                  className="compose-modal__transfer-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, uploadByteProgress.percentage))}%`,
                  }}
                />
              </div>
              <span className="compose-modal__transfer-progress-bytes">
                {uploadByteProgress.estimated ? "Approximately " : ""}
                {formatByteProgress(uploadByteProgress)}
              </span>
            </>
          )}
          {transferOperationIds.length > 0 && (
            <div className="compose-modal__transfer-controls">
              {transferState === "paused" ? (
                <button
                  type="button"
                  className="compose-modal__transfer-control"
                  onClick={handleResumeUpload}
                  disabled={Boolean(transferControlPending)}
                  title="Resume upload"
                >
                  <RefreshCw
                    size={14}
                    className={
                      transferControlPending === "resume" ? "spinning" : ""
                    }
                  />
                  Resume
                </button>
              ) : (
                isSending &&
                transferState !== "cancelling" && (
                  <button
                    type="button"
                    className="compose-modal__transfer-control compose-modal__transfer-control--danger"
                    onClick={handleCancelUpload}
                    disabled={Boolean(transferControlPending)}
                    title="Cancel upload"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                )
              )}
            </div>
          )}
        </div>
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
          const name = getContactName(contact);
          return (
            <button
              type="button"
              key={contact?.userId || `${field}-${index}`}
              className="compose-modal__contact-suggestion"
              onClick={() => handleContactSelect(field, contact)}
            >
              <div className="compose-modal__contact-name">
                {name}
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
            onPaste={(e) => handleRecipientPaste(e, field, value)}
            onFocus={(e) => handleRecipientFocus(field, e.target.value)}
            disabled={isSending}
            placeholder={placeholder}
          />
          <button
            type="button"
            className="compose-modal__add-contacts-button"
            onClick={() => toggleContactSuggestions(field)}
            disabled={
              isSending ||
              (contacts.length === 0 && popularContacts.length === 0)
            }
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
          <div className="compose-modal__header-main">
            <h3 id="compose-modal-title" className="compose-modal__title">
              {(() => {
                const mode = composeContext?.mode;
                if (mode === "draft") return "Edit Draft";
                if (mode === "reply") return "Reply";
                if (mode === "replyAll") return "Reply All";
                if (mode === "forward") return "Forward";
                return "Compose Qmail";
              })()}
            </h3>
            {renderProgressIndicator()}
          </div>
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
              placeholder="Qmail subject"
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
                  : "Send qmail"
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

      {/* Invalid QMail address explainer modal */}
      {invalidAddress && (
        <div
          className="compose-modal__address-error-overlay"
          role="presentation"
          onClick={() => setInvalidAddress(null)}
        >
          <div
            className="compose-modal__address-error-dialog glass-container"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="compose-invalid-address-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="compose-invalid-address-title">
              <AlertCircle size={18} />
              Invalid QMail address
            </h4>
            <p className="compose-modal__address-error-reason">
              {invalidAddress.message}
            </p>
            <div className="compose-modal__address-error-help">
              <p>A valid QMail address looks like one of these:</p>
              <ul>
                <li>
                  <code>51.254@bit</code> — serial number, then{" "}
                  <code>@</code> and the denomination word (
                  <code>bit</code>, <code>byte</code>, <code>kilo</code>,{" "}
                  <code>mega</code> or <code>giga</code>)
                </li>
                <li>
                  <code>51.254.0</code> — all numbers, the last one is the
                  denomination code (0–4)
                </li>
                <li>
                  <code>0.51.254.0</code> — the same, with leading zeros
                  written out
                </li>
              </ul>
              <p>
                Each number is 0–255. Separate multiple recipients with
                commas.
              </p>
            </div>
            <button
              type="button"
              className="compose-modal__address-error-button"
              onClick={() => setInvalidAddress(null)}
              autoFocus
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* First-time recipient: offer to save the address as a named contact */}
      {newRecipientPrompt && (() => {
        const total = newRecipientPrompt.addresses.length;
        const current = newRecipientPrompt.addresses[newRecipientPrompt.index];
        return (
          <div
            className="compose-modal__address-error-overlay"
            role="presentation"
          >
            <div
              className="compose-modal__new-recipient-dialog glass-container"
              role="dialog"
              aria-modal="true"
              aria-labelledby="compose-new-recipient-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h4 id="compose-new-recipient-title">
                <Users size={18} />
                Save this recipient?
              </h4>
              <p className="compose-modal__new-recipient-copy">
                Your message was sent. Give{" "}
                <code>{current.canonical}</code> a name to add them to your
                contacts, so next time you can just type their name.
                {total > 1 && (
                  <span className="compose-modal__new-recipient-progress">
                    {" "}({newRecipientPrompt.index + 1} of {total})
                  </span>
                )}
              </p>
              <div className="compose-modal__new-recipient-fields">
                <label>
                  First name
                  <input
                    type="text"
                    value={newRecipientPrompt.firstName}
                    disabled={newRecipientPrompt.saving}
                    autoFocus
                    onChange={(event) =>
                      setNewRecipientPrompt((prev) => ({
                        ...prev,
                        firstName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Last name
                  <input
                    type="text"
                    value={newRecipientPrompt.lastName}
                    disabled={newRecipientPrompt.saving}
                    onChange={(event) =>
                      setNewRecipientPrompt((prev) => ({
                        ...prev,
                        lastName: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="compose-modal__new-recipient-actions">
                <button
                  type="button"
                  className="compose-modal__draft-button"
                  onClick={() =>
                    total > 1
                      ? advanceNewRecipientPrompt()
                      : dismissNewRecipientPrompt(newRecipientPrompt)
                  }
                  disabled={newRecipientPrompt.saving}
                >
                  {total > 1 ? "Skip" : "Not now"}
                </button>
                <button
                  type="button"
                  className="compose-modal__send-button"
                  onClick={handleSaveNewRecipient}
                  disabled={newRecipientPrompt.saving}
                >
                  {newRecipientPrompt.saving ? "Saving..." : "Save contact"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ComposeModal;
