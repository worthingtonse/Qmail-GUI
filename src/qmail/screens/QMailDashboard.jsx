/* eslint-disable react/prop-types */
import { useState, useEffect, useMemo, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import ComposeModal from "./ComposeModal";
import WalletActionModal from "./WalletActionModal";
import ContactsPane from "./ContactsPane";
import AccountPane from "./AccountPane";
import NavigationPane from "./NavigationPane";
import EmailListPane from "./EmailListPane";
import ReadingPane from "./ReadingPane";
import ActiveTransfersPanel from "./ActiveTransfersPanel";
import soundService from "../../api/soundService";
import {
  getMailList,
  searchEmails,
  getMailCount,
  getMailFolders,
  getEmailById,
  getDrafts,
  getEmailAttachments,
  getQMailWalletBalance,
  checkMailNow,
  echoRaida,
  markEmailRead,
  moveEmail,
  deleteEmail,
  deleteEmailPermanent,
  emptyTrashFolder,
  getMailNotifications,
  downloadEmailContent,
  dismissMailNotification,
  downloadMailAttachment,
  getObjectTransferStatus,
  cancelObjectTransfer,
  resumeObjectTransfer,
  sendEmail,
  getQMailPaymentInfo,
  markQMailPaymentRefunded,
  starEmail,
  addContact,
  setContactFavorite,
  convertSnToEmail,
  getIdentity,
  normalizeIdentityForUi,
  lookupMailWalletPath,
  SSE_URL,
} from "../../api/qmailApiServices";
import { formatTimestamp } from "./formatTimestamp";
import {
  clearQmailLocalStorageExceptSkip,
  setSkipAutoRestore,
} from "../skipAutoRestore";
import {
  formatTransferErrorNotification,
  normalizeTransferError,
} from "../transferErrors";
import {
  forgetActiveTransfer,
  readActiveTransferRegistry,
  rememberActiveTransfer,
} from "../activeTransferRegistry";
import { useNotification } from "../../components/common/notifications/NotificationContext";

import "./QMailDashboard.css";

const PENDING_DUPLICATE_WINDOW_MS = 60000;
const SEARCH_RESULT_LIMIT = 50;
const EMPTY_BODY_PREVIEW = "(no message body)";
const REFRESH_STEP_TIMEOUT_MS = 30000;
const RAIDA_REFRESH_TIMEOUT_MS = 20000;
const DECRYPT_REVEAL_MIN_MS = 2200;
const PAYMENT_STATUS_UNCLAIMED = 0;
const PAYMENT_STATUS_CLAIMED = 1;
const PAYMENT_STATUS_REFUNDED = 3;
const PAYMENT_REJECTION_MESSAGE =
  "The payment you sent was rejected by the receiver. The inbox fee you included has been refunded. Your qmail may or may not have been read.";


const normalizeMailIdentifier = (identifier) => {
  if (!identifier) return "";
  const value = String(identifier);
  return value.startsWith("pending-") ? value.slice("pending-".length) : value;
};

const joinDisplayPath = (dir, name) => {
  const folder = String(dir || "").trim().replace(/[\\/]+$/, "");
  const file = String(name || "").trim().replace(/^[\\/]+/, "");
  if (!folder) return file;
  if (!file) return folder;
  const separator = folder.includes("\\") || /^[A-Za-z]:/.test(folder) ? "\\" : "/";
  return `${folder}${separator}${file}`;
};

const getEmailDownloadIdentifier = (email = {}) =>
  normalizeMailIdentifier(email.guid || email.file_guid || email.email_id || email.id);

const isEmailExplicitlyUndownloaded = (email = {}) =>
  email.isPending ||
  email.isDownloaded === false ||
  email.isDownloaded === "false" ||
  email.isDownloaded === 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runWithRefreshTimeout = (label, step, timeoutMs) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `${label} did not finish within ${Math.round(timeoutMs / 1000)} seconds`,
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve().then(step), timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
};

const getFirstNonBlankText = (...values) =>
  values.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  ) || "";

const collectDecryptErrorText = (source = {}) => {
  const sources = [
    source,
    source?.data,
    source?.apiData,
    source?.payload,
    source?.result,
  ].filter(Boolean);
  return getFirstNonBlankText(
    ...sources.flatMap((item) => [
      item.error,
      item.error_message,
      item.errorMessage,
      item.message,
      item.detail,
      item.details,
    ]),
  );
};

const normalizeQmailDecryptError = (source = {}, fallbackMessage = "QMail could not decrypt this message.") => {
  const detail = collectDecryptErrorText(source) || fallbackMessage;
  const text = detail.toLowerCase();

  if (/no pending tell|file_guid|sender_sn|download directly/.test(text)) {
    return {
      title: "Message is no longer pending",
      message: "QMail could not find the encrypted notice for this message. Refresh the inbox; if it still appears encrypted, delete the pending message.",
      detail,
      canRetry: false,
    };
  }
  if (/helper|rejected/.test(text)) {
    return {
      title: "Helper coin needs repair",
      message: "The helper coin used for this download was rejected by one or more RAIDA servers. Run a health check, then try again.",
      detail,
      canRetry: true,
    };
  }
  if (/not enough|insufficient.*stripes|stripes.*downloaded|missing.*stripes/.test(text)) {
    return {
      title: "Not enough message parts",
      message: "QMail could not download enough message parts to rebuild this qmail. Try again later; if it keeps failing, delete the message or ask the sender to resend it.",
      detail,
      canRetry: true,
    };
  }
  if (/crc|hash|integrity|corrupt|mismatch/.test(text)) {
    return {
      title: "Message integrity check failed",
      message: "The downloaded message parts did not match the sender's integrity check. Try once more; if it repeats, delete the message or ask the sender to resend it.",
      detail,
      canRetry: true,
    };
  }
  if (/not found|no stored tell|no longer exists|expired|not available|not committed/.test(text)) {
    return {
      title: "Message is no longer available",
      message: "The QMail servers do not have the data needed to decrypt this message. Ask the sender to resend it, or delete the pending message.",
      detail,
      canRetry: false,
    };
  }
  if (/manifest|malformed|invalid.*format|invalid.*message|parse/.test(text)) {
    return {
      title: "Invalid QMail message",
      message: "This message is not in a valid QMail format. Ask the sender to resend it, or delete the pending message.",
      detail,
      canRetry: false,
    };
  }
  if (/identity|mail id|encryption key|decrypt key|no encryption/.test(text)) {
    return {
      title: "Mail ID needs repair",
      message: "Your Mail ID or encryption key could not decrypt this message. Run a health check, then try again.",
      detail,
      canRetry: true,
    };
  }
  if (/timeout|temporarily unavailable|service unavailable|busy/.test(text)) {
    return {
      title: "QMail service is busy",
      message: "QMail did not finish decrypting this message in time. Wait a moment, then try again.",
      detail,
      canRetry: true,
    };
  }
  if (/network|connection|fetch|offline|unreachable|raida/.test(text)) {
    return {
      title: "Network problem",
      message: "QMail could not reach enough RAIDA servers. Check your connection, then try again.",
      detail,
      canRetry: true,
    };
  }

  const transferError = normalizeTransferError(source?.apiData || source?.data || source, {
    fallbackMessage,
    terminal: true,
  });
  if (transferError) {
    return {
      title: transferError.title,
      message: transferError.message,
      detail: transferError.detail,
      canRetry: transferError.canRetry !== false,
    };
  }

  return {
    title: "Could not decrypt message",
    message: "QMail could not determine why this message failed. Try again; if it keeps failing, delete it or ask the sender to resend it.",
    detail,
    canRetry: true,
  };
};

const formatDecryptErrorNotification = (error) =>
  error?.title && error?.message
    ? `${error.title}: ${error.message}`
    : "QMail could not decrypt this message.";

const buildPreviewState = (body, ...previewCandidates) => {
  const preview = getFirstNonBlankText(...previewCandidates);
  if (preview) {
    return { preview, isEmptyBodyPreview: false };
  }

  const bodyText = typeof body === "string" ? body.trim() : "";
  if (bodyText) {
    return {
      preview: bodyText.substring(0, 100),
      isEmptyBodyPreview: false,
    };
  }

  return {
    preview: EMPTY_BODY_PREVIEW,
    isEmptyBodyPreview: true,
  };
};

const getPendingTimestamp = (notif) =>
  notif.timestamp ||
  notif.received_timestamp ||
  notif.receivedTimestamp ||
  notif.created_at ||
  notif.createdAt ||
  0;

const timestampToMs = (value) => {
  const num = Number(value);
  if (!num || Number.isNaN(num)) return 0;
  return num < 1e12 ? num * 1000 : num;
};

const QMAIL_DENOMINATION_CODE_TO_VALUE = {
  0: 1,
  1: 10,
  2: 100,
  3: 1000,
  4: 10000,
};

const readNumericSenderField = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
};

const readEmailReadFlag = (email = {}, fallback = false) => {
  const values = [email.is_read, email.isRead, email.read];
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return fallback;
};

const getEmailId = (email = {}) =>
  email.id || email.email_id || email.EmailID || email.guid || email.file_guid || "";

const getEmailInboxFee = (email = {}) => {
  const inboxFee = readNumericSenderField(email.inboxFee, email.inbox_fee);
  return inboxFee && inboxFee > 0 ? inboxFee : 0;
};

const getEmailPaymentStatus = (email = {}) =>
  readNumericSenderField(email.paymentStatus, email.payment_status);

const emailMayHaveRefundablePayment = (email = {}) => {
  const status = getEmailPaymentStatus(email);
  if (status === PAYMENT_STATUS_CLAIMED || status === PAYMENT_STATUS_REFUNDED) {
    return false;
  }
  if (status === PAYMENT_STATUS_UNCLAIMED) return true;

  const statusText = String(
    email.paymentStatusText || email.payment_status_text || "",
  ).toLowerCase();
  if (statusText === "claimed" || statusText === "refunded") return false;
  if (statusText === "unclaimed") return true;

  return getEmailInboxFee(email) > 0;
};

const buildPaymentRejectionSubject = (email = {}) => {
  const subject = String(email.subject || "QMail message").trim();
  return `Payment rejected: ${subject || "QMail message"}`;
};

const buildPaymentRejectionBody = (lockerCode) =>
  [
    PAYMENT_REJECTION_MESSAGE,
    "",
    `Refund locker key: ${lockerCode}`,
  ].join("\n");

const isSerialNumberText = (value) =>
  typeof value === "string" && /^\d+$/.test(value.trim());

const getEmailSenderSn = (email = {}) => {
  const sn = readNumericSenderField(email.sender_sn, email.senderSn);
  return sn && sn > 0 ? sn : null;
};

const getEmailSenderDenominationCode = (email = {}) => {
  const code = readNumericSenderField(
    email.sender_denomination_code,
    email.senderDenominationCode,
  );
  if (code !== null && code >= 0 && code <= 4) return code;

  const denomination = readNumericSenderField(
    email.sender_denomination,
    email.senderDenomination,
  );
  const codeFromValue = Object.entries(QMAIL_DENOMINATION_CODE_TO_VALUE).find(
    ([, value]) => value === denomination,
  );
  return codeFromValue ? Number(codeFromValue[0]) : null;
};

const getEmailSenderDenomination = (email = {}) => {
  const denomination = readNumericSenderField(
    email.sender_denomination,
    email.senderDenomination,
  );
  if (denomination && denomination > 0) return denomination;

  const code = getEmailSenderDenominationCode(email);
  return code !== null ? QMAIL_DENOMINATION_CODE_TO_VALUE[code] : null;
};

const getEmailSenderAddress = (email = {}, fallback = "Unknown Sender") => {
  const address = [
    email.sender_address,
    email.senderAddress,
    email.senderEmail,
    email.from,
    email.sender,
  ].find(
    (value) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      !isSerialNumberText(value) &&
      !/^SN#/i.test(value.trim()) &&
      !/^Unknown( Sender)?$/i.test(value.trim()),
  );
  if (address) return address.trim();

  const senderSn = getEmailSenderSn(email);
  if (senderSn) return String(senderSn);

  const serialText = [email.senderEmail, email.from, email.sender].find(
    (value) => typeof value === "string" && isSerialNumberText(value),
  );
  return serialText ? serialText.trim() : fallback;
};

const getEmailSenderFields = (email = {}, fallback = "Unknown Sender") => {
  const senderSn = getEmailSenderSn(email);
  const senderDenomination = getEmailSenderDenomination(email);
  const senderDenominationCode = getEmailSenderDenominationCode(email);
  const sender = getEmailSenderAddress(email, senderSn ? String(senderSn) : fallback);
  const senderEmail = sender && (sender !== fallback || senderSn) ? sender : "";

  return {
    sender,
    senderEmail,
    from: senderEmail,
    sender_address: senderEmail,
    senderSn,
    sender_sn: senderSn,
    senderDenomination,
    sender_denomination: senderDenomination,
    senderDenominationCode,
    sender_denomination_code: senderDenominationCode,
  };
};

// Folders whose messages the user SENT — for these we display the recipient
// ("To"), not the sender (which would be the user themselves).
const OUTGOING_FOLDERS = new Set(["sent", "drafts"]);

// Build the "sender_*" display fields that EmailListItem / ReadingPane /
// SenderAvatar all read. For incoming mail these are the real sender; for
// outgoing mail (Sent/Drafts) we map the primary RECIPIENT into the same
// sender-shaped fields so the existing display components show the
// recipient without any per-component folder branching.
const getEmailDisplayIdentityFields = (email = {}, folder) => {
  if (!OUTGOING_FOLDERS.has(folder)) {
    return getEmailSenderFields(email);
  }

  const recipientSn =
    readNumericSenderField(email.recipientSn, email.recipient_sn) || null;
  const recipientCode = (() => {
    const code = readNumericSenderField(
      email.recipientDenominationCode,
      email.recipient_denomination_code,
    );
    return code !== null && code >= 0 && code <= 4 ? code : null;
  })();
  const recipientAddress =
    typeof email.recipientAddress === "string" && email.recipientAddress.trim()
      ? email.recipientAddress.trim()
      : typeof email.recipient_address === "string" && email.recipient_address.trim()
      ? email.recipient_address.trim()
      : recipientSn
      ? String(recipientSn)
      : "";
  const extraCount =
    (readNumericSenderField(email.recipientCount, email.recipient_count) || 0) - 1;
  // When a message has multiple recipients, hint at it after the first.
  const displayName =
    recipientAddress && extraCount > 0
      ? `${recipientAddress} +${extraCount}`
      : recipientAddress || "Unknown Recipient";

  return {
    sender: displayName,
    senderEmail: recipientAddress,
    from: recipientAddress,
    sender_address: recipientAddress,
    senderSn: recipientSn,
    sender_sn: recipientSn,
    senderDenomination: null,
    sender_denomination: null,
    senderDenominationCode: recipientCode,
    sender_denomination_code: recipientCode,
  };
};

const getPendingSender = (notif) =>
  getEmailSenderAddress(
    notif,
    notif.sender_name || notif.senderName || "Unknown Sender",
  );

// FIX-03: replace the dead `initValues` prop with `initialIdentity`
// (threaded from App via QMail). May be null on the has_id fallback
// path — userAccount falls back to a mount-time getIdentity() call.
const INITIAL_MAIL_COUNTS = {
  inbox: { unread: 0, total: 0 },
  sent: { unread: 0, total: 0 },
  drafts: { unread: 0, total: 0 },
  trash: { unread: 0, total: 0 },
  archive: { unread: 0, total: 0 },
  starred: { unread: 0, total: 0 },
};

const QMailDashboard = ({ initialIdentity, onSignOut }) => {
  const [activeView, setActiveView] = useState("inbox");
  const [currentFolder, setCurrentFolder] = useState("inbox");
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [emails, setEmails] = useState([]);
  const [, setDrafts] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalEmailCount, setTotalEmailCount] = useState(0);
  const [sortMode, setSortMode] = useState("newest");
  const EMAILS_PER_PAGE = 50;

  const [mailCounts, setMailCounts] = useState(INITIAL_MAIL_COUNTS);
  const [searchResultCapHit, setSearchResultCapHit] = useState(false);

  const [walletBalance, setWalletBalance] = useState(null);
  const [folders, setFolders] = useState([]);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [walletActionMode, setWalletActionMode] = useState(null);
  const [composeContext, setComposeContext] = useState(null);
  const [raidaEchoSnapshot, setRaidaEchoSnapshot] = useState(null);
  const { addNotification, clearAllNotifications } = useNotification();

  const [pendingMails, setPendingMails] = useState([]);
  const [decryptingMailIds, setDecryptingMailIds] = useState(() => new Set());
  const [refundingEmailIds, setRefundingEmailIds] = useState(() => new Set());
  const [emailAttachments, setEmailAttachments] = useState([]);
  const [attachmentDownloadProgress, setAttachmentDownloadProgress] =
    useState(null);
  const [restoredTransfers, setRestoredTransfers] = useState(() =>
    readActiveTransferRegistry().map((entry) => ({
      ...entry,
      status: null,
      lookupError: null,
    })),
  );
  const [restoredTransferControlPending, setRestoredTransferControlPending] =
    useState("");
  const [pendingDangerousAttachment, setPendingDangerousAttachment] =
    useState(null);
  const [mailWalletPath, setMailWalletPath] = useState(null);
  // FIX-04: track which draft row is currently being hydrated so
  // EmailListItem can show a spinner while we fetch the full draft
  // before opening ComposeModal. Hydrate-before-mount avoids the v3
  // "open modal with empty body, user types, save clobbers the
  // persisted full draft" failure mode.
  const [loadingDraftId, setLoadingDraftId] = useState(null);
  // BUG-22 FIX: Use ref instead of state for debounce timer
  const searchDebounceTimerRef = useRef(null);
  // BUG-21 FIX: Track current folder load to prevent race conditions
  const loadEmailsRequestRef = useRef(0);
  // gpt-batch1: ref-mirror of selectedEmail so async hydrate
  // completion can detect "user has moved on" without relying on a
  // stale closure of selectedEmail.
  const selectedEmailRef = useRef(null);
  const currentFolderRef = useRef(currentFolder);
  // gpt-batch3 #2: monotonic request counter for draft hydration.
  // handleSelectEmail's isDraft branch captures the counter value
  // before awaiting; if a newer click bumps it (or a different folder
  // is opened), the in-flight result is dropped silently.
  const draftHydrateRequestRef = useRef(0);
  const previousMailCountsRef = useRef({});
  const pendingMailsRef = useRef([]);
  const mailDownloadPromisesRef = useRef(new Map());
  const attachmentDownloadAbortRef = useRef(null);
  const attachmentDownloadInProgressRef = useRef(false);
  const attachmentCancelPendingRef = useRef(false);
  const restoredTransfersRef = useRef(restoredTransfers);
  // Serial queue for background tell downloads. The rest_core HTTP server is
  // single-threaded, so a slow cmd-74 download (30s when a RAIDA times out)
  // blocks every other request — including the inbox list query — until it
  // finishes. Firing N pending-tell downloads at once therefore freezes the
  // inbox behind them. We drain them ONE AT A TIME, and only after the inbox
  // has had a chance to render, so the list paints immediately and pending
  // rows fill in via SSE as each download completes.
  const tellDownloadQueueRef = useRef([]);
  const tellDownloadQueuedIdsRef = useRef(new Set());
  const tellDownloadDrainingRef = useRef(false);
  const interactiveDecryptIdsRef = useRef(new Set());
  const decryptRevealDeadlineRef = useRef(new Map());
  const seenNotificationIdsRef = useRef(new Set());

  // FIX-03: seed from App's normalized identity, or null if the
  // has_id fallback path skipped seeding. The mount-time useEffect
  // below will retry getIdentity() when this is null.
  //
  // gpt-batch2 #2: ONLY seed from initialIdentity when it's
  // configured. A truthy-but-unconfigured object would skip the
  // mount-time retry and leave the user with placeholder data.
  const [userAccount, setUserAccount] = useState(
    initialIdentity && initialIdentity.configured ? initialIdentity : null,
  );

  const formattedPendingMails = useMemo(() => {
    const seenBySenderWindow = new Map();

    return pendingMails.map((notif) => {
      const guid = notif.guid || notif.file_guid;
      const identifier = normalizeMailIdentifier(guid);
      const isDecrypting = identifier ? decryptingMailIds.has(identifier) : false;
      const senderFields = getEmailSenderFields(notif, getPendingSender(notif));
      const sender = senderFields.sender;
      const rawTimestamp = getPendingTimestamp(notif);
      const timestampMs = timestampToMs(rawTimestamp);
      const duplicateKey = `${sender.toLowerCase()}::${
        timestampMs ? Math.floor(timestampMs / PENDING_DUPLICATE_WINDOW_MS) : "unknown"
      }`;
      const sequence = (seenBySenderWindow.get(duplicateKey) || 0) + 1;
      seenBySenderWindow.set(duplicateKey, sequence);
      const formattedTime =
        formatTimestamp(rawTimestamp) || new Date().toLocaleTimeString();

      return {
        id: `pending-${identifier || guid}`,
        notificationId: notif.notificationId ?? notif.notification_id ?? notif.id ?? null,
        guid,
        fileGuid: guid,
        ...senderFields,
        subject: `${isDecrypting ? "Decrypting" : "Encrypted"} message${sequence > 1 ? ` #${sequence}` : ""}`,
        preview: isDecrypting
          ? "Downloading stripes and decrypting in the background."
          : `Queued for background decryption. Arrived ${formattedTime}.`,
        rawTimestamp: Number(rawTimestamp) || 0,
        timestamp: formattedTime,
        isPending: true,
        isRead: false,
        isDownloaded: false,
        isDecrypting,
        isPlaceholderSubject: true,
      };
    });
  }, [decryptingMailIds, pendingMails]);

  const displayEmails = useMemo(() => {
    if (currentFolder !== "inbox") return emails;

    const merged = [...formattedPendingMails, ...emails];

    let ordered = merged;
    if (sortMode === "newest") {
      // The backend sorts received mail newest-first, but pending/encrypted mail
      // is merged in on the client and must be interleaved by its real arrival
      // time — otherwise an older pending message floats above newer received
      // mail. A pending message with no timestamp yet is genuinely newest, so it
      // stays on top; a received message with no send time ("—") sinks to bottom.
      const sortKey = (email) => {
        const ms = timestampToMs(email.rawTimestamp);
        if (ms) return ms;
        return email.isPending ? Number.POSITIVE_INFINITY : 0;
      };
      ordered = merged
        .map((email, index) => ({ email, index }))
        .sort((a, b) => {
          const diff = sortKey(b.email) - sortKey(a.email);
          if (diff) return diff;
          // Tiebreak: keep pending ahead of received, otherwise stable order.
          if (a.email.isPending !== b.email.isPending) {
            return a.email.isPending ? -1 : 1;
          }
          return a.index - b.index;
        })
        .map(({ email }) => email);
    }

    return sortMode === "unread"
      ? ordered.filter((email) => !email.isRead)
      : ordered;
  }, [currentFolder, formattedPendingMails, emails, sortMode]);
  const qmailAddress = useMemo(() => (
    userAccount?.prettyAddress ||
    userAccount?.pretty_address ||
    userAccount?.email_address ||
    (userAccount?.address && userAccount?.domain
      ? `${userAccount.address}@${userAccount.domain}`
      : userAccount?.address) ||
    ""
  ), [userAccount]);

  useEffect(() => {
    pendingMailsRef.current = pendingMails;
  }, [pendingMails]);

  useEffect(() => {
    restoredTransfersRef.current = restoredTransfers;
  }, [restoredTransfers]);

  useEffect(() => {
    let disposed = false;
    let reconciling = false;

    const reconcileRestoredTransfers = async () => {
      if (reconciling || disposed) return;
      const snapshot = restoredTransfersRef.current.filter(
        (entry) => !entry.status?.isFinished,
      );
      if (snapshot.length === 0) return;

      reconciling = true;
      const results = [];
      for (const entry of snapshot) {
        if (disposed) break;
        results.push({
          operationId: entry.operationId,
          result: await getObjectTransferStatus(entry.operationId),
        });
      }
      reconciling = false;
      if (disposed) return;

      const resultsById = new Map(
        results.map((item) => [item.operationId, item.result]),
      );
      setRestoredTransfers((current) =>
        current.map((entry) => {
          const result = resultsById.get(entry.operationId);
          if (!result) return entry;
          if (!result.success) {
            return {
              ...entry,
              lookupError: result.error,
              transferError: result.transferError || null,
            };
          }

          const status = result.data;
          rememberActiveTransfer({
            ...entry,
            state: status.state,
            completedBytes: status.completedBytes,
            totalBytes: status.totalBytes,
            error: status.error,
            destinationPath: status.destinationPath,
          });
          return {
            ...entry,
            status,
            lookupError: null,
            transferError: status.transferError || null,
          };
        }),
      );
    };

    reconcileRestoredTransfers();
    const interval = setInterval(reconcileRestoredTransfers, 5000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);

  const setMailDecrypting = (identifier, isDecrypting) => {
    const normalizedIdentifier = normalizeMailIdentifier(identifier);
    if (!normalizedIdentifier) return;

    setDecryptingMailIds((prev) => {
      const next = new Set(prev);
      if (isDecrypting) next.add(normalizedIdentifier);
      else next.delete(normalizedIdentifier);
      return next;
    });
  };

  const setEmailRefunding = (emailId, isRefunding) => {
    const normalizedEmailId = String(emailId || "").toLowerCase();
    if (!normalizedEmailId) return;

    setRefundingEmailIds((prev) => {
      const next = new Set(prev);
      if (isRefunding) next.add(normalizedEmailId);
      else next.delete(normalizedEmailId);
      return next;
    });
  };

  const waitForDecryptReveal = async (identifier) => {
    const normalizedIdentifier = normalizeMailIdentifier(identifier);
    const deadline = decryptRevealDeadlineRef.current.get(normalizedIdentifier) || 0;
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await wait(remainingMs);
    }
    decryptRevealDeadlineRef.current.delete(normalizedIdentifier);
  };

  const showDashboardNotification = (notification, fallbackType = "info") => {
    if (!notification) return null;
    const payload =
      typeof notification === "string"
        ? { message: notification, type: fallbackType }
        : {
            ...notification,
            type: notification.type || notification.variant || fallbackType,
          };

    if (!payload.message) return null;

    const hasClickTarget = payload.targetPendingGuid || payload.targetEmailId;
    return addNotification(payload.message, payload.type, {
      duration: payload.duration ?? (payload.type === "error" ? 8000 : 5000),
      timestamp: payload.timestamp,
      targetPendingGuid: payload.targetPendingGuid,
      targetEmailId: payload.targetEmailId,
      onClick: hasClickTarget
        ? () => {
            if (payload.targetPendingGuid) {
              focusPendingMail(payload.targetPendingGuid);
              return;
            }
            focusInboxEmail(payload.targetEmailId);
          }
        : undefined,
    });
  };

  // Enqueue a pending tell for background download. Idempotent per identifier.
  const enqueueTellDownload = (identifier) => {
    if (!identifier || tellDownloadQueuedIdsRef.current.has(identifier)) return;
    tellDownloadQueuedIdsRef.current.add(identifier);
    tellDownloadQueueRef.current.push(identifier);
    drainTellDownloadQueue();
  };

  // Drain the tell-download queue one item at a time. Yields to the event loop
  // before starting so any inbox list/counts fetch already in flight is served
  // by the single-threaded backend first. Each download is awaited before the
  // next begins, so downloads never pile up and block the server in parallel.
  const drainTellDownloadQueue = async () => {
    if (tellDownloadDrainingRef.current) return;
    tellDownloadDrainingRef.current = true;
    try {
      // Let the inbox render before we tie up the single backend thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (tellDownloadQueueRef.current.length > 0) {
        const identifier = tellDownloadQueueRef.current.shift();
        tellDownloadQueuedIdsRef.current.delete(identifier);
        try {
          await handleDownloadMail(identifier, { silent: true });
        } catch (error) {
          console.warn("Background tell download failed:", error);
        }
      }
    } finally {
      tellDownloadDrainingRef.current = false;
    }
  };

  const mergePendingNotifications = (incoming) => {
    const existing = pendingMailsRef.current;
    const existingIds = new Set(
      existing.map((p) => normalizeMailIdentifier(p.guid || p.file_guid)),
    );
    const seenIds = seenNotificationIdsRef.current;

    const newNotifs = (incoming || []).filter((n) => {
      const incomingId = normalizeMailIdentifier(n.guid || n.file_guid);
      if (!incomingId || existingIds.has(incomingId) || seenIds.has(incomingId)) {
        return false;
      }
      return true;
    });

    if (newNotifs.length === 0) return [];

    newNotifs.forEach((notif) => {
      const identifier = normalizeMailIdentifier(notif.guid || notif.file_guid);
      if (identifier) seenIds.add(identifier);
    });

    pendingMailsRef.current = [...existing, ...newNotifs];
    setPendingMails((prev) => {
      const additions = newNotifs.filter((n) => {
        const incomingId = normalizeMailIdentifier(n.guid || n.file_guid);
        return !prev.some(
          (p) => normalizeMailIdentifier(p.guid || p.file_guid) === incomingId,
        );
      });
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });

    newNotifs.forEach((notif) => {
      const identifier = normalizeMailIdentifier(notif.guid || notif.file_guid);
      // Queue rather than fire immediately: the single-threaded backend can
      // only run one download at a time, and the inbox list must paint first.
      if (identifier) enqueueTellDownload(identifier);
    });

    if (notificationPollBaselineSeenRef.current && newNotifs.length > 0) {
      soundService.playMailReceived();
    }

    notificationPollBaselineSeenRef.current = true;

    return newNotifs;
  };

  // Background Watcher — adaptive cadence.
  //
  // /notifications/list is only for tells that still need downloading. The
  // SSE "new-mail" event is emitted after rest_core has already downloaded
  // and stored the message, so that path refreshes the local inbox directly.
  const [isSseConnected, setIsSseConnected] = useState(false);
  const fetchNotificationsRef = useRef(null);
  const inboxRefreshPromiseRef = useRef(null);
  const handleNewMailEventRef = useRef(null);
  const notificationPollBaselineSeenRef = useRef(false);

  fetchNotificationsRef.current = async () => {
    try {
      const result = await getMailNotifications();
      if (result.success && result.data.count > 0) {
        mergePendingNotifications(result.data.notifications || []);
      }
    } catch (error) {
      console.error("Watch error:", error);
    }
  };

  handleNewMailEventRef.current = async (payload = {}) => {
    const guid = normalizeMailIdentifier(
      payload.guid || payload.file_guid || payload.email_id,
    );
    let shouldPlaySound = false;

    if (guid) {
      if (!seenNotificationIdsRef.current.has(guid)) {
        shouldPlaySound = true;
      }
      seenNotificationIdsRef.current.add(guid);
      setPendingMails((prev) => {
        const next = prev.filter(
          (mail) => normalizeMailIdentifier(mail.guid || mail.file_guid) !== guid,
        );
        pendingMailsRef.current = next;
        return next;
      });
    }

    if (shouldPlaySound) {
      soundService.playMailReceived();
    }

    if (inboxRefreshPromiseRef.current) {
      return inboxRefreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
      try {
        await loadMailCounts({ refreshInboxOnIncrease: false });
        if (currentFolderRef.current === "inbox") {
          setCurrentPage(0);
          await loadEmails("inbox", 0, { notifyOnError: false });
        }
      } catch (error) {
        console.error("SSE inbox refresh error:", error);
      }
    })().finally(() => {
      inboxRefreshPromiseRef.current = null;
    });

    inboxRefreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  };

  useEffect(() => {
    const tick = () => fetchNotificationsRef.current?.();
    const cadenceMs = isSseConnected ? 60000 : 10000;
    const interval = setInterval(tick, cadenceMs);
    tick();
    return () => clearInterval(interval);
  }, [isSseConnected]);

  useEffect(() => {
    // EventSource is available in Electron's Chromium renderer; the SSE
    // server runs on http_port + 100. Browser auto-reconnects on drop, so
    // we don't manage retry timers — just track connected state for the
    // adaptive cadence above and refresh the local inbox on events.
    if (
      !SSE_URL ||
      typeof window === "undefined" ||
      typeof EventSource === "undefined"
    ) {
      return undefined;
    }

    let es;
    try {
      es = new EventSource(SSE_URL);
    } catch (err) {
      console.warn("SSE: EventSource construction failed:", err);
      return undefined;
    }

    es.onopen = () => setIsSseConnected(true);
    es.onerror = () => setIsSseConnected(false);
    es.addEventListener("new-mail", (event) => {
      let payload = {};
      if (event?.data) {
        try {
          payload = JSON.parse(event.data);
        } catch (err) {
          console.warn("SSE: invalid new-mail payload:", err);
        }
      }
      handleNewMailEventRef.current?.(payload);
    });

    return () => {
      try { es.close(); } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    loadInitialData();

    const mailCountInterval = setInterval(() => {
      loadMailCounts();
    }, 60000);

    const walletInterval = setInterval(() => {
      loadWalletBalance();
    }, 120000);

    const handleFocus = () => {
      loadWalletBalance();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(mailCountInterval);
      clearInterval(walletInterval);
      window.removeEventListener("focus", handleFocus);
      if (searchDebounceTimerRef.current) {
        clearTimeout(searchDebounceTimerRef.current);
      }
    };
    // Dashboard bootstrap intentionally runs once; these loaders close over
    // initial view state and are also called directly by UI handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FIX-03: if App didn't pre-seed userAccount (has_id fallback path
  // — coin files on disk but identity not yet visible to the API),
  // hydrate here.
  //
  // gpt-batch2 #4: the original single-shot was too weak. Use the
  // same retry+backoff discipline as hydrateDownloadedEmail —
  // 3 attempts (immediate, +500ms, +1000ms) wrapped in try/catch and
  // cancellable. After 3 failures, leave userAccount null; AccountPane
  // already conditionally renders the profile section so the rest of
  // the dashboard remains usable. The user can refresh later.
  useEffect(() => {
    if (userAccount) return; // Already seeded from props.
    let cancelled = false;
    const MAX_ATTEMPTS = 3;

    (async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        try {
          const raw = await getIdentity();
          if (cancelled) return;
          const normalized = normalizeIdentityForUi(raw);
          if (normalized && normalized.configured) {
            setUserAccount(normalized);
            return;
          }
        } catch (e) {
          console.warn(`Mount-time getIdentity attempt ${attempt + 1} failed:`, e);
        }
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      console.warn("Mount-time identity hydration gave up after retries.");
    })();

    return () => {
      cancelled = true;
    };
  }, [userAccount]);

  // gpt-batch1: mirror selectedEmail into a ref so async hydrate
  // completion can detect when the user has moved on to a different
  // message. See handleDownloadMail.
  useEffect(() => {
    selectedEmailRef.current = selectedEmail;
  }, [selectedEmail]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedEmail || !selectedEmail.isPending) {
      setMailWalletPath(null);
      return undefined;
    }

    (async () => {
      try {
        const lookup = await lookupMailWalletPath();
        if (cancelled) return;
        if (lookup.success && lookup.path) {
          setMailWalletPath(lookup.path);
          return;
        }
        const backendDataDir = window.electronAPI?.getBackendDataDir
          ? await window.electronAPI.getBackendDataDir()
          : null;
        if (!cancelled) {
          setMailWalletPath(backendDataDir || null);
        }
      } catch (error) {
        if (!cancelled) {
          const backendDataDir = window.electronAPI?.getBackendDataDir
            ? await window.electronAPI.getBackendDataDir()
            : null;
          setMailWalletPath(backendDataDir || null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEmail]);

  // BUG-25 FIX: Sync document.title with state via useEffect
  useEffect(() => {
    const unread = mailCounts[currentFolder]?.unread || 0;
    const base = unread > 0
      ? `(${unread}) QMail - ${currentFolder}`
      : `QMail - ${currentFolder}`;
    // Append the user's own address once identity has resolved.
    document.title = qmailAddress ? `${base} - ${qmailAddress}` : base;
  }, [currentFolder, mailCounts, qmailAddress]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      // syncData() was removed from the background load: /api/admin/sync
      // was removed in QMail v2 and the stub always returns failure.
      await loadWalletBalance();

      await Promise.all([loadFolders(), loadMailCounts(), loadDrafts()]);
      await loadEmails(currentFolder);
    } catch (error) {
      console.error("Error loading initial data:", error);
      showDashboardNotification("Error loading dashboard data", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWalletAction = (mode) => {
    setWalletActionMode(mode === "withdraw" ? "withdraw" : "add");
  };

  const handleCloseWalletAction = () => {
    setWalletActionMode(null);
  };

  const handleWalletUpdated = async () => {
    await loadWalletBalance();
  };
  const loadWalletBalance = async () => {
    try {
      const result = await getQMailWalletBalance();
      if (result.success) {
        setWalletBalance(result.data);
      } else {
        setWalletBalance(null);
      }
    } catch (error) {
      setWalletBalance(null);
    }
  };

  // BUG-03 FIX: Return the draft list so callers can use the fresh value
  const loadDrafts = async () => {
    try {
      const result = await getDrafts();
      if (result.success) {
        const draftsList = result.data.drafts || [];
        setDrafts(draftsList);
        setMailCounts((prev) => ({
          ...prev,
          drafts: { total: draftsList.length, unread: 0 },
        }));
        return draftsList;
      } else {
        setDrafts([]);
        return [];
      }
    } catch (error) {
      setDrafts([]);
      return [];
    }
  };

  const loadFolders = async () => {
    const result = await getMailFolders();
    if (result.success) {
      // CORE-J is still open. The backend currently exposes Starred as
      // folder=4, but the star icon writes is_starred and does not move
      // rows there. Hide the nav entry until /messages/list supports
      // the cross-folder starred=true filter.
      setFolders(
        (result.data.folders || []).filter(
          (folder) => folder.name !== "starred",
        ),
      );
    } else {
      setFolders([
        { name: "inbox", displayName: "Inbox" },
        { name: "sent", displayName: "Sent" },
        { name: "drafts", displayName: "Drafts" },
        { name: "trash", displayName: "Trash" },
      ]);
    }
  };

  const loadMailCounts = async (options = {}) => {
    const { refreshInboxOnIncrease = true } = options;
    const result = await getMailCount();
    if (result.success) {
      const newCounts = result.data.counts;
      const previousMailCounts = previousMailCountsRef.current;

      if (
        refreshInboxOnIncrease &&
        previousMailCounts.inbox &&
        newCounts.inbox.total > previousMailCounts.inbox.total &&
        currentFolder === "inbox"
      ) {
        loadEmails("inbox");
      }

      if (newCounts.drafts) newCounts.drafts.unread = 0;

      // BUG-25 FIX: document.title is now managed by useEffect
      previousMailCountsRef.current = newCounts;
      setMailCounts(newCounts);
    }
    return result;
  };

  // BUG-12 FIX: Accept optional page parameter to avoid stale currentPage
  // BUG-21 FIX: Track request ID to discard stale responses
  const loadEmails = async (folder, page = null, options = {}) => {
    const { notifyOnError = true } = options;
    const requestId = ++loadEmailsRequestRef.current;
    setLoading(true);
    setSearchResultCapHit(false);

    try {
      if (folder === "drafts") {
        // BUG-03 FIX: Use returned value instead of stale closure
        const freshDrafts = await loadDrafts();
        const transformedDrafts = freshDrafts.map((draft) => {
          const body = draft.body || draft.content || "";
          const previewState = buildPreviewState(body, draft.preview);

          return {
            id: draft.id || `draft_${Date.now()}_${Math.random()}`,
            sender: "You (Draft)",
            // FIX-03: userAccount may be null briefly during initial load.
            // Use the normalized prettyAddress / pretty_address / address
            // fields; fall back to a generic placeholder rather than the
            // old placeholder address.
            senderEmail:
              userAccount?.prettyAddress ||
              userAccount?.pretty_address ||
              userAccount?.address ||
              "",
            subject: draft.subject || "No Subject",
            body,
            ...previewState,
            timestamp:
              draft.timestamp ||
              draft.created_at ||
              new Date().toLocaleTimeString(),
            isRead: true,
            isDownloaded: true,
            tags: draft.tags || [],
            starred: false,
            senderStatus: "none",
            isDraft: true,
          };
        });
        setEmails(transformedDrafts);
        return { success: true };
      }

      const effectivePage = page !== null ? page : currentPage;
      const offset = effectivePage * EMAILS_PER_PAGE;
      const result = await getMailList(folder, EMAILS_PER_PAGE, offset, sortMode);

      // BUG-21 FIX: Discard stale response if a newer request was started
      if (requestId !== loadEmailsRequestRef.current) {
        return { success: true, stale: true };
      }

      if (result.success) {
        setTotalEmailCount(result.data.totalCount);

        const transformedEmails = result.data.emails.map((email) => {
          const body = email.body || "";
          const previewState = buildPreviewState(body, email.preview);
          const senderFields = getEmailDisplayIdentityFields(email, folder);

          return {
            id: email.EmailID || email.id,
            ...senderFields,
            subject: email.Subject || email.subject || "No Subject",
            body,
            ...previewState,
            // Show the SENDER's send time (from the tell via PING/PEEK). Mail
            // received before the backend stored sent_timestamp has no send
            // time — show a dash rather than the (misleading) receive time.
            rawTimestamp: Number(
              email.SentTimestamp ||
              email.sentTimestamp ||
              email.timestamp
            ) || 0,
            timestamp: (() => {
              const sentTs =
                email.SentTimestamp || email.sentTimestamp || email.timestamp;
              return Number(sentTs) > 0 ? formatTimestamp(sentTs) : "—";
            })(),
            isRead: readEmailReadFlag(email, folder !== "inbox"),
            // /messages/list returns local DB rows; only synthetic pending rows need decrypt UI.
            isDownloaded: true,
            tags: email.tags || [],
            starred: email.isStarred || email.starred || false,
            inboxFee: email.inboxFee || email.inbox_fee || 0,
            inbox_fee: email.inbox_fee || email.inboxFee || 0,
            paymentStatus: email.paymentStatus ?? email.payment_status ?? null,
            paymentStatusText: email.paymentStatusText || email.payment_status_text || "",
            senderStatus: "none",
            // FIX: Attach the folder identity so ReadingPane knows to use "Delete Permanently"
            folder: folder,
            isTrashed: folder === 'trash'
          };
        });

        setEmails(transformedEmails);
        return result;
      } else {
        setEmails([]);
        if (notifyOnError) {
          showDashboardNotification("Failed to load qmails", "error");
        }
        return result;
      }
    } catch (error) {
      console.error("Email loading error:", error);
      if (requestId === loadEmailsRequestRef.current) {
        setEmails([]);
        if (notifyOnError) {
          showDashboardNotification("Error loading qmails", "error");
        }
      }
      return { success: false, error: error.message };
    } finally {
      if (requestId === loadEmailsRequestRef.current) {
        setLoading(false);
      }
    }
  };

  const handleFolderChange = (folder) => {
    setCurrentFolder(folder);
    setActiveView(folder);
    setSelectedEmail(null);
    // gpt-batch3 #2: invalidate any in-flight draft hydrate so it
    // doesn't pop the modal after the user navigated away.
    draftHydrateRequestRef.current += 1;
    setLoadingDraftId(null);

    // BUG-25 FIX: document.title is now managed by useEffect
    loadEmails(folder);
  };

  const handleSortChange = (newSort) => {
    // Toggle: if already active, switch back to newest; otherwise activate
    const effectiveSort = sortMode === newSort ? "newest" : newSort;
    setSortMode(effectiveSort);
    setCurrentPage(0);
    setSearchResultCapHit(false);
    // Reload with new sort — need to pass it directly since setState is async
    const requestId = ++loadEmailsRequestRef.current;
    setLoading(true);
    getMailList(currentFolder, EMAILS_PER_PAGE, 0, effectiveSort)
      .then((result) => {
        if (requestId !== loadEmailsRequestRef.current) return;
        if (result.success) {
          setTotalEmailCount(result.data.totalCount);
          const transformedEmails = result.data.emails.map((email) => {
            const body = email.body || "";
            const previewState = buildPreviewState(body, email.preview);
            const senderFields = getEmailDisplayIdentityFields(email, currentFolder);

            return {
              id: email.EmailID || email.id,
              ...senderFields,
              subject: email.Subject || email.subject || "No Subject",
              body,
              ...previewState,
              // Show the sender's send time; dash when unknown (older mail). See loadEmails().
              rawTimestamp: Number(email.SentTimestamp || email.sentTimestamp || email.timestamp) || 0,
              timestamp: (() => {
                const sentTs = email.SentTimestamp || email.sentTimestamp || email.timestamp;
                return Number(sentTs) > 0 ? formatTimestamp(sentTs) : "—";
              })(),
              isRead: readEmailReadFlag(email, currentFolder !== "inbox"),
              isDownloaded: true,
              tags: email.tags || [],
              starred: email.isStarred || email.starred || false,
              inboxFee: email.inboxFee || email.inbox_fee || 0,
              inbox_fee: email.inbox_fee || email.inboxFee || 0,
              paymentStatus: email.paymentStatus ?? email.payment_status ?? null,
              paymentStatusText: email.paymentStatusText || email.payment_status_text || "",
              senderStatus: "none",
              folder: currentFolder,
              isTrashed: currentFolder === 'trash',
            };
          });
          setEmails(transformedEmails);
        }
      })
      .catch((error) => {
        console.error("Email sort error:", error);
        if (requestId === loadEmailsRequestRef.current) {
          setEmails([]);
          showDashboardNotification("Error loading qmails", "error");
        }
      })
      .finally(() => {
        if (requestId === loadEmailsRequestRef.current) {
          setLoading(false);
        }
      });
  };

  const handleSearch = async (query) => {
    if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);
    if (query.trim() === "") {
      setSearchResultCapHit(false);
      loadEmails(currentFolder);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchEmails(query, SEARCH_RESULT_LIMIT);
      if (result.success) {
        const transformedEmails = result.data.results.map((email) => {
          const body = email.body || email.content || "";
          const previewState = buildPreviewState(
            body,
            email.preview,
            email.body_preview,
            email.snippet,
          );
          const resultFolder =
            email.folder != null
              ? (typeof email.folder === "number"
                  ? ["inbox", "sent", "drafts", "trash", "starred", "archive"][email.folder] || "inbox"
                  : email.folder)
              : currentFolder;
          const senderFields = getEmailDisplayIdentityFields(email, resultFolder);

          return {
            id: email.email_id || email.id || Date.now() + Math.random(),
            ...senderFields,
            subject: email.subject || "No Subject",
            body,
            ...previewState,
            // Sender's send time; dash when unknown (older mail). See loadEmails().
            timestamp: (() => {
              const sentTs = email.sent_timestamp || email.timestamp;
              return Number(sentTs) > 0 ? formatTimestamp(sentTs) : "—";
            })(),
            isRead: readEmailReadFlag(email, false),
            isDownloaded: true,
            tags: email.tags || [],
            starred: email.is_starred || email.starred || false,
            inboxFee: email.inbox_fee || email.inboxFee || 0,
            inbox_fee: email.inbox_fee || email.inboxFee || 0,
            paymentStatus: email.paymentStatus ?? email.payment_status ?? null,
            paymentStatusText: email.paymentStatusText || email.payment_status_text || "",
            senderStatus: "none",
            folder: resultFolder,
          };
        });
        setEmails(transformedEmails);
        setTotalEmailCount(transformedEmails.length);
        setSearchResultCapHit(transformedEmails.length === SEARCH_RESULT_LIMIT);
        setSelectedEmail(
          transformedEmails.length > 0 ? transformedEmails[0] : null,
        );
      } else {
        setSearchResultCapHit(false);
      }
      setLoading(false);
    }, 500);

    searchDebounceTimerRef.current = timer;
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRaidaEchoSnapshot(null);
    let hadFailure = false;

    const runRefreshStep = async (
      label,
      step,
      timeoutMs = REFRESH_STEP_TIMEOUT_MS,
    ) => {
      try {
        return await runWithRefreshTimeout(label, step, timeoutMs);
      } catch (error) {
        hadFailure = true;
        console.warn(`${label} refresh step failed:`, error);
        return null;
      }
    };

    try {
      await runRefreshStep("RAIDA echo", async () => {
        const result = await echoRaida();
        if (!result.success) throw new Error(result.error || "RAIDA echo failed");
        setRaidaEchoSnapshot(result.data);
        return result;
      }, RAIDA_REFRESH_TIMEOUT_MS);

      await runRefreshStep("Beacon ping", async () => {
        const result = await checkMailNow();
        if (!result.success) {
          throw new Error(result.error || "Beacon ping failed");
        }
        return result;
      });

      await runRefreshStep("Mail notifications", async () => {
        const result = await getMailNotifications();
        if (!result.success) {
          throw new Error(result.error || "Mail notifications failed");
        }
        mergePendingNotifications(result.data.notifications || []);
        return result;
      });

      await runRefreshStep("Mail counts", async () => {
        const result = await loadMailCounts();
        if (!result?.success) {
          throw new Error(result?.error || "Mail counts failed");
        }
        return result;
      });

      await runRefreshStep("Message list", async () => {
        const result = await loadEmails(currentFolder, null, {
          notifyOnError: false,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Message list failed");
        }
        return result;
      });

      showDashboardNotification(
        hadFailure
          ? "Refresh completed with some service errors."
          : "Refresh complete.",
        hadFailure ? "warning" : "success",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelectEmail = async (email) => {
    if (!email) return;

    const emailFolder = email.folder || currentFolder;
    const shouldShowDecryptAnimation =
      emailFolder === "inbox" &&
      !email.isRead &&
      isEmailExplicitlyUndownloaded(email);

    if (shouldShowDecryptAnimation) {
      const identifier = getEmailDownloadIdentifier(email);
      const pendingSelection = { ...email, isDecrypting: true };
      setSelectedEmail(pendingSelection);
      selectedEmailRef.current = pendingSelection;
      setEmailAttachments([]);
      if (identifier) {
        const revealDeadline = Date.now() + DECRYPT_REVEAL_MIN_MS;
        const existingDeadline = decryptRevealDeadlineRef.current.get(identifier) || 0;
        decryptRevealDeadlineRef.current.set(
          identifier,
          Math.max(existingDeadline, revealDeadline),
        );
        interactiveDecryptIdsRef.current.add(identifier);
        handleDownloadMail(identifier, { silent: false });
      }
      return;
    }

    if (email.isDraft) {
      // FIX-04: /db/drafts/list returns preview metadata only
      // (subject, body_preview, recipient_count, timestamps). If we
      // opened ComposeModal directly with that row, body/to/cc/bcc
      // would be empty and a Save Draft would overwrite the persisted
      // full draft with the empty fields. Fetch the full draft via
      // /db/messages/get BEFORE mounting the modal.
      if (loadingDraftId) return; // Ignore re-clicks while loading.

      // gpt-batch3 #2: capture a request id so we can detect if the
      // user clicks something else (or changes folder) while the
      // fetch is in flight. Stale results are dropped silently
      // instead of opening the modal after the user moved on.
      const requestId = ++draftHydrateRequestRef.current;
      setLoadingDraftId(email.id);
      try {
        const res = await getEmailById(email.id);
        if (draftHydrateRequestRef.current !== requestId) {
          // User moved on before this fetch completed; drop silently.
          return;
        }
        if (res.success && res.data) {
          // Merge the preview row with the fetched full body so any
          // fields ComposeModal reads (subject, body, to, cc, bcc,
          // subsubject) are populated.
          setComposeContext({
            mode: "draft",
            sourceEmail: { ...email, ...res.data },
            ownIdentity: userAccount,
            draftId: email.id
          });
          setIsComposeOpen(true);
        } else {
          showDashboardNotification("Could not load draft. Try again.", "error");
        }
      } catch (e) {
        if (draftHydrateRequestRef.current !== requestId) return;
        console.warn("Draft hydration failed:", e);
        showDashboardNotification("Could not load draft. Try again.", "error");
      } finally {
        if (draftHydrateRequestRef.current === requestId) {
          setLoadingDraftId(null);
        }
      }
      return;
    }

    // gpt-batch3 #2: any click on a non-draft message also
    // invalidates an in-flight draft hydrate. Without this, clicking
    // a regular inbox row while a draft hydrate is loading would
    // still pop the draft modal when the fetch resolved.
    if (draftHydrateRequestRef.current > 0) {
      draftHydrateRequestRef.current += 1;
      if (loadingDraftId) setLoadingDraftId(null);
    }

    setSelectedEmail(email);

    if (!email.isRead && !email.isDraft) {
      setEmails((currentEmails) =>
        currentEmails.map((e) =>
          String(e.id).toLowerCase() === String(email.id).toLowerCase()
            ? { ...e, isRead: true }
            : e,
        ),
      );
      handleMarkAsRead(email.id, true);
    }

    const canLoadStoredEmail =
      email.id &&
      !email.isDraft &&
      !email.isPending &&
      !String(email.id).startsWith("pending-");

    if (canLoadStoredEmail) {
      // FIX: Removed setLoading(true) so the list doesn't disappear and jump!
      try {
        const [attRes, bodyRes] = await Promise.allSettled([
          getEmailAttachments(email.id),
          getEmailById(email.id),
        ]);

        if (attRes.status === "fulfilled" && attRes.value.success) {
          setEmailAttachments(attRes.value.data.attachments || []);
        } else {
          setEmailAttachments([]);
        }

        if (bodyRes.status === "fulfilled" && bodyRes.value.success) {
          const fetchedData = bodyRes.value.data;
          const fetchedBody = fetchedData.body || email.body || "";
          const previewState = buildPreviewState(
            fetchedBody,
            fetchedData.preview,
          );
          const fetchedSenderFields = getEmailDisplayIdentityFields(
            {
              ...email,
              ...fetchedData,
            },
            emailFolder,
          );
          setSelectedEmail((prev) => ({
            ...prev,
            ...fetchedData,
            ...fetchedSenderFields,
            ...previewState,
            isRead: true,
            isDownloaded: true,
          }));

          setEmails((prevEmails) =>
            prevEmails.map((e) =>
              String(e.id).toLowerCase() === String(email.id).toLowerCase()
                ? {
                    ...e,
                    ...fetchedSenderFields,
                    // FIX: Ab yahan subject aur preview dono backend ke fresh data se update honge
                    subject: fetchedData.Subject || fetchedData.subject || e.subject,
                    ...previewState,
                    inboxFee: fetchedData.inboxFee || fetchedData.inbox_fee || e.inboxFee || 0,
                    inbox_fee: fetchedData.inbox_fee || fetchedData.inboxFee || e.inbox_fee || 0,
                    paymentStatus:
                      fetchedData.paymentStatus ??
                      fetchedData.payment_status ??
                      e.paymentStatus ??
                      null,
                    paymentStatusText:
                      fetchedData.paymentStatusText ||
                      fetchedData.payment_status_text ||
                      e.paymentStatusText ||
                      "",
                    body: fetchedBody || e.body,
                  }
                : e,
            ),
          );
        }
      } catch (e) {
        console.error("Failed to load full email payload", e);
        setEmailAttachments([]);
      }
      // FIX: Removed setLoading(false)
    } else {
      setEmailAttachments([]);
    }
  };

  const handleOpenCompose = () => {
    setComposeContext({
      mode: "new",
      ownIdentity: userAccount
    });
    setIsComposeOpen(true);
  };

  const resolveReplySender = async (email) => {
    const replyEmail = { ...email };
    const senderEmail = getEmailSenderAddress(email, "");

    if (senderEmail) {
      replyEmail.senderEmail = senderEmail;
      replyEmail.from = senderEmail;
      replyEmail.sender = senderEmail;
    }

    if (senderEmail && isSerialNumberText(senderEmail)) {
      const result = await convertSnToEmail(
        parseInt(senderEmail, 10),
        getEmailSenderDenomination(email),
      );
      if (result.success) {
        replyEmail.senderEmail = result.email;
        replyEmail.from = result.email;
        replyEmail.sender = result.email;
      }
    }

    return replyEmail;
  };

  const handleReply = async (email) => {
    const replyEmail = await resolveReplySender(email);
    setComposeContext({
      mode: "reply",
      sourceEmail: replyEmail,
      ownIdentity: userAccount
    });
    setIsComposeOpen(true);
  };

  const hasRecipientValue = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  };

  const hasReplyAllRecipientData = (email) =>
    hasRecipientValue(email?.to) ||
    hasRecipientValue(email?.To) ||
    hasRecipientValue(email?.to_addresses) ||
    hasRecipientValue(email?.cc) ||
    hasRecipientValue(email?.CC) ||
    hasRecipientValue(email?.cc_addresses);

  // FIX-07: handleReplyAll
  const handleReplyAll = async (email) => {
    if (!hasReplyAllRecipientData(email)) {
      showDashboardNotification(
        "Recipient list not stored with this message.",
        "warning",
      );
      return;
    }

    const replyEmail = await resolveReplySender(email);
    setComposeContext({
      mode: "replyAll",
      sourceEmail: replyEmail,
      ownIdentity: userAccount
    });
    setIsComposeOpen(true);
  };

  // FIX-06: handleForward
  const handleForward = async (email) => {
    if (
      email?.isPending ||
      email?.isDownloaded === false ||
      email?.isDownloaded === "false" ||
      email?.isDownloaded === 0
    ) {
      showDashboardNotification("Download the message first to forward.", "info");
      return;
    }

    setComposeContext({
      mode: "forward",
      sourceEmail: email,
      ownIdentity: userAccount
    });
    setIsComposeOpen(true);
  };

  const handleSendEmail = async () => {
    setIsComposeOpen(false);
    setComposeContext(null);
    showDashboardNotification("Qmail Sent!", "success");
    await loadWalletBalance();
    await loadDrafts();
    if (currentFolder === "drafts" || currentFolder === "sent") {
      await loadEmails(currentFolder);
    }
    await loadMailCounts();
  };

  const handleSignOut = () => {
    const persisted = setSkipAutoRestore();
    if (persisted) {
      clearQmailLocalStorageExceptSkip();
    }

    loadEmailsRequestRef.current += 1;
    draftHydrateRequestRef.current += 1;

    setActiveView("inbox");
    setCurrentFolder("inbox");
    setLoading(false);
    setIsRefreshing(false);
    setEmails([]);
    setDrafts([]);
    setSelectedEmail(null);
    setCurrentPage(0);
    setTotalEmailCount(0);
    setSortMode("newest");
    setMailCounts(INITIAL_MAIL_COUNTS);
    previousMailCountsRef.current = {};
    pendingMailsRef.current = [];
    mailDownloadPromisesRef.current.clear();
    interactiveDecryptIdsRef.current.clear();
    decryptRevealDeadlineRef.current.clear();
    seenNotificationIdsRef.current.clear();
    notificationPollBaselineSeenRef.current = false;
    setDecryptingMailIds(new Set());
    setRefundingEmailIds(new Set());
    setWalletBalance(null);
    setFolders([]);
    setIsComposeOpen(false);
    setComposeContext(null);
    clearAllNotifications();
    setPendingMails([]);
    setEmailAttachments([]);
    setAttachmentDownloadProgress(null);
    restoredTransfersRef.current = [];
    setRestoredTransfers([]);
    setRestoredTransferControlPending("");
    attachmentDownloadAbortRef.current?.controller?.abort();
    attachmentDownloadAbortRef.current = null;
    attachmentDownloadInProgressRef.current = false;
    attachmentCancelPendingRef.current = false;
    setPendingDangerousAttachment(null);
    setMailWalletPath(null);
    setLoadingDraftId(null);
    setUserAccount(null);

    if (onSignOut) {
      onSignOut({ persisted });
    }
  };

  // BUG-12 FIX: Pass the page number directly to avoid stale closure
  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    loadEmails(currentFolder, newPage);
  };

  const handleMarkAsRead = async (emailId, isRead = true) => {
    try {
      const result = await markEmailRead(emailId, isRead);
      if (result.success) {
        setEmails((prevEmails) =>
          prevEmails.map((email) =>
            email.id === emailId ? { ...email, isRead: isRead } : email,
          ),
        );
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail((prev) => ({ ...prev, isRead: isRead }));
        }
        await loadMailCounts();
      }
    } catch (error) {
      console.error("Mark as read error:", error);
    }
  };

  const handleToggleStar = async (emailId) => {
    // Find current starred state
    const email = emails.find((e) => String(e.id) === String(emailId));
    const newStarred = !(email?.starred);

    // Optimistic update
    setEmails((prev) =>
      prev.map((e) =>
        String(e.id) === String(emailId) ? { ...e, starred: newStarred } : e
      )
    );
    if (selectedEmail && String(selectedEmail.id) === String(emailId)) {
      setSelectedEmail((prev) => ({ ...prev, starred: newStarred }));
    }

    // Persist to backend
    try {
      const result = await starEmail(emailId, newStarred);
      if (!result.success) {
        // Revert on failure
        setEmails((prev) =>
          prev.map((e) =>
            String(e.id) === String(emailId) ? { ...e, starred: !newStarred } : e
          )
        );
      }
    } catch (error) {
      console.error("Star toggle error:", error);
    }
  };

  const handleMoveEmail = async (emailId, targetFolder) => {
    try {
      const result = await moveEmail(emailId, targetFolder);
      if (result.success) {
        setEmails((prevEmails) =>
          prevEmails.filter((email) => email.id !== emailId),
        );
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail(null);
        }
        await loadMailCounts();
      }
    } catch (error) {
      console.error("Move email error:", error);
    }
  };

  const handleDeletePendingEmail = async (pendingEmail) => {
    const identifier = getEmailDownloadIdentifier(pendingEmail);
    const source = pendingMailsRef.current.find(
      (mail) => getEmailDownloadIdentifier(mail) === identifier,
    );
    const notificationId =
      pendingEmail?.notificationId ??
      pendingEmail?.notification_id ??
      source?.notificationId ??
      source?.notification_id ??
      source?.id ??
      null;
    const fileGuid =
      pendingEmail?.fileGuid ||
      pendingEmail?.file_guid ||
      pendingEmail?.guid ||
      source?.fileGuid ||
      source?.file_guid ||
      source?.guid ||
      identifier;

    const result = await dismissMailNotification({
      id: notificationId,
      fileGuid,
    });
    if (!result.success) {
      showDashboardNotification(
        result.error || "Could not delete the pending encrypted message.",
        "error",
      );
      return;
    }

    setPendingMails((prev) => {
      const next = prev.filter(
        (mail) => getEmailDownloadIdentifier(mail) !== identifier,
      );
      pendingMailsRef.current = next;
      return next;
    });
    tellDownloadQueuedIdsRef.current.delete(identifier);
    decryptRevealDeadlineRef.current.delete(identifier);
    setMailDecrypting(identifier, false);
    if (selectedEmail && getEmailDownloadIdentifier(selectedEmail) === identifier) {
      setSelectedEmail(null);
    }
    await loadMailCounts();
    showDashboardNotification("Pending encrypted message deleted.", "success");
  };

const handleDeleteEmail = async (emailId, isPermanent = false) => {
    if (emailId && typeof emailId === "object" && emailId.isPending) {
      await handleDeletePendingEmail(emailId);
      return;
    }

    // FIX: Automatically force permanent delete if we are currently viewing the trash folder!
    const forcePermanent = isPermanent || currentFolder === "trash";

    try {
      const result = forcePermanent
        ? await deleteEmailPermanent(emailId)
        : await deleteEmail(emailId);

      if (result.success) {
        setEmails((prevEmails) => {
          const remaining = prevEmails.filter((email) => email.id !== emailId);
          // If folder is now empty after delete, navigate to inbox
          if (remaining.length === 0 && currentFolder !== "inbox") {
            setTimeout(() => handleFolderChange("inbox"), 0);
          }
          return remaining;
        });
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail(null);
        }
        loadMailCounts();
      }
    } catch (error) {
      console.error("Delete email error:", error);
    }
  };

  const handleDeleteVisibleTrash = async (visibleMessages) => {
    if (currentFolder !== "trash") return;
    const ids = visibleMessages
      .map((email) => email.id)
      .filter(Boolean);
    if (ids.length === 0) return;

    const totalBeforeDelete =
      totalEmailCount || mailCounts.trash?.total || ids.length;

    try {
      const result = await emptyTrashFolder(ids);
      const deletedCount = result.data?.deletedCount || 0;
      const remainingCount = Math.max(0, totalBeforeDelete - deletedCount);

      if (selectedEmail && ids.includes(selectedEmail.id)) {
        setSelectedEmail(null);
      }

      const nextPage =
        currentPage > 0 && currentPage * EMAILS_PER_PAGE >= remainingCount
          ? currentPage - 1
          : currentPage;
      if (nextPage !== currentPage) {
        setCurrentPage(nextPage);
      }

      await loadEmails("trash", nextPage);
      await loadMailCounts();

      if (result.success) {
        showDashboardNotification(
          remainingCount > 0
            ? `Page deleted. ${remainingCount} more message${
                remainingCount === 1 ? "" : "s"
              } remain in trash.`
            : "Trash is empty.",
          "success",
        );
        return;
      }

      showDashboardNotification(
        deletedCount > 0
          ? `${deletedCount} message${
              deletedCount === 1 ? "" : "s"
            } deleted. ${result.data.failedIds.length} could not be deleted.`
          : result.error || "Could not delete these messages.",
        "warning",
      );
    } catch (error) {
      // Trash refresh / count refresh shouldn't throw, but if they do
      // the EmailListPane confirm modal would otherwise stay open
      // because its try/finally only catches via .finally(). Surface
      // the failure as a notification and let the caller's finally
      // close the modal.
      console.error("Trash page delete error:", error);
      showDashboardNotification(
        "Could not delete these messages. Try again.",
        "error",
      );
    }
  };

  const markPaymentRefundedInState = (emailId, paymentData = {}) => {
    const normalizedEmailId = String(emailId || "").toLowerCase();
    if (!normalizedEmailId) return;

    const paymentStatusText =
      paymentData.paymentStatusText ||
      paymentData.payment_status_text ||
      "refunded";
    const paymentPatch = {
      paymentStatus: PAYMENT_STATUS_REFUNDED,
      payment_status: PAYMENT_STATUS_REFUNDED,
      paymentStatusText,
      payment_status_text: paymentStatusText,
    };

    setEmails((prevEmails) =>
      prevEmails.map((email) =>
        String(getEmailId(email)).toLowerCase() === normalizedEmailId
          ? { ...email, ...paymentPatch }
          : email,
      ),
    );

    setSelectedEmail((prev) =>
      prev && String(getEmailId(prev)).toLowerCase() === normalizedEmailId
        ? { ...prev, ...paymentPatch }
        : prev,
    );
  };

  const getRefundRecipientAddress = async (email) => {
    const replyEmail = await resolveReplySender(email);
    const recipient = getEmailSenderAddress(replyEmail, "");
    return recipient && !isSerialNumberText(recipient) ? recipient : "";
  };

  const refundEmailPayment = async (email) => {
    const emailId = getEmailId(email);
    if (!emailId || String(emailId).startsWith("pending-")) {
      return {
        success: false,
        message: "Message is not ready for refunding.",
      };
    }

    setEmailRefunding(emailId, true);
    try {
      const paymentResult = await getQMailPaymentInfo(emailId);
      if (!paymentResult.success) {
        return {
          success: false,
          message: paymentResult.error || "Could not read payment details.",
        };
      }

      const payment = paymentResult.data || {};
      if (!payment.hasPayment) {
        return {
          success: true,
          skipped: true,
          noPayment: true,
          message: "No payment is attached to this message.",
        };
      }

      const paymentStatus = payment.paymentStatus;
      const paymentStatusText = String(payment.paymentStatusText || "").toLowerCase();
      if (paymentStatus === PAYMENT_STATUS_CLAIMED || paymentStatusText === "claimed") {
        return {
          success: false,
          claimed: true,
          message: "Payment has already been claimed and cannot be refunded.",
        };
      }

      if (paymentStatus === PAYMENT_STATUS_REFUNDED || paymentStatusText === "refunded") {
        markPaymentRefundedInState(emailId, payment);
        return {
          success: true,
          skipped: true,
          alreadyRefunded: true,
          message: "Payment was already refunded.",
        };
      }

      const lockerCode = String(payment.lockerCode || "").trim();
      if (!lockerCode) {
        return {
          success: false,
          message: "Payment locker key is missing from this message.",
        };
      }

      const recipient = await getRefundRecipientAddress(email);
      if (!recipient) {
        return {
          success: false,
          message: "Could not derive the sender's QMail address for the refund.",
        };
      }

      const sendResult = await sendEmail({
        to: [recipient],
        cc: [],
        bcc: [],
        subject: buildPaymentRejectionSubject(email),
        body: buildPaymentRejectionBody(lockerCode),
      });

      if (!sendResult.success) {
        return {
          success: false,
          message: sendResult.error || "Could not send the refund message.",
        };
      }

      const markResult = await markQMailPaymentRefunded(emailId);
      if (!markResult.success) {
        return {
          success: false,
          message:
            markResult.error ||
            "Refund message was sent, but the local payment status could not be updated.",
        };
      }

      markPaymentRefundedInState(emailId, markResult.data);
      await Promise.all([loadWalletBalance(), loadMailCounts()]);
      return {
        success: true,
        refunded: true,
        message: "Payment rejected and locker key returned.",
      };
    } catch (error) {
      console.error("Payment refund failed:", error);
      return {
        success: false,
        message: error.message || "Payment refund failed.",
      };
    } finally {
      setEmailRefunding(emailId, false);
    }
  };

  const deleteMessages = async (messages, { permanent = false } = {}) => {
    const ids = [...new Set(
      (messages || [])
        .map((email) => getEmailId(email))
        .filter((id) => id && !String(id).startsWith("pending-")),
    )];
    if (ids.length === 0) return 0;

    const deleteFn = permanent ? deleteEmailPermanent : deleteEmail;
    const results = await Promise.all(
      ids.map(async (id) => ({ id, result: await deleteFn(id) })),
    );
    const deletedIds = results
      .filter(({ result }) => result.success)
      .map(({ id }) => String(id).toLowerCase());
    const deletedIdSet = new Set(deletedIds);

    if (deletedIdSet.size > 0) {
      setEmails((prevEmails) =>
        prevEmails.filter(
          (email) => !deletedIdSet.has(String(getEmailId(email)).toLowerCase()),
        ),
      );
      setSelectedEmail((prev) =>
        prev && deletedIdSet.has(String(getEmailId(prev)).toLowerCase())
          ? null
          : prev,
      );
    }

    await loadMailCounts();
    return deletedIdSet.size;
  };

  const softDeleteMessages = (messages) => deleteMessages(messages);


  const handleRefundEmails = async (messages, { deleteAfter = false } = {}) => {
    const selectedMessages = (messages || []).filter(
      (email) => email && !email.isPending,
    );
    if (selectedMessages.length === 0) return;

    let refundedCount = 0;
    let alreadyRefundedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const deleteCandidates = [];

    for (const email of selectedMessages) {
      if (!emailMayHaveRefundablePayment(email)) {
        skippedCount += 1;
        if (deleteAfter) deleteCandidates.push(email);
        continue;
      }

      const result = await refundEmailPayment(email);
      if (result.success) {
        if (result.refunded) refundedCount += 1;
        else if (result.alreadyRefunded) alreadyRefundedCount += 1;
        else skippedCount += 1;
        if (deleteAfter) deleteCandidates.push(email);
      } else {
        failedCount += 1;
      }
    }

    let deletedCount = 0;
    if (deleteAfter && deleteCandidates.length > 0) {
      deletedCount = await softDeleteMessages(deleteCandidates);
    }

    const parts = [];
    if (refundedCount > 0) {
      parts.push(`${refundedCount} payment${refundedCount === 1 ? "" : "s"} refunded`);
    }
    if (alreadyRefundedCount > 0) {
      parts.push(`${alreadyRefundedCount} already refunded`);
    }
    if (deletedCount > 0) {
      parts.push(`${deletedCount} message${deletedCount === 1 ? "" : "s"} moved to trash`);
    }
    if (failedCount > 0) {
      parts.push(`${failedCount} refund${failedCount === 1 ? "" : "s"} failed`);
    }

    if (parts.length === 0 && skippedCount > 0) {
      parts.push("No refundable payments were selected");
    }

    if (parts.length > 0) {
      showDashboardNotification(
        `${parts.join(". ")}.`,
        failedCount > 0 ? "warning" : "success",
      );
    }
  };

  const handleRejectPayment = async (email) => {
    const result = await refundEmailPayment(email);
    showDashboardNotification(
      result.message ||
        (result.success
          ? "Payment rejected and locker key returned."
          : "Could not reject this payment."),
      result.success ? "success" : "error",
    );
  };

  const getSenderActionKey = (email = {}) => {
    const senderSn = getEmailSenderSn(email);
    const denomination = getEmailSenderDenomination(email);
    if (senderSn && denomination) return `sn:${denomination}:${senderSn}`;
    if (senderSn) return `sn:${senderSn}`;

    const address = getEmailSenderAddress(email, "");
    return address ? `address:${address.toLowerCase()}` : "";
  };

  const getMessagesFromSameSender = async (sourceEmail) => {
    const senderKey = getSenderActionKey(sourceEmail);
    if (!senderKey) return [];
    const folderMessages = await fetchFolderMessagesForCommand(currentFolder);
    return folderMessages.filter(
      (email) => !email.isPending && getSenderActionKey(email) === senderKey,
    );
  };

  const buildSenderContactPayload = async (email) => {
    const senderSn = getEmailSenderSn(email);
    if (!senderSn) {
      return { success: false, error: "Sender serial number is not available." };
    }

    const denomination = getEmailSenderDenomination(email);
    const lookup = await convertSnToEmail(senderSn, denomination);
    const senderAddress = lookup.success
      ? lookup.email
      : getEmailSenderAddress(email, "");
    const nameSource = String(
      email.sender && !isSerialNumberText(email.sender)
        ? email.sender
        : senderAddress || `Sender ${senderSn}`,
    )
      .replace(/^@/, "")
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .trim();
    const nameParts = nameSource.split(/\s+/).filter(Boolean);
    const firstName = lookup.firstName || nameParts[0] || "QMail";
    const lastName = lookup.lastName || nameParts.slice(1).join(" ") || "Sender";

    return {
      success: true,
      data: {
        serial_number: String(senderSn),
        denomination: denomination ? String(denomination) : undefined,
        first_name: firstName,
        last_name: lastName,
        description: senderAddress
          ? `QMail sender ${senderAddress}`
          : "QMail sender",
      },
    };
  };

  const addSenderContact = async (email, { favorite = false } = {}) => {
    const payload = await buildSenderContactPayload(email);
    if (!payload.success) return payload;

    const contactResult = await addContact(payload.data);
    const contactAlreadyExists =
      !contactResult.success &&
      /already|exist|duplicate/i.test(String(contactResult.error || ""));
    if (!contactResult.success && !contactAlreadyExists) {
      return { success: false, error: contactResult.error || "Could not add contact." };
    }

    if (favorite) {
      const favoriteResult = await setContactFavorite(payload.data.serial_number, true);
      if (!favoriteResult.success) {
        return {
          success: false,
          error: favoriteResult.error || "Contact was added, but favorite could not be saved.",
        };
      }
    }

    return { success: true, alreadyExists: contactAlreadyExists };
  };

  const moveMessagesToFolder = async (messages, targetFolder) => {
    const ids = [...new Set(
      (messages || [])
        .map((email) => getEmailId(email))
        .filter((id) => id && !String(id).startsWith("pending-")),
    )];
    if (ids.length === 0) return 0;

    const results = await Promise.all(
      ids.map(async (id) => ({ id, result: await moveEmail(id, targetFolder) })),
    );
    const movedIds = results
      .filter(({ result }) => result.success)
      .map(({ id }) => String(id).toLowerCase());
    const movedIdSet = new Set(movedIds);

    if (movedIdSet.size > 0) {
      setEmails((prevEmails) =>
        prevEmails.filter(
          (email) => !movedIdSet.has(String(getEmailId(email)).toLowerCase()),
        ),
      );
      setSelectedEmail((prev) =>
        prev && movedIdSet.has(String(getEmailId(prev)).toLowerCase())
          ? null
          : prev,
      );
    }

    await loadMailCounts();
    return movedIdSet.size;
  };

  const handleMessageRowAction = async (email, action) => {
    if (!email || email.isPending) return;

    try {
      if (action === "add-contact" || action === "add-favorite") {
        const result = await addSenderContact(email, {
          favorite: action === "add-favorite",
        });
        showDashboardNotification(
          result.success
            ? action === "add-favorite"
              ? "Sender added to favorites."
              : "Sender added to contacts."
            : result.error || "Could not add this sender.",
          result.success ? "success" : "error",
        );
        return;
      }

      if (action === "refund") {
        await handleRefundEmails([email], { deleteAfter: false });
        return;
      }

      if (action === "refund-delete") {
        await handleRefundEmails([email], { deleteAfter: true });
        return;
      }

      if (action === "delete-from-sender") {
        const messages = await getMessagesFromSameSender(email);
        const deletedCount = await deleteMessages(messages, {
          permanent: currentFolder === "trash",
        });
        showDashboardNotification(
          deletedCount > 0
            ? `${deletedCount} message${deletedCount === 1 ? "" : "s"} deleted.`
            : "No matching messages were found.",
          deletedCount > 0 ? "success" : "info",
        );
        return;
      }

      if (action === "archive-from-sender") {
        const messages = await getMessagesFromSameSender(email);
        const movedCount = await moveMessagesToFolder(messages, "archive");
        showDashboardNotification(
          movedCount > 0
            ? `${movedCount} message${movedCount === 1 ? "" : "s"} archived.`
            : "No matching messages were found.",
          movedCount > 0 ? "success" : "info",
        );
      }
    } catch (error) {
      console.error("Message row action failed:", error);
      showDashboardNotification("Could not complete that message action.", "error");
    }
  };
  const fetchFolderMessagesForCommand = async (folder) => {
    if (folder === "drafts") {
      const result = await getDrafts();
      if (!result.success) throw new Error(result.error || "Could not load drafts.");
      return result.data?.drafts || [];
    }

    const pageSize = 200;
    let offset = 0;
    const allMessages = [];
    for (let guard = 0; guard < 100; guard += 1) {
      const result = await getMailList(folder, pageSize, offset, "newest");
      if (!result.success) throw new Error(result.error || `Could not load ${folder}.`);
      const pageMessages = result.data?.emails || [];
      allMessages.push(...pageMessages);
      const total = Number(result.data?.totalCount ?? allMessages.length);
      if (pageMessages.length < pageSize || allMessages.length >= total) break;
      offset += pageSize;
    }
    return allMessages;
  };

  const refreshFolderAfterMenuCommand = async (folder) => {
    await loadMailCounts();
    if (folder === "drafts") await loadDrafts();
    if (currentFolder === folder) {
      setCurrentPage(0);
      await loadEmails(folder, 0, { notifyOnError: false });
    }
  };

  const handleEmptyFolderCommand = async (folder) => {
    const messages = await fetchFolderMessagesForCommand(folder);
    const ids = messages.map((email) => getEmailId(email)).filter(Boolean);
    if (ids.length === 0) {
      showDashboardNotification(`${folder.charAt(0).toUpperCase() + folder.slice(1)} is already empty.`, "info");
      return;
    }

    const deletedCount = await deleteMessages(messages, {
      permanent: folder === "trash",
    });
    await refreshFolderAfterMenuCommand(folder);
    showDashboardNotification(
      deletedCount > 0
        ? `${deletedCount} ${folder} message${deletedCount === 1 ? "" : "s"} deleted.`
        : `No ${folder} messages were deleted.`,
      deletedCount > 0 ? "success" : "warning",
    );
  };

  const handleMarkAllAsReadCommand = async () => {
    const folder = currentFolder || "inbox";
    const messages = await fetchFolderMessagesForCommand(folder);
    const unreadMessages = messages.filter(
      (email) => !readEmailReadFlag(email, folder !== "inbox"),
    );

    if (unreadMessages.length === 0) {
      showDashboardNotification("No unread messages found.", "info");
      return;
    }

    const results = await Promise.all(
      unreadMessages.map(async (email) => {
        const id = getEmailId(email);
        return { id, result: id ? await markEmailRead(id, true) : { success: false } };
      }),
    );
    const updatedIds = results
      .filter(({ result }) => result.success)
      .map(({ id }) => String(id).toLowerCase());
    const updatedIdSet = new Set(updatedIds);

    if (updatedIdSet.size > 0) {
      setEmails((prevEmails) =>
        prevEmails.map((email) =>
          updatedIdSet.has(String(getEmailId(email)).toLowerCase())
            ? { ...email, isRead: true }
            : email,
        ),
      );
      setSelectedEmail((prev) =>
        prev && updatedIdSet.has(String(getEmailId(prev)).toLowerCase())
          ? { ...prev, isRead: true }
          : prev,
      );
    }

    await loadMailCounts();
    showDashboardNotification(
      `${updatedIdSet.size} message${updatedIdSet.size === 1 ? "" : "s"} marked as read.`,
      updatedIdSet.size > 0 ? "success" : "warning",
    );
  };

  const handleQmailMenuCommand = async (command) => {
    try {
      switch (command) {
        case "empty-trash":
          await handleEmptyFolderCommand("trash");
          break;
        case "empty-drafts":
          await handleEmptyFolderCommand("drafts");
          break;
        case "empty-inbox":
          await handleEmptyFolderCommand("inbox");
          break;
        case "mark-all-read":
          await handleMarkAllAsReadCommand();
          break;
        default:
          break;
      }
    } catch (error) {
      console.error("QMail menu command failed:", error);
      showDashboardNotification("Could not complete that menu command.", "error");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const unsubscribe = window.electronAPI?.onQmailMenuCommand?.((command) => {
      handleQmailMenuCommand(command);
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
    // Re-register when mailbox state changes so menu commands use fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolder, emails, selectedEmail]);

  // FIX-01: POST /api/qmail/net/messages/download returns metadata
  // (email_id, sender_sn, stripes_*), not the decrypted body. The body
  // lives in /db/messages/get afterwards. Hydrate from there.
  const hydrateDownloadedEmail = async (emailId) => {
    // Backend may lag indexing the row briefly after a successful
    // download. Retry up to 3 times with a short backoff. Each call
    // is wrapped in try/catch so a transient 5xx doesn't abort the
    // whole operation.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const [bodyRes, attRes] = await Promise.allSettled([
          getEmailById(emailId),
          getEmailAttachments(emailId),
        ]);

        if (bodyRes.status === "fulfilled" && bodyRes.value.success && bodyRes.value.data) {
          return {
            body: bodyRes.value.data,
            attachments:
              attRes.status === "fulfilled" && attRes.value.success
                ? attRes.value.data.attachments || []
                : [],
          };
        }
      } catch (e) {
        console.warn(`hydrateDownloadedEmail attempt ${attempt + 1} failed:`, e);
      }
      // gpt-batch1: only sleep between attempts, not after the last one.
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    return null;
  };

  const handleDownloadMail = async (identifier, options = {}) => {
    const normalizedIdentifier = normalizeMailIdentifier(identifier);
    if (!normalizedIdentifier) return null;

    const existingPromise = mailDownloadPromisesRef.current.get(normalizedIdentifier);
    if (existingPromise) return existingPromise;

    const { silent = false } = options;
    const shouldNotifyFailure = () =>
      !silent || interactiveDecryptIdsRef.current.has(normalizedIdentifier);

    const downloadPromise = (async () => {
      setMailDecrypting(normalizedIdentifier, true);
      try {
        const isLocalEmailId =
          normalizedIdentifier.length === 32 &&
          !String(identifier || "").startsWith("pending-");
        const hasPendingTell = pendingMailsRef.current.some(
          (mail) => getEmailDownloadIdentifier(mail) === normalizedIdentifier,
        );

        let hydrated;

        if (isLocalEmailId && !hasPendingTell) {
          try {
            hydrated = await hydrateDownloadedEmail(normalizedIdentifier);
          } catch (e) {
            console.warn("Local DB short-circuit failed; falling through to network:", e);
          }
        }

        if (!hydrated) {
          // Background (silent) downloads use the async/202 path so the
          // single-threaded backend doesn't block other requests for the
          // whole download. Interactive opens stay synchronous so the body
          // is ready to render immediately.
          const downloadRes = await downloadEmailContent(normalizedIdentifier, {
            background: silent,
          });
          const downloadData = downloadRes.data || downloadRes;

          const downloadOk =
            downloadRes.success ||
            downloadData.status === "success" ||
            downloadData.status === "accepted" ||
            downloadData.email_id;

          if (!downloadOk) {
            if (shouldNotifyFailure()) {
              showDashboardNotification(formatDecryptErrorNotification(normalizeQmailDecryptError(downloadRes)), "error");
            }
            return null;
          }

          // Async hand-off (202 Accepted): the backend is downloading on a
          // worker thread and will emit an SSE "new-mail" event when the row
          // is stored. Nothing to hydrate yet; leave the pending row in place
          // and let the SSE handler refresh the inbox.
          if (downloadData.status === "accepted" && !downloadData.email_id) {
            return null;
          }

          const emailId = downloadData.email_id || (isLocalEmailId ? normalizedIdentifier : null);

          if (!emailId) {
            if (shouldNotifyFailure()) {
              showDashboardNotification(formatDecryptErrorNotification(normalizeQmailDecryptError(downloadRes)), "error");
            }
            return null;
          }

          hydrated = await hydrateDownloadedEmail(emailId);

          if (!hydrated) {
            if (shouldNotifyFailure()) {
              showDashboardNotification(
                formatDecryptErrorNotification(normalizeQmailDecryptError(
                  { message: "Message downloaded but could not be loaded locally." },
                  "Message downloaded but could not be loaded locally.",
                )),
                "warning",
              );
            }
            return null;
          }
        }

        await waitForDecryptReveal(normalizedIdentifier);

        const decryptedBody = hydrated.body.body || "";
        const decryptedSubject = hydrated.body.subject || hydrated.body.Subject || "";
        const incomingAttachments = hydrated.attachments;
        const hydratedId = hydrated.body.email_id || hydrated.body.EmailID || normalizedIdentifier;
        const previewState = buildPreviewState(decryptedBody, hydrated.body.preview);
        const hydratedSenderFields = getEmailSenderFields(hydrated.body);
        const shouldMarkRead = interactiveDecryptIdsRef.current.has(normalizedIdentifier);
        const hydratedIsRead =
          shouldMarkRead ||
          hydrated.body.isRead === true ||
          hydrated.body.is_read === true ||
          hydrated.body.isRead === 1 ||
          hydrated.body.is_read === 1;

        const hydratedRow = {
          id: hydratedId,
          ...hydratedSenderFields,
          subject: decryptedSubject || "No Subject",
          body: decryptedBody,
          ...previewState,
          rawTimestamp: Number(
            hydrated.body.ReceivedTimestamp ||
              hydrated.body.receivedTimestamp ||
              hydrated.body.timestamp,
          ) || 0,
          timestamp: formatTimestamp(
            hydrated.body.ReceivedTimestamp ||
              hydrated.body.receivedTimestamp ||
              hydrated.body.timestamp,
          ),
          isRead: hydratedIsRead,
          isDownloaded: true,
          tags: hydrated.body.tags || [],
          starred: hydrated.body.isStarred || hydrated.body.starred || false,
          inboxFee: hydrated.body.inboxFee || hydrated.body.inbox_fee || 0,
          inbox_fee: hydrated.body.inbox_fee || hydrated.body.inboxFee || 0,
          paymentStatus: hydrated.body.paymentStatus ?? hydrated.body.payment_status ?? null,
          paymentStatusText: hydrated.body.paymentStatusText || hydrated.body.payment_status_text || "",
          senderStatus: "none",
          folder: "inbox",
          isTrashed: false,
        };

        const viewingInbox = currentFolderRef.current === "inbox";

        if (viewingInbox) {
          setEmails((prev) => {
            const existingIdx = prev.findIndex(
              (e) =>
                e.id === normalizedIdentifier ||
                e.guid === normalizedIdentifier ||
                e.id === hydratedId,
            );
            if (existingIdx >= 0) {
              const next = prev.slice();
              next[existingIdx] = { ...prev[existingIdx], ...hydratedRow };
              return next;
            }
            return [hydratedRow, ...prev];
          });
        }

        setPendingMails((prev) => {
          const next = prev.filter(
            (m) => normalizeMailIdentifier(m.guid || m.file_guid) !== normalizedIdentifier,
          );
          pendingMailsRef.current = next;
          return next;
        });

        const currentSel = selectedEmailRef.current;
        const stillSelected =
          currentSel &&
          (getEmailDownloadIdentifier(currentSel) === normalizedIdentifier ||
            currentSel.id === hydratedId);

        if (stillSelected) {
          setSelectedEmail((prev) => ({
            ...prev,
            ...hydrated.body,
            ...hydratedSenderFields,
            body: decryptedBody,
            subject: decryptedSubject || prev?.subject,
            isDownloaded: true,
            isPending: false,
            isDecrypting: false,
            isRead: hydratedIsRead,
          }));
          setEmailAttachments(incomingAttachments);
        }

        if (shouldMarkRead && hydratedId) {
          markEmailRead(hydratedId, true).catch((e) =>
            console.warn("markEmailRead after hydrate failed:", e),
          );
        }

        if (viewingInbox) {
          loadEmails("inbox");
        }
        loadMailCounts();

        return hydratedRow;
      } catch (error) {
        console.error("Download failed:", error);
        if (shouldNotifyFailure()) {
          showDashboardNotification(formatDecryptErrorNotification(normalizeQmailDecryptError(error, "Download failed.")), "error");
        }
        return null;
      } finally {
        interactiveDecryptIdsRef.current.delete(normalizedIdentifier);
        decryptRevealDeadlineRef.current.delete(normalizedIdentifier);
        setSelectedEmail((prev) =>
          prev &&
          prev.isPending &&
          getEmailDownloadIdentifier(prev) === normalizedIdentifier
            ? { ...prev, isDecrypting: false }
            : prev,
        );
        setMailDecrypting(normalizedIdentifier, false);
        mailDownloadPromisesRef.current.delete(normalizedIdentifier);
      }
    })();

    mailDownloadPromisesRef.current.set(normalizedIdentifier, downloadPromise);
    return downloadPromise;
  };

  // Re-fetch the open email's attachment rows so a just-completed on-demand
  // download flips the row from PENDING (storage_mode 2) to downloaded, which
  // clears the "Click to download" affordance in the reading pane.
  const refreshEmailAttachments = async (emailId) => {
    if (!emailId) return;
    try {
      const attRes = await getEmailAttachments(emailId);
      if (attRes && attRes.success) {
        setEmailAttachments(attRes.data.attachments || []);
      }
    } catch (error) {
      console.warn("Failed to refresh attachments:", error);
    }
  };

  const performAttachmentDownload = async ({
    emailId,
    attachmentId,
    attachmentName,
    attachmentSize,
  }) => {
    if (
      attachmentDownloadInProgressRef.current ||
      attachmentCancelPendingRef.current
    ) {
      return {
        success: false,
        error: "Another attachment download operation is still finishing.",
      };
    }
    attachmentDownloadInProgressRef.current = true;
    const transferKey = `${emailId}:${attachmentId}`;
    const controller = new AbortController();
    attachmentDownloadAbortRef.current = {
      transferKey,
      controller,
    };
    const expectedBytes =
      Number.isFinite(Number(attachmentSize)) && Number(attachmentSize) > 0
        ? Math.trunc(Number(attachmentSize))
        : 0;
    setAttachmentDownloadProgress({
      transferKey,
      emailId,
      attachmentId,
      completedBytes: "0",
      totalBytes: String(expectedBytes),
      percentage: 0,
      status: "running",
      operationId: null,
      transferError: null,
      request: {
        emailId,
        attachmentId,
        attachmentName,
        attachmentSize,
      },
    });

    let completedSuccessfully = false;
    let durableOperationId = null;
    try {
      showDashboardNotification(
        `Downloading ${attachmentName || "attachment"}...`,
        "info",
      );
      const downloadResult = await downloadMailAttachment(
        emailId,
        attachmentId,
        attachmentName,
        {
          expectedBytes,
          signal: controller.signal,
          onProgress: (nextProgress) => {
            if (
              nextProgress.operationId &&
              durableOperationId !== nextProgress.operationId
            ) {
              durableOperationId = nextProgress.operationId;
              rememberActiveTransfer({
                operationId: durableOperationId,
                direction: "download",
                label: attachmentName || "Attachment download",
                emailId,
                attachmentId,
                attachmentName,
                totalBytes:
                  nextProgress.totalBytes !== "0"
                    ? nextProgress.totalBytes
                    : String(expectedBytes),
                completedBytes: nextProgress.completedBytes,
                state: "downloading",
              });
            }
            setAttachmentDownloadProgress((current) =>
              current?.transferKey === transferKey
                ? {
                    ...current,
                    completedBytes: nextProgress.completedBytes,
                    totalBytes:
                      nextProgress.totalBytes !== "0"
                        ? nextProgress.totalBytes
                        : current.totalBytes,
                    percentage: nextProgress.percentage,
                    operationId:
                      nextProgress.operationId || current.operationId,
                    status: "running",
                  }
                : current,
            );
          },
        },
      );
      if (downloadResult?.status === "aborted") {
        setAttachmentDownloadProgress((current) =>
          current?.transferKey === transferKey
            ? {
                ...current,
                status: "cancelled",
                error: null,
                transferError: normalizeTransferError({
                  state: "cancelled",
                  error: "Attachment download was cancelled.",
                }),
              }
            : current,
        );
        showDashboardNotification("Attachment download cancelled.", "info");
        return downloadResult;
      }
      if (!downloadResult?.success) {
        const downloadError = new Error(
          downloadResult?.error || "Attachment download failed",
        );
        downloadError.transferError =
          downloadResult?.transferError || null;
        throw downloadError;
      }
      const filename = downloadResult?.data?.filename || attachmentName || "attachment";
      const completedOperationId =
        downloadResult?.data?.operationId || durableOperationId;
      if (completedOperationId) {
        forgetActiveTransfer(completedOperationId);
      }
      const downloadsDir = window.electronAPI?.getDownloadsDir
        ? await window.electronAPI.getDownloadsDir()
        : null;
      const savedPath = joinDisplayPath(downloadsDir, filename);
      showDashboardNotification(
        savedPath
          ? `Saved ${filename} to ${savedPath}`
          : `Saved ${filename} to your Downloads folder`,
        "success",
      );
      completedSuccessfully = true;
      // The bytes now live on disk; reflect that in the open email.
      try {
        await refreshEmailAttachments(emailId);
      } catch (refreshError) {
        console.warn(
          "Attachment saved, but the attachment list could not be refreshed:",
          refreshError,
        );
      }
      return downloadResult;
    } catch (error) {
      console.error("Attachment download failed:", error);
      const transferError =
        error?.transferError ||
        normalizeTransferError(error, {
          fallbackMessage: error.message || "Attachment download failed",
          terminal: true,
          defaultCanRetry: true,
        });
      if (durableOperationId) {
        rememberActiveTransfer({
          operationId: durableOperationId,
          direction: "download",
          label: attachmentName || "Attachment download",
          emailId,
          attachmentId,
          attachmentName,
          totalBytes: String(expectedBytes),
          state: "failed",
          error:
            transferError?.message ||
            error.message ||
            "Attachment download failed",
        });
      }
      setAttachmentDownloadProgress((current) =>
        current?.transferKey === transferKey
          ? {
              ...current,
              status: "failed",
              error:
                transferError?.message ||
                error.message ||
                "Attachment download failed",
              transferError,
            }
          : current,
      );
      showDashboardNotification(
        formatTransferErrorNotification(
          transferError,
          error.message || "Failed to download attachment",
        ),
        "error",
      );
      return {
        success: false,
        error: transferError?.message || error.message,
        transferError,
      };
    } finally {
      if (attachmentDownloadAbortRef.current?.transferKey === transferKey) {
        attachmentDownloadAbortRef.current = null;
      }
      attachmentDownloadInProgressRef.current = false;
      if (completedSuccessfully) {
        setAttachmentDownloadProgress((current) =>
          current?.transferKey === transferKey ? null : current,
        );
      }
    }
  };

  const handleCancelAttachmentDownload = async () => {
    const current = attachmentDownloadProgress;
    if (
      !current ||
      current.status !== "running" ||
      attachmentCancelPendingRef.current
    ) {
      return;
    }
    attachmentCancelPendingRef.current = true;

    setAttachmentDownloadProgress((progress) =>
      progress
        ? {
            ...progress,
            status: "cancelling",
          }
        : progress,
    );

    if (current.operationId) {
      rememberActiveTransfer({
        operationId: current.operationId,
        direction: "download",
        state: "cancelling",
      });
    }
    attachmentDownloadAbortRef.current?.controller.abort();

    try {
      if (current.operationId) {
        const cancelResult = await cancelObjectTransfer(current.operationId);
        if (!cancelResult.success) {
          console.warn(
            "Durable attachment transfer cancellation failed:",
            cancelResult.error,
          );
        }
      }
    } finally {
      attachmentCancelPendingRef.current = false;
    }
  };

  const handleResumeAttachmentDownload = async () => {
    const current = attachmentDownloadProgress;
    if (
      !current ||
      !["cancelled", "failed", "paused"].includes(current.status) ||
      !current.request ||
      attachmentDownloadInProgressRef.current ||
      attachmentCancelPendingRef.current
    ) {
      return;
    }

    if (current.status === "paused" && current.operationId) {
      const resumeResult = await resumeObjectTransfer(current.operationId);
      if (!resumeResult.success) {
        const transferError =
          resumeResult.transferError ||
          normalizeTransferError(resumeResult, {
            fallbackMessage:
              resumeResult.error || "Could not resume download",
            terminal: true,
          });
        setAttachmentDownloadProgress((progress) =>
          progress
            ? {
                ...progress,
                error:
                  transferError?.message ||
                  resumeResult.error ||
                  "Could not resume download",
                transferError,
              }
            : progress,
        );
        showDashboardNotification(
          formatTransferErrorNotification(
            transferError,
            resumeResult.error || "Could not resume attachment download.",
          ),
          "error",
        );
        return;
      }
      rememberActiveTransfer({
        operationId: current.operationId,
        direction: "download",
        state: "downloading",
      });
    }

    await performAttachmentDownload(current.request);
  };

  const handleOpenDownloadLocation = async () => {
    if (!mailWalletPath || !window.electronAPI?.revealPath) return;
    const result = await window.electronAPI.revealPath(mailWalletPath);
    if (!result?.success) {
      showDashboardNotification(
        result?.error || "Could not open the download location.",
        "error",
      );
    }
  };

  const handleDownloadAttachment = async (emailId, attachmentId, attachment) => {
    const attachmentName =
      typeof attachment === "string" ? attachment : attachment?.name;
    const downloadRequest = {
      emailId,
      attachmentId,
      attachmentName,
      attachmentSize:
        typeof attachment === "object" && attachment
          ? attachment.size
          : 0,
      warning:
        typeof attachment === "object" && attachment
          ? attachment.warning
          : "",
    };

    if (typeof attachment === "object" && attachment?.dangerous === true) {
      setPendingDangerousAttachment(downloadRequest);
      return;
    }

    await performAttachmentDownload(downloadRequest);
  };

  const handleConfirmDangerousAttachment = async () => {
    const downloadRequest = pendingDangerousAttachment;
    setPendingDangerousAttachment(null);
    if (downloadRequest) {
      await performAttachmentDownload(downloadRequest);
    }
  };

  const focusPendingMail = (guid) => {
    const pendingRow = formattedPendingMails.find((mail) => mail.guid === guid);
    if (!pendingRow) return;

    setActiveView("inbox");
    setCurrentFolder("inbox");
    currentFolderRef.current = "inbox";
    handleSelectEmail(pendingRow);
    if (currentFolder !== "inbox") {
      loadEmails("inbox");
    }
  };

  const focusInboxEmail = (emailId) => {
    if (!emailId) return;
    setActiveView("inbox");
    setCurrentFolder("inbox");
    const existing = emails.find(
      (mail) => String(mail.id).toLowerCase() === String(emailId).toLowerCase(),
    );
    if (existing) {
      setSelectedEmail(existing);
      return;
    }
    loadEmails("inbox");
  };

  const updateRestoredTransferStatus = (operationId, status) => {
    rememberActiveTransfer({
      operationId,
      direction: status.direction,
      state: status.state,
      completedBytes: status.completedBytes,
      totalBytes: status.totalBytes,
      error: status.error,
      destinationPath: status.destinationPath,
    });
    setRestoredTransfers((current) =>
      current.map((entry) =>
        entry.operationId === operationId
          ? {
              ...entry,
              status,
              lookupError: null,
              transferError: status.transferError || null,
            }
          : entry,
      ),
    );
  };

  const handleCancelRestoredTransfer = async (operationId) => {
    if (restoredTransferControlPending) return;
    setRestoredTransferControlPending(operationId);
    const result = await cancelObjectTransfer(operationId);
    if (result.success) {
      updateRestoredTransferStatus(operationId, result.data);
    } else {
      setRestoredTransfers((current) =>
        current.map((entry) =>
          entry.operationId === operationId
            ? {
                ...entry,
                lookupError: result.error,
                transferError: result.transferError || null,
              }
            : entry,
        ),
      );
      showDashboardNotification(
        formatTransferErrorNotification(
          result.transferError,
          result.error || "Could not cancel transfer.",
        ),
        "error",
      );
    }
    setRestoredTransferControlPending("");
  };

  const handleResumeRestoredTransfer = async (operationId) => {
    if (restoredTransferControlPending) return;
    setRestoredTransferControlPending(operationId);
    const result = await resumeObjectTransfer(operationId);
    if (result.success) {
      updateRestoredTransferStatus(operationId, result.data);
    } else {
      setRestoredTransfers((current) =>
        current.map((entry) =>
          entry.operationId === operationId
            ? {
                ...entry,
                lookupError: result.error,
                transferError: result.transferError || null,
              }
            : entry,
        ),
      );
      showDashboardNotification(
        formatTransferErrorNotification(
          result.transferError,
          result.error || "Could not resume transfer.",
        ),
        "error",
      );
    }
    setRestoredTransferControlPending("");
  };

  const handleDismissRestoredTransfer = (operationId) => {
    forgetActiveTransfer(operationId);
    setRestoredTransfers((current) =>
      current.filter((entry) => entry.operationId !== operationId),
    );
  };

  const handleOpenRestoredTransferPath = async (targetPath) => {
    if (!targetPath || !window.electronAPI?.revealPath) return;
    const result = await window.electronAPI.revealPath(targetPath);
    if (!result?.success) {
      showDashboardNotification(
        result?.error || "Could not open the downloaded file.",
        "error",
      );
    }
  };

  return (
    <main className="qmail-dashboard">
      <ActiveTransfersPanel
        transfers={restoredTransfers}
        pendingOperationId={restoredTransferControlPending}
        onCancel={handleCancelRestoredTransfer}
        onResume={handleResumeRestoredTransfer}
        onDismiss={handleDismissRestoredTransfer}
        onOpenPath={handleOpenRestoredTransferPath}
      />
      {pendingDangerousAttachment && (
        <div
          className="qmail-dashboard__attachment-confirm-overlay"
          role="presentation"
          onClick={() => setPendingDangerousAttachment(null)}
        >
          <section
            className="qmail-dashboard__attachment-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dangerous-attachment-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="qmail-dashboard__attachment-confirm-header">
              <ShieldAlert size={22} />
              <h3
                id="dangerous-attachment-title"
                className="qmail-dashboard__attachment-confirm-title"
              >
                Potentially Dangerous Attachment
              </h3>
            </header>
            <p className="qmail-dashboard__attachment-confirm-copy">
              This file is flagged as potentially dangerous. Save anyway?
            </p>
            {pendingDangerousAttachment.attachmentName && (
              <p className="qmail-dashboard__attachment-confirm-filename">
                {pendingDangerousAttachment.attachmentName}
              </p>
            )}
            {pendingDangerousAttachment.warning && (
              <p className="qmail-dashboard__attachment-confirm-warning">
                {pendingDangerousAttachment.warning}
              </p>
            )}
            <footer className="qmail-dashboard__attachment-confirm-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPendingDangerousAttachment(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleConfirmDangerousAttachment}
              >
                Save Anyway
              </button>
            </footer>
          </section>
        </div>
      )}

      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => {
          setIsComposeOpen(false);
          setComposeContext(null);
          if (currentFolder === "drafts") {
            loadEmails("drafts");
          }
        }}
        onSend={handleSendEmail}
        onSendFailure={(message) =>
          showDashboardNotification(message || "Failed to send qmail", "error")
        }
        composeContext={composeContext}
        walletBalance={walletBalance}
        onDraftSaved={async () => {
          if (currentFolder === "drafts") {
            await loadEmails("drafts");
          }
          await loadMailCounts();
        }}
      />

      <WalletActionModal
        isOpen={Boolean(walletActionMode)}
        initialMode={walletActionMode || "add"}
        walletBalance={walletBalance}
        onClose={handleCloseWalletAction}
        onWalletUpdated={handleWalletUpdated}
      />
      <NavigationPane
        activeView={activeView}
        setActiveView={handleFolderChange}
        onComposeClick={handleOpenCompose}
        mailCounts={mailCounts}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        walletBalance={walletBalance}
        onAddFundsClick={() => handleOpenWalletAction("add")}
        onWithdrawClick={() => handleOpenWalletAction("withdraw")}
        folders={folders}
        raidaEchoSnapshot={raidaEchoSnapshot}
      />

      {(activeView === "inbox" ||
        activeView === "sent" ||
        activeView === "drafts" ||
        activeView === "trash" ||
        activeView === "archive") && (
        <>
          <EmailListPane
            emails={displayEmails}
            onSelectEmail={handleSelectEmail}
            selectedEmail={selectedEmail}
            onSearch={handleSearch}
            isLoading={loading}
            currentFolder={currentFolder}
            currentPage={currentPage}
            totalCount={totalEmailCount}
            onPageChange={handlePageChange}
            onMarkAsRead={handleMarkAsRead}
            onDeleteEmail={handleDeleteEmail}
            onDeleteVisibleTrash={handleDeleteVisibleTrash}
            onRowAction={handleMessageRowAction}
            onToggleStar={handleToggleStar}
            sortMode={sortMode}
            onSortChange={handleSortChange}
            loadingDraftId={loadingDraftId}
            searchResultCapHit={searchResultCapHit}
            pageSize={EMAILS_PER_PAGE}
            qmailAddress={qmailAddress}
          />
          {!isComposeOpen && (
            <ReadingPane
              email={selectedEmail}
              isDecrypting={
                !!selectedEmail &&
                (decryptingMailIds.has(getEmailDownloadIdentifier(selectedEmail)) ||
                  selectedEmail.isDecrypting)
              }
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onMarkAsRead={handleMarkAsRead}
              onDeleteEmail={handleDeleteEmail}
              onMoveEmail={handleMoveEmail}
              onRejectPayment={handleRejectPayment}
              isRejectingPayment={
                !!selectedEmail &&
                refundingEmailIds.has(String(getEmailId(selectedEmail)).toLowerCase())
              }
              attachments={emailAttachments}
              attachmentDownloadProgress={attachmentDownloadProgress}
              onCancelAttachmentDownload={handleCancelAttachmentDownload}
              onResumeAttachmentDownload={handleResumeAttachmentDownload}
              downloadLocation={mailWalletPath}
              onOpenDownloadLocation={handleOpenDownloadLocation}
              onDownloadAttachment={handleDownloadAttachment}
            />
          )}
        </>
      )}

      {activeView === "contacts" && <ContactsPane />}
      {activeView === "account" && (
        <AccountPane
          userAccount={userAccount}
          onSignOut={handleSignOut}
        />
      )}
    </main>
  );
};

export default QMailDashboard;
