// --- src/api/qmailApiServices.js ---
// This file contains all QMail-specific API call functions.

import {
  formatQmailAddress,
  parseQmailAddress,
} from "../qmail/address/qmailAddress";
import { normalizeTransferError } from "../qmail/transferErrors";
import { BUILD_DATE } from "../version";

// Port resolution priority:
//   1. ?backendPort=N in the URL — set by Electron at boot to support
//      multi-instance (every QMail.exe picks its own free port).
//   2. VITE_API_PORT env var — for dev workflows that prefer a fixed
//      port (e.g. when running rest_core manually).
//   3. 8080 fallback — historical default.
const readPortFromQuery = () => {
  if (typeof window === "undefined" || !window.location) return null;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("backendPort");
  return fromUrl && /^\d+$/.test(fromUrl) ? fromUrl : null;
};
const API_PORT =
  readPortFromQuery() ||
  import.meta.env.VITE_API_PORT ||
  "8080";
const API_BASE_URL = `http://localhost:${API_PORT}/api`;
const parsedApiPort = Number(API_PORT);
const BEACON_CHECK_TIMEOUT_MS = 5000;

// SSE event stream listens on http_port + 100 — see rest_core sse_server.c
// and docs/opu.sse.plan.txt. Multi-instance (8080/8081/8082) maps to
// (8180/8181/8182), no collisions. Used by QMailDashboard's useEffect to
// open an EventSource for real-time new-mail notifications.
export const SSE_URL =
  Number.isInteger(parsedApiPort) &&
  parsedApiPort >= 0 &&
  parsedApiPort <= 65435
    ? `http://localhost:${parsedApiPort + 100}/events`
    : null;

const extractApiErrorMessage = (data, fallback) => {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }

  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail;
  }

  if (typeof data.details === "string" && data.details.trim()) {
    return data.details;
  }

  if (typeof data.error === "string" && data.error.trim()) {
    return data.error;
  }

  return fallback;
};

const isTruthyApiFlag = (value) =>
  value === true || value === 1 || value === "1" || value === "true";

/**
 * A helper function to handle fetch responses.
 * It reads the exact backend error payload even on non-ok responses.
 * @param {Response} response - The fetch Response object
 */
const handleResponse = async (response) => {
  let data;

  try {
    // 1. Always attempt to parse the JSON first, even if it's an error status
    data = await response.json();
  } catch (e) {
    // 2. If it's not JSON (like a raw server crash or HTML page) and not OK, throw standard error
    if (!response.ok) {
      throw new Error(
        `Server responded with ${response.status} ${response.statusText}`,
      );
    }
    return null;
  }

  // 3. If the status is a 4xx or 5xx error, extract the backend message
  if (!response.ok) {
    const backendError = extractApiErrorMessage(
      data,
      `Server responded with ${response.status}`,
    );
    const error = new Error(backendError);
    error.httpStatus = response.status;
    error.apiData = data;
    throw error;
  }

  return data;
};

// API-FIX: Backend uses integer folder IDs, GUI uses string names
const FOLDER_NAME_TO_ID = {
  inbox: 0, sent: 1, drafts: 2, trash: 3, starred: 4, archive: 5
};
const FOLDER_ID_TO_NAME = {
  0: 'inbox', 1: 'sent', 2: 'drafts', 3: 'trash', 4: 'starred', 5: 'archive'
};
function folderNameToId(name) {
  if (typeof name === 'number') return name;
  return FOLDER_NAME_TO_ID[name?.toLowerCase()] ?? 0;
}
function folderIdToName(id) {
  if (typeof id === 'string') return id;
  return FOLDER_ID_TO_NAME[id] ?? 'inbox';
}

const QMAIL_DENOMINATION_CODE_TO_VALUE = {
  0: 1,
  1: 10,
  2: 100,
  3: 1000,
  4: 10000,
};

// Reverse of QMAIL_DENOMINATION_CODE_TO_VALUE: a denomination *value*
// (1/10/100/1000/10000) back to its 0-4 code. Used when the backend sends the
// value but not the explicit code.
const denominationValueToCode = (value) => {
  const entry = Object.entries(QMAIL_DENOMINATION_CODE_TO_VALUE).find(
    ([, v]) => v === value,
  );
  return entry ? Number(entry[0]) : null;
};

// Recover { serialNumber, denominationCode } from a canonical dotted-decimal
// address like "25.165@giga". Returns null when the string is missing or not a
// parseable address. This is the resilience path for Sent/Drafts rows: the
// backend may carry the recipient's address but omit the explicit denomination
// code, which would otherwise default the cartouche/suffix to "bit".
const parseAddressIdentity = (address) => {
  if (typeof address !== "string" || address.trim() === "") return null;
  const parsed = parseQmailAddress(address.trim());
  return parsed && parsed.ok ? parsed : null;
};

const readNumericApiField = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
};

const getSenderSerialNumber = (source = {}) => {
  const sn = readNumericApiField(source.sender_sn, source.senderSn);
  return sn && sn > 0 ? sn : null;
};

const getSenderDenominationCode = (source = {}) => {
  const code = readNumericApiField(
    source.sender_denomination_code,
    source.senderDenominationCode,
  );
  return code !== null && code >= 0 && code <= 4 ? code : null;
};

const getSenderDenominationValue = (source = {}) => {
  const value = readNumericApiField(
    source.sender_denomination,
    source.senderDenomination,
  );
  if (value && value > 0) return value;

  const code = getSenderDenominationCode(source);
  return code !== null ? QMAIL_DENOMINATION_CODE_TO_VALUE[code] : null;
};

const isSerialNumberText = (value) =>
  typeof value === "string" && /^\d+$/.test(value.trim());

const getSenderAddress = (source = {}, fallback = "Unknown Sender") => {
  const address = [
    source.sender_address,
    source.senderAddress,
    source.senderEmail,
    source.from,
    source.sender,
  ].find(
    (value) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      !isSerialNumberText(value) &&
      !/^SN#/i.test(value.trim()) &&
      !/^Unknown( Sender)?$/i.test(value.trim()),
  );

  if (address) return address.trim();

  // No text address from the backend: synthesize the canonical
  // dotted-decimal form ("51.254@bit") when we know both the serial
  // number and the denomination code; fall back to the bare SN.
  const senderSn = getSenderSerialNumber(source);
  if (senderSn) {
    const canonical = formatQmailAddress(
      senderSn,
      getSenderDenominationCode(source),
    );
    return canonical || String(senderSn);
  }

  const serialText = [source.senderEmail, source.from, source.sender].find(
    (value) => typeof value === "string" && isSerialNumberText(value),
  );
  return serialText ? serialText.trim() : fallback;
};

const withSenderFields = (source = {}, fallback = "Unknown Sender") => {
  const senderSn = getSenderSerialNumber(source);
  const senderDenominationCode = getSenderDenominationCode(source);
  const senderDenomination = getSenderDenominationValue(source);
  const senderAddress = getSenderAddress(source, senderSn ? String(senderSn) : fallback);
  const senderEmail =
    senderAddress && (senderAddress !== fallback || senderSn) ? senderAddress : "";

  return {
    sender: senderAddress || fallback,
    senderEmail,
    from: senderEmail,
    sender_address: senderEmail,
    senderSn,
    sender_sn: senderSn,
    senderDenomination,
    sender_denomination: senderDenomination,
    senderDenominationCode: senderDenominationCode,
    sender_denomination_code: senderDenominationCode,
  };
};

// For Sent/Drafts the GUI shows the recipient ("To"), not the sender. The
// list endpoint now carries the primary recipient (recipient_sn /
// recipient_address / recipient_denomination_code) plus recipient_count.
// Mirror withSenderFields() so the dashboard can swap in recipient identity.
// Serial number, falling back to the one parsed from recipient_address.
const getRecipientSerialNumber = (source = {}, parsedAddress = null) => {
  const sn = readNumericApiField(source.recipient_sn, source.recipientSn);
  if (sn && sn > 0) return sn;
  return parsedAddress && parsedAddress.serialNumber > 0
    ? parsedAddress.serialNumber
    : null;
};

// Denomination code (0-4) with precedence: explicit code → value-derived code
// (recipient_denomination as 1/10/100/1000/10000) → code parsed from
// recipient_address. Only returns null when none are available, so a present
// recipient address never gets silently mislabeled as "bit" (code 0).
const getRecipientDenominationCode = (source = {}, parsedAddress = null) => {
  const code = readNumericApiField(
    source.recipient_denomination_code,
    source.recipientDenominationCode,
  );
  if (code !== null && code >= 0 && code <= 4) return code;

  const value = readNumericApiField(
    source.recipient_denomination,
    source.recipientDenomination,
  );
  const codeFromValue = value !== null ? denominationValueToCode(value) : null;
  if (codeFromValue !== null) return codeFromValue;

  return parsedAddress ? parsedAddress.denominationCode : null;
};

const withRecipientFields = (source = {}) => {
  // Parse recipient_address once so SN and denomination can both fall back to it
  // when the backend omits the explicit numeric fields.
  const parsedAddress = parseAddressIdentity(source.recipient_address);
  const recipientSn = getRecipientSerialNumber(source, parsedAddress);
  const recipientDenominationCode = getRecipientDenominationCode(
    source,
    parsedAddress,
  );
  const recipientDenomination =
    recipientDenominationCode !== null
      ? QMAIL_DENOMINATION_CODE_TO_VALUE[recipientDenominationCode]
      : null;
  const recipientAddress =
    typeof source.recipient_address === "string" &&
    source.recipient_address.trim().length > 0
      ? source.recipient_address.trim()
      : recipientSn
      ? formatQmailAddress(recipientSn, recipientDenominationCode) ||
        String(recipientSn)
      : "";
  const recipientCount = readNumericApiField(source.recipient_count) ?? 0;

  return {
    recipientAddress,
    recipient_address: recipientAddress,
    recipientSn,
    recipient_sn: recipientSn,
    recipientDenomination,
    recipient_denomination: recipientDenomination,
    recipientDenominationCode,
    recipient_denomination_code: recipientDenominationCode,
    recipientCount,
    recipient_count: recipientCount,
  };
};

/**
 * Gets the health status of the QMail Client Core service.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
// export const getHealthStatus = async () => {
//   try {
//     const response = await fetch(`${API_BASE_URL}/health`);
//     const data = await handleResponse(response);

//     console.log("Data received from /health:", data);

//     if (data && data.status) {
//       return {
//         success: true,
//         data: {
//           status: data.status,
//           service: data.service || "QMail Client Core",
//           version: data.version || "unknown",
//           timestamp: data.timestamp || Date.now(),
//         },
//       };
//     } else {
//       throw new Error("Invalid response from health endpoint");
//     }
//   } catch (error) {
//     console.error("Health check failed:", error);
//     const errorMessage = `Error: ${error.message}\n\nIs the QMail server running?`;
//     return { success: false, error: errorMessage };
//   }
// };

/**
 * Gets the list of popular contacts from the DRD (Distributed Resource Directory).
 * @param {number} limit - Maximum number of contacts to return (default: 10)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getPopularContacts = async (limit = 10) => {
  try {
    // API-FIX: Changed /data/contacts/popular → /qmail/db/contacts/list-popular
    const url = `${API_BASE_URL}/qmail/db/contacts/list-popular?limit=${limit}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/contacts/list-popular:", data);

    if (data && Array.isArray(data.contacts)) {
      return {
        success: true,
        data: {
          contacts: data.contacts.map((contact) => ({
            userId: contact.user_id,
            firstName: contact.first_name,
            middleName: contact.middle_name,
            lastName: contact.last_name,
            autoAddress: contact.auto_address,
            description: contact.description,
            contactCount: contact.contact_count,
            popularity: contact.popularity,
            daysSinceLastContact: contact.days_since_last_contact,
            isFavorite: Boolean(contact.is_favorite),
            // Full name for display
            fullName: `${contact.first_name}${
              contact.middle_name ? " " + contact.middle_name : ""
            } ${contact.last_name}`.trim(),
          })),
          count: data.count || data.contacts.length,
          limit: data.limit || limit,
        },
      };
    } else {
      throw new Error("Invalid response from popular contacts endpoint");
    }
  } catch (error) {
    console.error("Get popular contacts failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch popular contacts.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets the list of emails from a specific folder (inbox, sent, drafts, trash).
 * @param {string} folder - The folder to retrieve emails from (default: 'inbox')
 * @param {number} limit - Maximum number of emails to return (default: 50)
 * @param {number} offset - Number of emails to skip for pagination (default: 0)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getMailList = async (folder = "inbox", limit = 50, offset = 0, sort = "newest") => {
  try {
    // API-FIX: Changed /api/mail/list → /api/qmail/db/messages/list, folder name → folder ID
    // sort: "newest" (default), "unread", "fee", "starred"
    const sortParam = sort && sort !== "newest" ? `&sort=${sort}` : "";
    const url = `${API_BASE_URL}/qmail/db/messages/list?folder=${folderNameToId(folder)}&limit=${limit}&offset=${offset}${sortParam}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/messages/list:", data);

    if (data && Array.isArray(data.emails)) {
      // Transform backend response to match frontend expectations
      const transformedEmails = data.emails.map((email) => ({
        // API-FIX: email.EmailID → email.email_id
        id: email.email_id,
        // API-FIX: email.Subject → email.subject
        subject: email.subject || "No Subject",
        ...withSenderFields(email),
        ...withRecipientFields(email),
        // The inbox time should be when the SENDER sent the mail (sent_timestamp,
        // carried in the tell from PING/PEEK), not when we downloaded it. Older
        // mail received before the backend stored this has sent_timestamp = 0;
        // fall back to received_timestamp for those.
        timestamp: email.sent_timestamp || email.received_timestamp,
        sentTimestamp: email.sent_timestamp || null,
        receivedTimestamp: email.received_timestamp,
        isRead: email.is_read || false,
        isStarred: email.is_starred || false,
        // API-FIX: email.is_trashed → email.folder === 3
        isTrashed: email.folder === 3,
        folder: email.folder != null ? folderIdToName(email.folder) : folder,

        // API-FIX: email.preview → email.body_preview
        preview: email.body_preview || "",
        inboxFee: email.inbox_fee || 0,

        body: "",
      }));

      return {
        success: true,
        data: {
          folder: data.folder != null ? folderIdToName(data.folder) : folder,
          emails: transformedEmails,
          // API-FIX: data.total_count → data.total_in_folder
          totalCount: data.total_in_folder || 0,
          limit: data.limit || limit,
          offset: data.offset || offset,
        },
      };
    } else {
      throw new Error("Invalid response from mail list endpoint");
    }
  } catch (error) {
    console.error("Get mail list failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch mail list.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets the list of draft emails.
 * Note: This endpoint may require an email_id parameter in some cases.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getDrafts = async () => {
  try {
    // API-FIX: Changed /api/mail/drafts → /api/qmail/db/drafts/list
    const response = await fetch(`${API_BASE_URL}/qmail/db/drafts/list`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/drafts/list:", data);

    if (data && Array.isArray(data.drafts)) {
      return {
        success: true,
        data: {
          drafts: data.drafts,
        },
      };
    }

    throw new Error("Invalid response from drafts endpoint");
  } catch (error) {
    console.error("Get drafts failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch drafts.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Saves a new draft email.
 * @param {Object} draftData - Draft email data
 * @param {string} draftData.subject - Email subject
 * @param {string} draftData.body - Email body content
 * @param {string} [draftData.to] - Recipient address (optional)
 * @param {string} [draftData.cc] - CC recipients (optional)
 * @param {string} [draftData.bcc] - BCC recipients (optional)
 * @param {string} [draftData.subsubject] - Sub-subject (optional)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const saveDraft = async (draftData) => {
  try {
    // API-FIX: Changed /api/mail/draft → /api/qmail/db/drafts/create
    const response = await fetch(`${API_BASE_URL}/qmail/db/drafts/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: draftData.subject || "",
        body: draftData.body || "",
        to: draftData.to || "",
        cc: draftData.cc || "",
        bcc: draftData.bcc || "",
        subsubject: draftData.subsubject || "",
      }),
    });

    const data = await handleResponse(response);

    console.log("Data received from /mail/draft:", data);

    if (data && data.success) {
      return {
        success: true,
        data: {
          message: data.message || "Draft saved successfully",
          draftId: data.id || data.email_id || null,
          timestamp: data.timestamp,
        },
      };
    } else {
      throw new Error(
        extractApiErrorMessage(data, "Invalid response from draft endpoint"),
      );
    }
  } catch (error) {
    console.error("Save draft failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to save draft.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Updates an existing draft email.
 * @param {string} draftId - The ID of the draft to update
 * @param {Object} draftData - Draft email data
 * @param {string} draftData.subject - Email subject
 * @param {string} draftData.body - Email body content
 * @param {string} [draftData.to] - Recipient address (optional)
 * @param {string} [draftData.cc] - CC recipients (optional)
 * @param {string} [draftData.bcc] - BCC recipients (optional)
 * @param {string} [draftData.subsubject] - Sub-subject (optional)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const updateDraft = async (draftId, draftData) => {
  try {
    // gpt-batch3 #1: only send fields the caller actually provided.
    // The backend treats present-but-empty to/cc/bcc as "clear the
    // existing recipient rows" (api_handlers_qmail_drafts.c). Always
    // sending `to: ""` for a body-only edit clobbered recipients.
    //
    // Callers (ComposeModal.handleSaveDraft) build draftData with
    // only touched fields. Subject and body are still always sent
    // (they're the modal's authoritative content).
    const payload = {
      subject: draftData.subject || "",
      body: draftData.body || "",
    };
    if (typeof draftData.to === "string") payload.to = draftData.to;
    if (typeof draftData.cc === "string") payload.cc = draftData.cc;
    if (typeof draftData.bcc === "string") payload.bcc = draftData.bcc;
    if (typeof draftData.subsubject === "string") payload.subsubject = draftData.subsubject;

    // API-FIX: Changed PUT /api/mail/draft/{id} → POST /api/qmail/db/drafts/update?email_id={id}
    const response = await fetch(`${API_BASE_URL}/qmail/db/drafts/update?email_id=${encodeURIComponent(draftId)}`, {
      // API-FIX: Changed method from PUT to POST
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await handleResponse(response);

    console.log("Data received from POST /qmail/db/drafts/update:", data);

    if (data && data.success) {
      const updatedDraft = data.draft || {};
      return {
        success: true,
        data: {
          message: data.message || "Draft updated successfully",
          draftId:
            updatedDraft.id ||
            updatedDraft.email_id ||
            data.id ||
            data.email_id ||
            draftId,
          timestamp: updatedDraft.last_modified || data.timestamp,
        },
      };
    } else {
      throw new Error(
        extractApiErrorMessage(
          data,
          "Invalid response from update draft endpoint",
        ),
      );
    }
  } catch (error) {
    console.error("Update draft failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to update draft.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Peeks at QMail beacon status without forcing a new check.
 * Use cases:
 * - On application startup to get current mail state
 * - Startup/background status display
 * - To detect if Identity Coin needs healing (Status 200 Invalid AN)
 *
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
/**
 * Peeks at QMail beacon status and maps notification_count.
 */
export const peekBeacon = async () => {
  try {
    // API-FIX: Changed /api/qmail/ping → /api/qmail/net/beacon/peek
    const response = await fetch(`${API_BASE_URL}/qmail/net/beacon/peek`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/net/beacon/peek:", data);

    // API-FIX: Backend /qmail/net/beacon/peek returns { success, new_mail_count, total_remaining, notifications[] }
    if (data) {
      // API-FIX: Map rest_core response to GUI shape
      const status = data.success ? "ok" : "error";

      if (!data.success) {
        return {
          success: false,
          error: data.message || "Server returned error status",
        };
      }

      return {
        success: true,
        data: {
          // API-FIX: status mapped from data.success
          status: status,
          beaconStatus: data.success ? "good" : "unknown",
          // API-FIX: hasMail mapped from data.new_mail_count > 0
          hasMail: data.new_mail_count > 0,
          // API-FIX: messageCount mapped from data.new_mail_count
          messageCount: data.new_mail_count || 0,
          // API-FIX: messages mapped from data.notifications
          messages: data.notifications || [],

          isHealing: false,
          healingMessage: null,
        },
      };
    }

    throw new Error("Invalid response from qmail check endpoint");
  } catch (error) {
    console.error("QMail check failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to check QMail server.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Forces an immediate QMail beacon check.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const checkMailNow = async ({ timeoutMs = BEACON_CHECK_TIMEOUT_MS } = {}) => {
  try {
    const url = new URL(`${API_BASE_URL}/qmail/net/beacon/ping`);
    url.searchParams.set("timeout_ms", String(timeoutMs));
    const response = await fetch(url.toString(), {
      method: "POST",
    });
    const data = await handleResponse(response);
    if (data && data.success === false) {
      return {
        success: false,
        error: data.message || "Beacon ping failed",
      };
    }
    return { success: true, data };
  } catch (error) {
    console.error("Beacon ping failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Gets the status of a background task by task ID.
 * @param {string} taskId - The unique task ID to check status for
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getTaskStatus = async (taskId) => {
  try {
    if (!taskId) {
      throw new Error("Task ID is required");
    }

    // API-FIX: Changed /api/task/status/{id} → /api/system/tasks?task_id={id} to match rest_core
    const response = await fetch(`${API_BASE_URL}/system/tasks?task_id=${encodeURIComponent(taskId)}`);
    const data = await handleResponse(response);

    console.log("Data received from /system/tasks:", data);

    // API-FIX: rest_core returns { status: "success", payload: { id, status, progress, message, data } }
    if (data && data.payload) {
      const p = data.payload;
      // Map rest_core payload fields to the shape ComposeModal expects
      const taskStatus = p.status || '';
      const isTerminal = ['completed', 'success', 'failed', 'error', 'cancelled', 'timeout'].includes(taskStatus);
      const isSuccess = ['completed', 'success'].includes(taskStatus);
      const transferError = isSuccess
        ? null
        : normalizeTransferError(
            {
              ...(p.data && typeof p.data === "object" ? p.data : {}),
              state: taskStatus,
              error: p.message || null,
            },
            { terminal: isTerminal },
          );
      return {
        success: true,
        data: {
          taskId: p.id || taskId,
          state: taskStatus,
          status: taskStatus,
          progress: p.progress || 0,
          message: p.message || '',
          result: p.data || null,
          error: isSuccess
            ? null
            : transferError?.message || p.message || null,
          transferError,
          isFinished: isTerminal,
          isSuccessful: isSuccess,
        },
      };
    } else {
      throw new Error(data.message || "Invalid response from task status endpoint");
    }
  } catch (error) {
    console.error("Get task status failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch task status.`;
    return { success: false, error: errorMessage };
  }
};

const OBJECT_TRANSFER_ID_PATTERN = /^[0-9a-f]{32}$/i;

// R-2 hardening: the object-transfer endpoints require the per-session token
// the Electron main process generated and gave to core.exe at spawn. Cached
// after the first IPC round-trip; empty in browser/Vite builds, where the
// backend has no token configured and accepts the requests without it.
let cachedApiSessionToken = null;
const getObjectTransferAuthHeaders = async () => {
  if (cachedApiSessionToken === null) {
    try {
      cachedApiSessionToken =
        (await window.electronAPI?.getApiToken?.()) || "";
    } catch {
      cachedApiSessionToken = "";
    }
  }
  return cachedApiSessionToken
    ? { Authorization: `Bearer ${cachedApiSessionToken}` }
    : {};
};
const OBJECT_TRANSFER_TERMINAL_STATES = new Set([
  "completed",
  "cancelled",
  "failed",
  "error",
  "timeout",
  "aborted",
]);

const normalizeUnsignedDecimalString = (value) => {
  const text = String(value ?? "0").trim();
  return /^\d+$/.test(text) ? text : "0";
};

const normalizeObjectTransferStatus = (data, requestedOperationId) => {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid object transfer status response");
  }
  if (data.success === false) {
    const error = new Error(
      extractApiErrorMessage(data, "Object transfer status lookup failed"),
    );
    error.apiData = data;
    throw error;
  }

  const state = String(data.state || "").trim().toLowerCase();
  if (!state) {
    throw new Error("Object transfer status response is missing state");
  }

  const progressValue = Number(data.progress);
  const progress = Number.isFinite(progressValue)
    ? Math.min(100, Math.max(0, Math.trunc(progressValue)))
    : 0;
  const isFinished = OBJECT_TRANSFER_TERMINAL_STATES.has(state);
  const isSuccessful = state === "completed";
  const transferError = isSuccessful
    ? null
    : normalizeTransferError(data, {
        terminal: isFinished,
      });

  return {
    ...data,
    operationId: data.operation_id || requestedOperationId,
    taskId: data.task_id || null,
    transferId: data.transfer_id || null,
    objectId: data.object_id || null,
    sourcePath: data.source_path || null,
    destinationPath: data.destination_path || null,
    temporaryPath: data.temporary_path || null,
    totalBytes: normalizeUnsignedDecimalString(data.total_bytes),
    completedBytes: normalizeUnsignedDecimalString(data.completed_bytes),
    generation: normalizeUnsignedDecimalString(data.generation),
    targetGeneration: normalizeUnsignedDecimalString(data.target_generation),
    expiresAt: normalizeUnsignedDecimalString(data.expires_at),
    chunkBytes: readNumericApiField(data.chunk_bytes) ?? 0,
    maxParallel: readNumericApiField(data.max_parallel) ?? 0,
    cancelRequested: isTruthyApiFlag(data.cancel_requested),
    lastResult: readNumericApiField(data.last_result) ?? 0,
    lastStatus: readNumericApiField(data.last_status) ?? 0,
    state,
    progress,
    isFinished,
    isSuccessful,
    transferError,
    error: isSuccessful
      ? null
      : transferError?.message || data.error || null,
  };
};

const waitForObjectTransferPoll = (delayMs, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    let timer = null;
    const handleAbort = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      resolve(false);
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve(true);
    }, delayMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });

/**
 * Gets the durable status of one Object Transfer v1 operation.
 * Uint64 fields remain decimal strings so large objects do not lose precision.
 * @param {string} operationId - 16-byte operation ID encoded as 32 hex chars
 * @param {{signal?: AbortSignal}} options
 * @returns {Promise<{success: boolean, data?: any, error?: string, status?: string, httpStatus?: number}>}
 */
export const getObjectTransferStatus = async (
  operationId,
  { signal } = {},
) => {
  let httpStatus = null;

  try {
    const normalizedOperationId = String(operationId || "").trim();
    if (!OBJECT_TRANSFER_ID_PATTERN.test(normalizedOperationId)) {
      throw new Error(
        "Operation ID must be a 32-character hexadecimal string",
      );
    }
    if (signal?.aborted) {
      return {
        success: false,
        status: "aborted",
        error: "Object transfer status polling was cancelled.",
      };
    }

    const query = new URLSearchParams({
      operation_id: normalizedOperationId,
    });
    const response = await fetch(
      `${API_BASE_URL}/qmail/net/object-transfers/status?${query.toString()}`,
      { signal, headers: await getObjectTransferAuthHeaders() },
    );
    httpStatus = response.status;
    const data = await handleResponse(response);

    return {
      success: true,
      data: normalizeObjectTransferStatus(data, normalizedOperationId),
    };
  } catch (error) {
    const aborted = signal?.aborted || error?.name === "AbortError";
    const transferError = aborted
      ? null
      : normalizeTransferError(error?.apiData || error, {
          fallbackMessage: error.message,
        });
    if (!aborted) {
      console.error("Get object transfer status failed:", error);
    }
    return {
      success: false,
      status: aborted ? "aborted" : "error",
      error: aborted
        ? "Object transfer status polling was cancelled."
        : transferError?.message || error.message,
      ...(transferError ? { transferError } : {}),
      ...(error?.httpStatus || httpStatus !== null
        ? { httpStatus: error?.httpStatus || httpStatus }
        : {}),
    };
  }
};

const controlObjectTransfer = async (
  action,
  operationId,
  { signal } = {},
) => {
  let httpStatus = null;

  try {
    const normalizedOperationId = String(operationId || "").trim();
    if (!OBJECT_TRANSFER_ID_PATTERN.test(normalizedOperationId)) {
      throw new Error(
        "Operation ID must be a 32-character hexadecimal string",
      );
    }
    if (signal?.aborted) {
      return {
        success: false,
        status: "aborted",
        error: `Object transfer ${action} was cancelled.`,
      };
    }

    const query = new URLSearchParams({
      operation_id: normalizedOperationId,
    });
    const response = await fetch(
      `${API_BASE_URL}/qmail/net/object-transfers/${action}?${query.toString()}`,
      {
        method: "POST",
        signal,
        headers: await getObjectTransferAuthHeaders(),
      },
    );
    httpStatus = response.status;
    const data = await handleResponse(response);

    return {
      success: true,
      data: normalizeObjectTransferStatus(data, normalizedOperationId),
    };
  } catch (error) {
    const aborted = signal?.aborted || error?.name === "AbortError";
    const transferError = aborted
      ? null
      : normalizeTransferError(error?.apiData || error, {
          fallbackMessage: error.message,
        });
    if (!aborted) {
      console.error(`Object transfer ${action} failed:`, error);
    }
    return {
      success: false,
      status: aborted ? "aborted" : "error",
      error: aborted
        ? `Object transfer ${action} was cancelled.`
        : transferError?.message || error.message,
      ...(transferError ? { transferError } : {}),
      ...(error?.httpStatus || httpStatus !== null
        ? { httpStatus: error?.httpStatus || httpStatus }
        : {}),
    };
  }
};

/**
 * Requests cancellation of one durable Object Transfer v1 operation.
 */
export const cancelObjectTransfer = (operationId, options = {}) =>
  controlObjectTransfer("cancel", operationId, options);

/**
 * Resumes one durable Object Transfer v1 operation in the paused state.
 */
export const resumeObjectTransfer = (operationId, options = {}) =>
  controlObjectTransfer("resume", operationId, options);

/**
 * Polls a durable Object Transfer v1 operation until it reaches a terminal
 * state. A timeout of 0 keeps polling until completion or cancellation.
 * @param {string} operationId - 16-byte operation ID encoded as 32 hex chars
 * @param {{
 *   intervalMs?: number,
 *   timeoutMs?: number,
 *   maxConsecutiveErrors?: number,
 *   onUpdate?: Function,
 *   onPollError?: Function,
 *   signal?: AbortSignal
 * }} options
 * @returns {Promise<{success: boolean, data?: any, error?: string, status?: string}>}
 */
export const pollObjectTransferStatus = async (
  operationId,
  {
    intervalMs = 1000,
    timeoutMs = 0,
    maxConsecutiveErrors = 5,
    onUpdate,
    onPollError,
    signal,
  } = {},
) => {
  const normalizedOperationId = String(operationId || "").trim();
  if (!OBJECT_TRANSFER_ID_PATTERN.test(normalizedOperationId)) {
    return {
      success: false,
      error: "Operation ID must be a 32-character hexadecimal string",
    };
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    return { success: false, error: "Polling interval must be non-negative." };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return { success: false, error: "Polling timeout must be non-negative." };
  }
  if (
    !Number.isInteger(maxConsecutiveErrors) ||
    maxConsecutiveErrors < 1
  ) {
    return {
      success: false,
      error: "Maximum consecutive polling errors must be a positive integer.",
    };
  }

  const startedAt = Date.now();
  let consecutiveErrors = 0;
  let lastStatus = null;

  while (!signal?.aborted) {
    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      return {
        success: false,
        status: "timeout",
        error: "The object transfer is still running.",
        ...(lastStatus ? { data: lastStatus } : {}),
      };
    }

    const result = await getObjectTransferStatus(normalizedOperationId, {
      signal,
    });
    if (result.success) {
      consecutiveErrors = 0;
      lastStatus = result.data;

      if (typeof onUpdate === "function") {
        await onUpdate(lastStatus);
      }

      if (lastStatus.isFinished) {
        if (lastStatus.isSuccessful) {
          return { success: true, data: lastStatus };
        }
        return {
          success: false,
          status: lastStatus.state,
          error:
            lastStatus.error ||
            `Object transfer ${lastStatus.state}.`,
          ...(lastStatus.transferError
            ? { transferError: lastStatus.transferError }
            : {}),
          data: lastStatus,
        };
      }
    } else {
      if (result.status === "aborted") return result;

      consecutiveErrors += 1;
      if (typeof onPollError === "function") {
        await onPollError(result, consecutiveErrors);
      }

      const isPermanentHttpError =
        result.httpStatus >= 400 && result.httpStatus < 500 &&
        result.httpStatus !== 408 && result.httpStatus !== 429;
      if (isPermanentHttpError || consecutiveErrors >= maxConsecutiveErrors) {
        return {
          ...result,
          ...(lastStatus ? { data: lastStatus } : {}),
        };
      }
    }

    const shouldContinue = await waitForObjectTransferPoll(intervalMs, signal);
    if (!shouldContinue) break;
  }

  return {
    success: false,
    status: "aborted",
    error: "Object transfer status polling was cancelled.",
    ...(lastStatus ? { data: lastStatus } : {}),
  };
};

/**
 * Searches emails by query string.
 * @param {string} query - The search query string
 * @param {number} limit - Maximum number of results to return (default: 50)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const searchEmails = async (query, limit = 50) => {
  try {
    if (!query || query.trim() === "") {
      throw new Error("Search query is required");
    }

    const encodedQuery = encodeURIComponent(query);
    // API-FIX: Changed /api/data/emails/search?q= → /api/qmail/db/messages/search?query=, removed offset param
    const url = `${API_BASE_URL}/qmail/db/messages/search?query=${encodedQuery}&limit=${limit}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/messages/search:", data);

    if (data) {
      return {
        success: true,
        data: {
          query: data.query || query,
          results: (data.results || []).map((email) => ({
            ...email,
            ...withSenderFields(email),
          })),
          count: data.count || 0,
          limit: data.limit || limit,
        },
      };
    } else {
      throw new Error("Invalid response from email search endpoint");
    }
  } catch (error) {
    console.error("Email search failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to search emails.`;
    return { success: false, error: errorMessage };
  }
};

// Enhanced task status polling
// const pollTaskStatus = async (currentTaskId) => {
//   // Removed the !isPolling check here to prevent stale closure aborts on the first call
//   if (!currentTaskId) return;

//   try {
//     const result = await getTaskStatus(currentTaskId);

//     if (result.success) {
//       // Correctly extract the mapped fields from your qmailApiServices.js getTaskStatus response
//       const {
//         state,
//         progress: currentProgress,
//         message,
//         isFinished,
//         isSuccessful,
//         error: taskError
//       } = result.data;

//       setProgress(currentProgress || 0);
//       setSendProgress(message || "Processing...");

//       // Check the exact completion flags from the task manager
//       if (isFinished) {
//         if (isSuccessful || state === "completed") {
//           setSendingStatus("completed");
//           setIsPolling(false);
//           setSendProgress("Email sent successfully!");
//           setTimeout(() => {
//             onSend({ to, cc, bcc, subject, body });
//             setIsSending(false);
//             setSendingStatus(null);
//             setSendProgress("");
//             setTaskId(null);
//           }, 1500);
//         } else {
//           setSendingStatus("failed");
//           setIsPolling(false);
//           setError(taskError || message || "Failed to send email");
//           setIsSending(false);
//           setTaskId(null);
//         }
//       } else {
//         // Task is still running, keep polling
//         setSendingStatus("sending");
//         setTimeout(() => pollTaskStatus(currentTaskId), 1000);
//       }
//     } else {
//       console.error("Failed to get task status:", result.error);
//       setIsPolling(false);
//       setSendingStatus("failed");
//       setError("Failed to track email status");
//       setIsSending(false);
//     }
//   } catch (error) {
//     console.error("Task polling error:", error);
//     setIsPolling(false);
//     setSendingStatus("failed");
//     setError("Failed to track email status");
//     setIsSending(false);
//   }
// };

/**
 * Gets the list of available mail folders.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getMailFolders = async () => {
  try {
    // API-FIX: Changed /api/mail/folders → /api/qmail/db/folders/list
    const response = await fetch(`${API_BASE_URL}/qmail/db/folders/list`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/folders/list:", data);

    // API-FIX: Backend returns { success, folders: [{ id, name }] }
    if (data && Array.isArray(data.folders)) {
      return {
        success: true,
        data: {
          folders: data.folders.map((folder) => ({
            // API-FIX: folder.id → id, folder.name → name, add displayName by capitalizing
            id: folder.id,
            name: folder.name,
            displayName: folder.name ? folder.name.charAt(0).toUpperCase() + folder.name.slice(1) : folder.name,
          })),
        },
      };
    } else {
      throw new Error("Invalid response from mail folders endpoint");
    }
  } catch (error) {
    console.error("Get mail folders failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch mail folders.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets message counts for all folders.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getMailCount = async () => {
  try {
    // API-FIX: Changed /api/mail/count → /api/qmail/db/folders/counts
    const response = await fetch(`${API_BASE_URL}/qmail/db/folders/counts`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/folders/counts:", data);

    // API-FIX: Backend returns { success, folders: { inbox: {total, unread}, ... } }
    if (data && data.folders) {
      // API-FIX: Compute summary by summing all folder totals/unread
      const folderKeys = Object.keys(data.folders);
      const totalEmails = folderKeys.reduce((sum, key) => sum + (data.folders[key].total || 0), 0);
      const totalUnread = folderKeys.reduce((sum, key) => sum + (data.folders[key].unread || 0), 0);
      return {
        success: true,
        data: {
          counts: data.folders,
          summary: {
            total_emails: totalEmails,
            total_unread: totalUnread,
          },
        },
      };
    } else {
      throw new Error("Invalid response from mail count endpoint");
    }
  } catch (error) {
    console.error("Get mail count failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch mail counts.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Toggles the starred state of an email.
 * @param {string} emailId - The unique email identifier
 * @param {boolean} starred - Whether to star (true) or unstar (false) the email
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const starEmail = async (emailId, starred) => {
  try {
    if (!emailId) throw new Error("Email ID is required");
    const url = `${API_BASE_URL}/qmail/db/messages/set-star?email_id=${encodeURIComponent(emailId)}&starred=${starred ? "true" : "false"}`;
    const response = await fetch(url);
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    console.error("Star email failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Toggle the is_favorite flag on a contact. Favorites sort to the top of
 * the popular-recipients dropdown.
 * @param {number|string} sn      Contact serial number.
 * @param {boolean}       value   New favorite state.
 */
export const setContactFavorite = async (sn, value) => {
  try {
    if (!sn) throw new Error("Contact serial number is required");
    const url = `${API_BASE_URL}/qmail/db/contacts/favorite?sn=${encodeURIComponent(sn)}&value=${value ? "true" : "false"}`;
    const response = await fetch(url);
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    console.error("Set contact favorite failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Gets complete metadata for a specific email by ID.
 * @param {string} emailId - The unique email identifier (32-character hex string)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getEmailById = async (emailId) => {
  try {
    if (!emailId || emailId.length !== 32) {
      throw new Error(
        "Invalid email ID. Must be a 32-character hexadecimal string.",
      );
    }

    // API-FIX: Changed /api/mail/{emailId} → /api/qmail/db/messages/get?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/db/messages/get?email_id=${emailId}`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/messages/get:", data);

    // API-FIX: Backend returns { success, email_id, subject, sender_sn, received_timestamp, is_read, is_starred, folder, body, body_length }
    if (data && (data.email_id || data.success)) {
      const normalizeRecipientField = (...values) => {
        const value = values.find((item) =>
          Array.isArray(item)
            ? item.length > 0
            : typeof item === "string" && item.trim().length > 0,
        );
        if (Array.isArray(value)) return value.join(", ");
        return value || "";
      };

      const senderFields = withSenderFields(data, "");

      return {
        success: true,
        data: {
          // API-FIX: id mapped from data.email_id
          id: data.email_id || emailId,
          ...senderFields,
          ...withRecipientFields(data),
          // API-FIX: subject mapped from data.subject
          subject: data.subject || "No Subject",
          // API-FIX: body mapped from data.body
          body: data.body || "",
          to: normalizeRecipientField(data.to, data.To, data.to_addresses),
          cc: normalizeRecipientField(data.cc, data.CC, data.cc_addresses),
          bcc: normalizeRecipientField(data.bcc, data.BCC, data.bcc_addresses),
          subsubject: data.subsubject || data.sub_subject || data.SubSubject || "",
          // API-FIX: timestamp mapped from data.received_timestamp
          timestamp: data.received_timestamp,
          // API-FIX: isRead mapped from data.is_read
          isRead: data.is_read,
          // API-FIX: folder mapped via folderIdToName
          folder: folderIdToName(data.folder),
          inboxFee: readNumericApiField(data.inbox_fee, data.inboxFee) ?? 0,
          inbox_fee: readNumericApiField(data.inbox_fee, data.inboxFee) ?? 0,
          paymentStatus: readNumericApiField(data.payment_status, data.paymentStatus),
          paymentStatusText: data.payment_status_text || data.paymentStatusText || "",
          // API-FIX: Removed attachments mapping (they come from separate endpoint)
        },
      };
    } else {
      throw new Error("Invalid response from email endpoint");
    }
  } catch (error) {
    console.error("Get email by ID failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch email.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets metadata for all attachments of a specific email.
 * @param {string} emailId - The unique email identifier (32-character hex string)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getEmailAttachments = async (emailId) => {
  try {
    if (!emailId || emailId.length !== 32) {
      throw new Error(
        "Invalid email ID. Must be a 32-character hexadecimal string.",
      );
    }

    // API-FIX: Changed /api/mail/{emailId}/attachments → /api/qmail/db/attachments/list?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/db/attachments/list?email_id=${emailId}`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/attachments/list:", data);

    if (data) {
      return {
        success: true,
        data: {
          emailId: data.email_id,
          attachments: (data.attachments || []).map((att) => ({
            attachmentId: att.attachment_id,
            name: att.name,
            // API-FIX: att.extension → fileExtension (not file_extension)
            fileExtension: att.extension,
            // API-FIX: att.size_bytes → size
            size: att.size_bytes,
            // storage_mode: 0=internal blob, 1=external file, 2=PENDING (bytes
            // not yet downloaded — fetched on demand when the user clicks).
            storageMode: att.storage_mode,
            isDownloaded: att.storage_mode !== 2,
            dangerous:
              isTruthyApiFlag(att.dangerous) ||
              isTruthyApiFlag(att.is_dangerous) ||
              isTruthyApiFlag(att.isDangerous),
            warning:
              (typeof att.warning === "string" && att.warning) ||
              att.warning_message ||
              att.warningMessage ||
              "",
          })),
          count: data.count || 0,
        },
      };
    } else {
      throw new Error("Invalid response from attachments endpoint");
    }
  } catch (error) {
    console.error("Get email attachments failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch attachments.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Error shown when a contact input cannot be resolved to a real serial number.
 */
export const CONTACT_ADDRESS_OR_SN_ERROR =
  "Please enter a QMail address (like 51.254@bit or 51.254.0) or a bare serial number.";

const SERIAL_NUMBER_PATTERN = /^\d+$/;

/**
 * Resolves the Add Contact address field into backend contact fields.
 * Accepts a QMail address in any of the three dotted-decimal forms
 * ("0.51.254.0", "51.254.0", "51.254@bit") or a bare serial number.
 * @param {string} input
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const resolveAddressOrSn = async (input) => {
  const value = String(input || "").trim();

  // A bare serial number has no dots and no '@'. The denomination is
  // unknown in that case; the backend's default applies.
  if (SERIAL_NUMBER_PATTERN.test(value)) {
    return {
      success: true,
      data: {
        serial_number: value,
        serialNumber: value,
        auto_address: "",
        autoAddress: "",
        source: "serial_number",
      },
    };
  }

  // Anything with a '.' or '@' must be a full QMail address; parse it to
  // serial number + denomination (parseQmailAddress carries the same
  // user-facing error messages as the backend validator).
  if (value.includes(".") || value.includes("@")) {
    const parsed = parseQmailAddress(value);
    if (!parsed.ok) {
      return { success: false, error: parsed.error };
    }
    return {
      success: true,
      data: {
        serial_number: String(parsed.serialNumber),
        serialNumber: String(parsed.serialNumber),
        denomination: String(parsed.denominationCode),
        denominationCode: parsed.denominationCode,
        class_name: parsed.denominationName,
        className: parsed.denominationName,
        auto_address: parsed.canonical,
        autoAddress: parsed.canonical,
        source: "address",
      },
    };
  }

  return { success: false, error: CONTACT_ADDRESS_OR_SN_ERROR };
};

/**
 * Gets the list of contacts with optional search.
 * @param {string} query - Optional search query to filter contacts
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getContacts = async (query = "") => {
  try {
    // API-FIX: Changed /api/contacts → /api/qmail/db/contacts/list
    const url = `${API_BASE_URL}/qmail/db/contacts/list`;

    console.log("Fetching contacts from:", url);

    const response = await fetch(url);
    const data = await handleResponse(response);
    console.log("Data received from /qmail/db/contacts/list:", data);

    let contacts = [];

    // API-FIX: Backend returns { success, count, contacts: [{ serial_number, denomination, first_name, last_name, auto_address, description, class_name }] }
    if (data && Array.isArray(data.contacts)) {
      contacts = data.contacts;
    } else if (data && Array.isArray(data)) {
      contacts = data;
    } else {
      throw new Error("Invalid response format from contacts endpoint");
    }

    // Transform the contacts
    let transformedContacts = contacts.map((contact) => {
      // API-FIX: serial_number -> userId
      const serialNumber =
        contact.serial_number ||
        contact.user_id ||
        contact.userId ||
        "";

      return {
        userId: serialNumber || Math.random().toString(36).substr(2, 9),
        firstName: contact.first_name || contact.firstName || "",
        lastName: contact.last_name || contact.lastName || "",
        middleName: contact.middle_name || contact.middleName || "",
        autoAddress:
          contact.auto_address ||
          contact.autoAddress ||
          contact.email ||
          // No stored address: synthesize the canonical dotted-decimal
          // form when the row carries a denomination code, else bare SN.
          (serialNumber
            ? formatQmailAddress(Number(serialNumber), contact.denomination) ||
              String(serialNumber)
            : ""),
        description: contact.description || "",
        // Denomination code 0 (= bit) is valid and falsy — use ?? not ||.
        denomination: contact.denomination ?? "",
        className: contact.class_name || "",
        trustLevel: contact.trust_level ?? 0,
        userNotes: contact.user_notes || "",
        isFavorite: Boolean(contact.is_favorite ?? contact.isFavorite),
        fullName:
          `${contact.first_name || contact.firstName || ""} ${contact.middle_name || contact.middleName ? " " + (contact.middle_name || contact.middleName) : ""} ${contact.last_name || contact.lastName || ""}`.trim() ||
          contact.denomination ||
          (serialNumber ? `User ${serialNumber}` : "Unknown Contact"),
      };
    });

    // If we have a search query, filter the results client-side
    if (query && query.trim() !== "") {
      const searchTerm = query.trim().toLowerCase();
      transformedContacts = transformedContacts.filter(
        (contact) =>
          contact.fullName.toLowerCase().includes(searchTerm) ||
          contact.autoAddress.toLowerCase().includes(searchTerm) ||
          (contact.firstName &&
            contact.firstName.toLowerCase().includes(searchTerm)) ||
          (contact.lastName &&
            contact.lastName.toLowerCase().includes(searchTerm)) ||
          (contact.description &&
            contact.description.toLowerCase().includes(searchTerm)) ||
          (contact.userNotes &&
            contact.userNotes.toLowerCase().includes(searchTerm)),
      );
    }

    return {
      success: true,
      data: {
        contacts: transformedContacts,
        total: transformedContacts.length,
      },
    };
  } catch (error) {
    console.error("Get contacts failed:", error);
    const errorMessage = `Failed to fetch contacts: ${error.message}`;
    return { success: false, error: errorMessage };
  }
};

// BUG-14 FIX: Add backend API calls for contact add/delete

/**
 * Adds a contact to the backend via POST /api/qmail/db/contacts/create
 * @param {object} contactData - { serial_number, denomination, first_name, last_name, description, class_name }
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const addContact = async (contactData) => {
  try {
    const params = new URLSearchParams();
    if (contactData.serial_number) params.append('serial_number', contactData.serial_number);
    // Denomination code 0 (= bit) is valid and falsy — compare explicitly.
    if (contactData.denomination !== undefined &&
        contactData.denomination !== null &&
        contactData.denomination !== "") {
      params.append('denomination', contactData.denomination);
    }
    if (contactData.first_name) params.append('first_name', contactData.first_name);
    if (contactData.last_name) params.append('last_name', contactData.last_name);
    if (contactData.description) params.append('description', contactData.description);
    if (contactData.class_name) params.append('class_name', contactData.class_name);
    if (contactData.trust_level !== undefined) params.append('trust_level', contactData.trust_level);
    if (contactData.user_notes) params.append('user_notes', contactData.user_notes);

    const response = await fetch(`${API_BASE_URL}/qmail/db/contacts/create?${params.toString()}`, {
      method: 'POST',
    });
    const data = await handleResponse(response);

    if (data && data.success) {
      return { success: true, data };
    } else {
      throw new Error(data.message || data.error || 'Failed to add contact');
    }
  } catch (error) {
    console.error("Add contact failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Deletes a contact from the backend via DELETE /api/qmail/db/contacts/delete
 * @param {number} serialNumber - The serial number of the contact to delete
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const deleteContact = async (serialNumber) => {
  try {
    const response = await fetch(
      `${API_BASE_URL}/qmail/db/contacts/delete?serial_number=${encodeURIComponent(serialNumber)}`,
      { method: 'DELETE' }
    );
    const data = await handleResponse(response);

    if (data && data.success) {
      return { success: true, data };
    } else {
      throw new Error(data.message || data.error || 'Failed to delete contact');
    }
  } catch (error) {
    console.error("Delete contact failed:", error);
    let userMessage = error.message;
    if (error.message === "Failed to fetch") {
      userMessage = `Cannot reach the mail server. Please make sure the backend is running on port ${API_PORT}.`;
    }
    return { success: false, error: userMessage };
  }
};

/**
 * Gets QMail server topology and live RAIDA echo availability.
 * Merges /api/qmail/local/status (topology) with /api/raida/echo (per-server health).
 * @returns {Promise<{success: boolean, data?: {servers, totalServers, availableServers, raidaEcho}, error?: string}>}
 */
// QMail server topology (which RAIDA indices are mail servers, their IPs/ports)
// is static for the life of the process. Cache it so a status refresh only needs
// ONE /raida/echo call and never re-fetches topology — the echo already carries
// per-RAIDA availability for every server, including the mail/beacon ones.
let _qmailTopologyCache = null;

/**
 * @param {object} [options]
 * @param {object} [options.echoData] Pre-fetched /raida/echo result (with a
 *   `raidas` array). When supplied, getServers does NOT issue its own echo —
 *   it derives mail-server availability from this single shared echo, avoiding
 *   a redundant round trip to the (rate-limited) beacon.
 * @param {boolean} [options.skipEcho] When true, never call /raida/echo from
 *   this helper. Server availability is unknown if echoData is absent/null.
 */
export const getServers = async (options = {}) => {
  try {
    const safeOptions = options || {};
    const hasEchoData = Object.prototype.hasOwnProperty.call(safeOptions, "echoData");
    const { echoData = null, skipEcho = false } = safeOptions;
    // API-FIX: Changed /api/data/servers → /api/qmail/local/status
    // /qmail/local/status returns topology only (raida_index, ip, port, region,
    // hostname). It does NOT return is_available or percent_uptime. We merge
    // live availability from /raida/echo so consumers get honest health data.
    //
    // Topology is fetched once and cached; availability comes from the shared
    // echo (passed in by the caller) or, if none was passed, a single echo here.
    const statusPromise = _qmailTopologyCache
      ? Promise.resolve(_qmailTopologyCache)
      : fetch(`${API_BASE_URL}/qmail/local/status`)
          .then((r) => handleResponse(r))
          .catch(() => null);

    const echoPromise = skipEcho || hasEchoData
      ? Promise.resolve(echoData)
      : fetch(`${API_BASE_URL}/raida/echo`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

    const [statusRes, echoRes] = await Promise.all([statusPromise, echoPromise]);

    if (statusRes && statusRes.servers && Array.isArray(statusRes.servers.list)) {
      _qmailTopologyCache = statusRes; // remember topology for next refresh
    }

    console.log("Data received from /qmail/local/status:", statusRes);

    if (statusRes && statusRes.servers && Array.isArray(statusRes.servers.list)) {
      // Build an index -> echo-status map (status === "Ready" means online).
      const echoByIndex = new Map();
      if (echoRes && Array.isArray(echoRes.raidas)) {
        echoRes.raidas.forEach((r) => echoByIndex.set(r.index, r));
      }

      const merged = statusRes.servers.list.map((s) => {
        const echo = echoByIndex.get(s.raida_index);
        const isAvailable = echo ? echo.status === "Ready" : null;
        return {
          ...s,
          // Aliases for legacy consumers (AccountPane reads server_id / ip_address).
          server_id: s.raida_index,
          ip_address: s.ip,
          is_available: isAvailable,
          // percent_uptime is not produced by either endpoint. Surface a sentinel
          // (null) so consumers can render "unknown" instead of fabricating 100%.
          percent_uptime: null,
          latency_ms: echo ? echo.latency_ms : null,
        };
      });

      return {
        success: true,
        data: {
          servers: merged,
          totalServers: statusRes.servers.count || merged.length,
          availableServers: merged.filter((s) => s.is_available).length,
          raidaEcho: echoRes,
        },
      };
    } else {
      throw new Error("Invalid response from servers endpoint");
    }
  } catch (error) {
    console.error("Get servers failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Pings all 25 RAIDA servers via echo and returns per-server status.
 * @returns {Promise<{success: boolean, data?: {raidas: Array, totalAvailable: number, totalError: number, totalTimeout: number}}>}
 */
export const echoRaida = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/raida/echo`);
    const data = await handleResponse(response);
    if (data && Array.isArray(data.raidas)) {
      return {
        success: true,
        data: {
          raidas: data.raidas,
          totalAvailable: data.total_available || 0,
          totalError: data.total_error || 0,
          totalTimeout: data.total_timeout || 0,
          arrayUsable: data.array_usable || false,
        },
      };
    }
    throw new Error("Invalid echo response");
  } catch (error) {
    console.error("Echo RAIDA failed:", error);
    return { success: false, error: error.message };
  }
};

const getLockerPoolStatusData = async (walletPath = null) => {
  const resolvedPath = walletPath && String(walletPath).trim()
    ? String(walletPath).trim()
    : (await lookupDefaultWalletPath()).path;

  if (!resolvedPath) {
    throw new Error("No Default wallet is registered on the QMail backend.");
  }

  const query = new URLSearchParams({ wallet_path: resolvedPath });
  const response = await fetch(`${API_BASE_URL}/qmail/local/locker-pool/status?${query.toString()}`);
  const data = await handleResponse(response);

  if (!data || data.success !== true) {
    throw new Error("Invalid response from locker pool status endpoint");
  }

  const lockedValue = readNumericApiField(data.locked_value) ?? 0;
  const walletBalance = readNumericApiField(data.wallet_balance) ?? 0;

  return {
    uploadAvailable: readNumericApiField(data.upload_available) ?? 0,
    inboxFeeAvailable: readNumericApiField(data.inbox_fee_available) ?? 0,
    lockedValue,
    lockedAvailableValue: readNumericApiField(data.locked_available_value) ?? 0,
    lockedReservedValue: readNumericApiField(data.locked_reserved_value) ?? 0,
    lockedLimboValue: readNumericApiField(data.locked_limbo_value) ?? 0,
    lockedUploadValue: readNumericApiField(data.locked_upload_value) ?? 0,
    lockedInboxFeeValue: readNumericApiField(data.locked_inbox_fee_value) ?? 0,
    walletBalance,
    combinedWalletValue: readNumericApiField(data.combined_wallet_value) ?? (walletBalance + lockedValue),
    lowBalance: Boolean(data.low_balance),
  };
};

/**
 * Gets current pre-funded locker pool status for the Default wallet.
 * @param {string|null} walletPath - Optional resolved wallet path.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getQMailLockerPoolStatus = async (walletPath = null) => {
  try {
    return { success: true, data: await getLockerPoolStatusData(walletPath) };
  } catch (error) {
    console.error("Get locker pool status failed:", error);
    return { success: false, error: error.message };
  }
};

const appendCanSendRecipientParams = (params, name, value) => {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  values
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .forEach((entry) => params.append(name, entry));
};

const readApiBoolean = (value) =>
  value === true || value === 1 || value === "1" || value === "true";

/**
 * Checks whether QMail can currently fund a send from the Default wallet.
 * @param {{to?: string[]|string, cc?: string[]|string, bcc?: string[]|string, uploadLockers?: number, inboxFee?: number}} options
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getQMailCanSend = async (options = {}) => {
  try {
    const lookup = await lookupDefaultWalletPath();
    if (!lookup.path) {
      throw new Error(
        lookup.reason === "no_wallet"
          ? "No Default wallet is registered on the QMail backend."
          : "Could not reach the QMail backend to look up the Default wallet.",
      );
    }

    const params = new URLSearchParams({ wallet_path: lookup.path });
    const uploadLockers = Number(
      options.uploadLockers ?? options.upload_lockers ?? 0,
    );
    if (Number.isFinite(uploadLockers) && uploadLockers > 0) {
      params.set("upload_lockers", String(Math.trunc(uploadLockers)));
    }

    const inboxFee = Number(
      options.inboxFee ??
        options.inbox_fee ??
        options.requiredInboxFee ??
        options.required_inbox_fee ??
        0,
    );
    if (Number.isFinite(inboxFee) && inboxFee > 0) {
      params.set("inbox_fee", String(Math.trunc(inboxFee)));
    }

    appendCanSendRecipientParams(params, "to", options.to);
    appendCanSendRecipientParams(params, "cc", options.cc);
    appendCanSendRecipientParams(params, "bcc", options.bcc);

    const response = await fetch(
      `${API_BASE_URL}/qmail/local/can-send?${params.toString()}`,
    );
    const data = await handleResponse(response);
    if (!data || data.success !== true) {
      throw new Error("Invalid response from send funding check endpoint");
    }

    const canSend = readApiBoolean(data.can_send);
    return {
      success: true,
      data: {
        canSend,
        reason: data.reason || "",
        message:
          data.message ||
          (canSend
            ? "Ready to send mail"
            : "You do not have enough CloudCoins to send mail. Add funds, then try again."),
        requiredUploadLockers: readNumericApiField(data.required_upload_lockers) ?? 0,
        requiredInboxFee: readNumericApiField(data.required_inbox_fee) ?? 0,
        walletRequired: readNumericApiField(data.wallet_required) ?? 0,
        walletBalance: readNumericApiField(data.wallet_balance) ?? 0,
        combinedWalletValue: readNumericApiField(data.combined_wallet_value) ?? 0,
        raw: data,
      },
    };
  } catch (error) {
    console.error("QMail can-send check failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Gets the wallet balance, locker value, and coin distribution across folders.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
// Renamed from getWalletBalance to getQMailWalletBalance to avoid
// name collision with apiService.js getWalletBalance (different endpoint/shape).
export const getQMailWalletBalance = async () => {
  try {
    // The left-pane Wallet total is backed by the Default payment wallet, not the Mail identity key.
    const lookup = await lookupDefaultWalletPath();
    if (!lookup.path) {
      throw new Error(
        lookup.reason === "no_wallet"
          ? "No Default wallet is registered on the QMail backend."
          : "Could not reach the QMail backend to look up the Default wallet.",
      );
    }

    const query = new URLSearchParams({ wallet_path: lookup.path });
    const response = await fetch(`${API_BASE_URL}/wallets/balance?${query.toString()}`);
    const data = await handleResponse(response);

    console.log("Data received from /wallets/balance:", data);

    // API-FIX: rest_core returns { success, command, wallet_path, wallet_name,
    //   total_value, total_notes, bank_value, bank_notes, fracked_value, fracked_notes,
    //   limbo_value, limbo_notes }
    if (data && data.success) {
      let lockerPool = null;
      let lockerPoolError = null;
      try {
        lockerPool = await getLockerPoolStatusData(lookup.path);
      } catch (lockerError) {
        lockerPoolError = lockerError.message;
        console.warn("Locker pool status unavailable:", lockerError);
      }

      const spendableValue = readNumericApiField(data.total_value) ?? 0;
      const lockedValue = lockerPool?.lockedValue ?? 0;

      return {
        success: true,
        data: {
          walletPath: data.wallet_path,
          walletName: data.wallet_name,
          totalCoins: data.total_notes || 0,
          totalValue: spendableValue,
          spendableValue,
          lockedValue,
          combinedTotalValue: spendableValue + lockedValue,
          lockerPool,
          lockerPoolError,
          folders: {
            bank: {
              coins: data.bank_notes || 0,
              value: data.bank_value || 0,
            },
            fracked: {
              coins: data.fracked_notes || 0,
              value: data.fracked_value || 0,
            },
            limbo: {
              coins: data.limbo_notes || 0,
              value: data.limbo_value || 0,
            },
          },
          denominations: data.denominations || {},
          warnings: data.warnings || [],
        },
      };
    } else {
      throw new Error("Invalid response from wallet balance endpoint");
    }
  } catch (error) {
    console.error("Get wallet balance failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch wallet balance.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Marks an email as read or unread
 * @param {string} emailId - The email ID
 * @param {boolean} isRead - true to mark as read, false for unread
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const markEmailRead = async (emailId, isRead = true) => {
  try {
    // API-FIX: Changed PUT /api/mail/{emailId}/read → POST /api/qmail/db/messages/set-read?email_id={emailId}&is_read={isRead}
    const response = await fetch(`${API_BASE_URL}/qmail/db/messages/set-read?email_id=${emailId}&is_read=${isRead}`, {
      // API-FIX: Changed method from PUT to POST, removed JSON body
      method: "POST",
    });
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/messages/set-read:", data);

    // API-FIX: Check data.success instead of data.status === "success"
    if (data && data.success) {
      return {
        success: true,
        data: {
          message: data.message,
          emailId: emailId,
          isRead: isRead,
        },
      };
    } else {
      throw new Error("Invalid response from mark read endpoint");
    }
  } catch (error) {
    console.error("Mark email read failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Moves an email to a different folder
 * @param {string} emailId - The email ID
 * @param {string} folder - Target folder (inbox, sent, drafts, trash)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const moveEmail = async (emailId, folder) => {
  try {
    // API-FIX: Changed PUT /api/mail/{emailId}/move → POST /api/qmail/db/messages/move?email_id={emailId}&folder={folderId}
    const response = await fetch(`${API_BASE_URL}/qmail/db/messages/move?email_id=${emailId}&folder=${folderNameToId(folder)}`, {
      // API-FIX: Changed method from PUT to POST, removed JSON body
      method: "POST",
    });
    const data = await handleResponse(response);

    console.log("Data received from /qmail/db/messages/move:", data);

    // API-FIX: Check data.success instead of data.status === "success"
    if (data && data.success) {
      return {
        success: true,
        data: {
          message: data.message,
          emailId: emailId,
          folder: folder,
        },
      };
    } else {
      throw new Error("Invalid response from move email endpoint");
    }
  } catch (error) {
    console.error("Move email failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Deletes an email (moves to trash)
 * @param {string} emailId - The email ID
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const deleteEmail = async (emailId) => {
  try {
    // API-FIX: Changed DELETE /api/mail/{emailId} → DELETE /api/qmail/db/messages/trash?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/db/messages/trash?email_id=${emailId}`, {
      method: "DELETE",
    });
    const data = await handleResponse(response);

    console.log("Data received from DELETE /qmail/db/messages/trash:", data);

    // API-FIX: Check data.success instead of data.status === "success"
    if (data && data.success) {
      return {
        success: true,
        data: {
          message: data.message,
          emailId: emailId,
        },
      };
    } else {
      throw new Error("Invalid response from delete email endpoint");
    }
  } catch (error) {
    console.error("Delete email failed:", error);
    return { success: false, error: error.message };
  }
};


export const getQMailPaymentInfo = async (emailId) => {
  try {
    if (!emailId || String(emailId).length !== 32) {
      throw new Error("Invalid email ID. Must be a 32-character hexadecimal string.");
    }

    const response = await fetch(
      `${API_BASE_URL}/qmail/db/payments/get?email_id=${encodeURIComponent(emailId)}`,
    );
    const data = await handleResponse(response);
    const paymentStatus = readNumericApiField(data.payment_status, data.paymentStatus);

    return {
      success: true,
      data: {
        emailId: data.email_id || emailId,
        hasPayment: Boolean(data.has_payment),
        lockerCode: data.locker_code || "",
        lockerCodeHex: data.locker_code_hex || "",
        paymentStatus,
        paymentStatusText: data.payment_status_text || "",
        canRetry: data.can_retry !== false,
        message: data.message || "",
      },
    };
  } catch (error) {
    console.error("Get QMail payment info failed:", error);
    return { success: false, error: error.message };
  }
};

export const markQMailPaymentRefunded = async (emailId) => {
  try {
    if (!emailId || String(emailId).length !== 32) {
      throw new Error("Invalid email ID. Must be a 32-character hexadecimal string.");
    }

    const response = await fetch(
      `${API_BASE_URL}/qmail/db/payments/mark-refunded?email_id=${encodeURIComponent(emailId)}`,
      { method: "POST" },
    );
    const data = await handleResponse(response);
    const paymentStatus = readNumericApiField(data.payment_status, data.paymentStatus);

    return {
      success: true,
      data: {
        emailId: data.email_id || emailId,
        status: data.status || "refunded",
        paymentStatus,
        paymentStatusText: data.payment_status_text || "refunded",
        alreadyRefunded: Boolean(data.already_refunded),
        lockerCode: data.locker_code || "",
        message: data.message || "Payment marked refunded",
      },
    };
  } catch (error) {
    console.error("Mark QMail payment refunded failed:", error);
    return { success: false, error: error.message };
  }
};

export const sendEmail = async (emailData) => {
  try {
    const toList = Array.isArray(emailData.to) ? emailData.to : [];
    const ccList = Array.isArray(emailData.cc) ? emailData.cc : [];
    const bccList = Array.isArray(emailData.bcc) ? emailData.bcc : [];
    const resolvedWalletPath = await resolveDefaultWalletPathForOperation(
      emailData.walletPath ?? emailData.wallet_path ?? null,
    );

    // Build URL-encoded form body (backend parses POST body as query params)
    const params = new URLSearchParams();
    params.set("wallet_path", resolvedWalletPath);
    toList.forEach((recipient) => params.append("to", recipient));
    ccList.forEach((recipient) => params.append("cc", recipient));
    bccList.forEach((recipient) => params.append("bcc", recipient));
    if (emailData.subject) params.set("subject", emailData.subject);
    if (emailData.body) params.set("body", emailData.body);
    // API-FIX: Changed storage_weeks → duration (Phase 3.7)
    // Documented API default is 4 weeks.
    params.set("duration",
      emailData.storage_weeks !== undefined ? String(emailData.storage_weeks) : "4");

    // API-FIX: Added attachment_file_path support
    if (Array.isArray(emailData.attachments)) {
      emailData.attachments.forEach(path => {
        if (path) params.append("attachment_file_path", path);
      });
    }

    // API-FIX: Changed /api/qmail/net/messages/send → /api/qmail/net/messages/upload_and_tell
    const response = await fetch(`${API_BASE_URL}/qmail/net/messages/upload_and_tell`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await handleResponse(response);
    console.log("Send API Response:", data);

    if (
      data &&
      (data.success || data.status === "success" || data.status === "accepted" || data.file_guid || data.task_id)
    ) {
      return {
        success: true,
        data: {
          message: data.message || "Email sent successfully",
          // Only set taskId for async operations (task_id field).
          // file_guid is the email identifier, NOT a pollable task.
          taskId: data.task_id || null,
          fileGuid: data.file_guid || null,
          operationId: data.operation_id || null,
          operationIds: Array.isArray(data.operation_ids)
            ? data.operation_ids
            : [],
          timestamp: data.timestamp,
        },
      };
    } else {
      throw new Error(
        extractApiErrorMessage(data, "Server rejected the email"),
      );
    }
  } catch (error) {
    console.error("Send email failed:", error);
    // Provide user-friendly error messages
    let userMessage = error.message;
    if (error.message === "Failed to fetch") {
      userMessage = `Cannot reach the mail server. Please make sure the backend is running on port ${API_PORT}.`;
    }
    return { success: false, error: userMessage };
  }
};

// Convert a coin serial number to a full email address
export const convertSnToEmail = async (sn, denomination = null) => {
  try {
    const params = new URLSearchParams({ sn: String(sn) });
    // Denomination code 0 (= bit) is valid and falsy — send the param
    // whenever the caller explicitly provided a denomination (Number(null)
    // is 0, so check for absence before coercing).
    const denominationValue =
      denomination === null || denomination === undefined || denomination === ""
        ? NaN
        : Number(denomination);
    if (Number.isFinite(denominationValue) && denominationValue >= 0) {
      params.set("denomination", String(denominationValue));
    }

    const response = await fetch(
      `${API_BASE_URL}/qmail/local/address/from-sn?${params.toString()}`,
    );
    const data = await handleResponse(response);
    if (data && data.success && data.email) {
      return {
        success: true,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        denomination: data.denomination,
      };
    }
    return { success: false, error: data.message || "Lookup failed" };
  } catch (error) {
    console.error("Convert SN to email failed:", error);
    return { success: false, error: error.message };
  }
};

// Version check
// Remote version file. Returns a bare date string like "2026-03-24" (no
// JSON, no .php extension). Hosted independently of the local backend so
// the version check does NOT depend on core.exe being up. The local build
// date it is compared against lives in src/version.js (BUILD_DATE).
const REMOTE_VERSION_URL =
  "https://raida11.cloudcoin.global/service/qmail_client_version";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks whether a newer client build is available by fetching the remote
 * version date and comparing it to the local BUILD_DATE. Does NOT touch the
 * local backend. YYYY-MM-DD strings compare correctly with plain ordering
 * (lexicographic == chronological for zero-padded ISO dates).
 *
 * @returns {Promise<{success: boolean, data?: {update_available: boolean,
 *   current_version: string, latest_version: string, message: string},
 *   error?: string}>}
 */
export const checkVersion = async () => {
  try {
    const response = await fetch(REMOTE_VERSION_URL, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Version endpoint returned ${response.status}`);
    }

    const latestVersion = (await response.text()).trim();
    if (!ISO_DATE_PATTERN.test(latestVersion)) {
      // Defensive: don't prompt for an update off a malformed response.
      throw new Error(`Unexpected version format: "${latestVersion}"`);
    }

    const updateAvailable = latestVersion > BUILD_DATE;
    return {
      success: true,
      data: {
        update_available: updateAvailable,
        current_version: BUILD_DATE,
        latest_version: latestVersion,
        message: updateAvailable
          ? "A newer version of QMail is available."
          : "QMail is up to date.",
      },
    };
  } catch (error) {
    console.error("Version check error:", error);
    return { success: false, error: error.message };
  }
};

const lookupWalletPathByName = async (walletName) => {
  try {
    const listRes = await fetch(`${API_BASE_URL}/wallets/list`);
    if (!listRes.ok) {
      return { path: null, reason: "network" };
    }
    const listData = await listRes.json();
    if (!listData || !Array.isArray(listData.wallets) || listData.wallets.length === 0) {
      // gpt-batch4 #3: backend reachable, but no wallets registered.
      // This is a "configure your wallet" failure, NOT a network
      // failure - they need different recovery messages.
      return { path: null, reason: "no_wallet" };
    }

    const target = String(walletName || "").trim().toLowerCase();
    const wallet = listData.wallets.find(
      (w) => String(w.wallet_name || w.name || "").trim().toLowerCase() === target,
    );
    const resolved = wallet?.wallet_path || wallet?.path || null;
    return resolved
      ? { path: resolved, reason: "ok" }
      : { path: null, reason: "no_wallet" };
  } catch (e) {
    console.warn(`lookupWalletPathByName: /wallets/list unreachable for ${walletName}:`, e);
    return { path: null, reason: "network" };
  }
};

/**
 * gpt-batch4 #2: shared helper to find the registered Mail wallet
 * filesystem path. Used by importCredentials to decide where to store
 * credentials. Returns null if the list call fails OR succeeds-but-empty;
 * callers can distinguish those cases by inspecting the reason.
 *
 * @returns {Promise<{path: string|null, reason: "ok"|"network"|"no_wallet"}>}
 */
export const lookupMailWalletPath = async () => lookupWalletPathByName("Mail");

export const lookupDefaultWalletPath = async () => lookupWalletPathByName("Default");

const LOCKER_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const generateLockerCode = () => {
  const pick = () => LOCKER_CODE_CHARS[Math.floor(Math.random() * LOCKER_CODE_CHARS.length)];
  return `${Array.from({ length: 3 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
};

export const normalizeLockerCode = (lockerCode) =>
  String(lockerCode || "").trim().toUpperCase();

export const validateLockerCode = (lockerCode) =>
  /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(
    normalizeLockerCode(lockerCode),
  );

const resolveDefaultWalletPathForOperation = async (walletPath = null) => {
  if (walletPath && String(walletPath).trim()) {
    return String(walletPath).trim();
  }

  const lookup = await lookupDefaultWalletPath();
  if (lookup.path) return lookup.path;

  throw new Error(
    lookup.reason === "no_wallet"
      ? "No Default wallet is registered on the QMail backend."
      : "Could not reach the QMail backend to look up the Default wallet.",
  );
};

const addWalletPathParam = async (url, walletPath = null) => {
  const resolvedPath = await resolveDefaultWalletPathForOperation(walletPath);
  url.searchParams.set("wallet_path", resolvedPath);
  return resolvedPath;
};

const normalizeReceiptFilename = (filename) => {
  const normalized = String(filename || "").trim().replace(/\\/g, "/");
  const basename = normalized.split("/").filter(Boolean).pop() || "";
  if (!basename || basename === "." || basename === "..") {
    throw new Error("Receipt filename is required.");
  }
  if (basename.includes("..")) {
    throw new Error("Invalid receipt filename.");
  }
  return basename;
};

export const getDefaultWalletReceipt = async (filename, walletPath = null) => {
  try {
    const receiptFilename = normalizeReceiptFilename(filename);
    const resolvedPath = await resolveDefaultWalletPathForOperation(walletPath);
    const query = new URLSearchParams({
      wallet_path: resolvedPath,
      filename: receiptFilename,
    });

    const response = await fetch(`${API_BASE_URL}/wallets/receipts?${query.toString()}`);
    const data = await handleResponse(response);
    if (!data || (data.success !== true && data.status !== "success") || data.content === undefined) {
      throw new Error(extractApiErrorMessage(data, "Invalid receipt response."));
    }

    return {
      success: true,
      data: {
        filename: data.filename || receiptFilename,
        walletPath: data.wallet_path || resolvedPath,
        content: data.content,
        size: data.size || null,
        raw: data,
      },
    };
  } catch (error) {
    console.error("Get Default wallet receipt failed:", error);
    return { success: false, error: error.message };
  }
};

const getTaskIdFromResponse = (data) =>
  data?.task_id || data?.taskId || data?.payload?.task_id || data?.payload?.id || null;

const CLOUDCOIN_DEPOSIT_EXTENSIONS = [".bin", ".stack", ".zip", ".png"];
const CLOUDCOIN_DEPOSIT_EXTENSION_LABEL = CLOUDCOIN_DEPOSIT_EXTENSIONS.join(", ");

const isSupportedCloudCoinDepositFile = (filePath) => {
  const normalized = String(filePath || "").trim().toLowerCase();
  return CLOUDCOIN_DEPOSIT_EXTENSIONS.some((extension) => normalized.endsWith(extension));
};

export const depositCloudCoinFiles = async (filePaths, memo = "QMail deposit", walletPath = null) => {
  try {
    const files = Array.isArray(filePaths)
      ? filePaths.map((file) => String(file || "").trim()).filter(Boolean)
      : [];
    if (files.length === 0) {
      throw new Error(`Choose at least one CloudCoin file (${CLOUDCOIN_DEPOSIT_EXTENSION_LABEL}).`);
    }

    const invalidFiles = files.filter((file) => !isSupportedCloudCoinDepositFile(file));
    if (invalidFiles.length > 0) {
      throw new Error(`Only CloudCoin ${CLOUDCOIN_DEPOSIT_EXTENSION_LABEL} files can be deposited.`);
    }

    const url = new URL(`${API_BASE_URL}/transactions/deposit`);
    files.forEach((file) => url.searchParams.append("file", file));
    if (memo && memo.trim()) url.searchParams.set("memo", memo.trim());
    const resolvedWalletPath = await addWalletPathParam(url, walletPath);

    const response = await fetch(url.toString());
    const data = await handleResponse(response);
    const taskId = getTaskIdFromResponse(data);
    if (!data?.success && !taskId) {
      throw new Error(extractApiErrorMessage(data, "Deposit did not start."));
    }

    return { success: true, data: { ...data, task_id: taskId, wallet_path: data?.wallet_path || resolvedWalletPath } };
  } catch (error) {
    console.error("Deposit CloudCoin files failed:", error);
    return { success: false, error: error.message };
  }
};

export const depositCloudCoinFolder = async (folderPath, memo = "QMail folder deposit", walletPath = null) => {
  try {
    const sourceFolder = String(folderPath || "").trim();
    if (!sourceFolder) {
      throw new Error("Choose a folder containing CloudCoin files.");
    }

    const url = new URL(`${API_BASE_URL}/transactions/deposit`);
    url.searchParams.set("source_folder", sourceFolder);
    if (memo && memo.trim()) url.searchParams.set("memo", memo.trim());
    const resolvedWalletPath = await addWalletPathParam(url, walletPath);

    const response = await fetch(url.toString());
    const data = await handleResponse(response);
    const taskId = getTaskIdFromResponse(data);
    if (!data?.success && !taskId) {
      throw new Error(extractApiErrorMessage(data, "Deposit did not start."));
    }

    return { success: true, data: { ...data, task_id: taskId, wallet_path: data?.wallet_path || resolvedWalletPath } };
  } catch (error) {
    console.error("Deposit CloudCoin folder failed:", error);
    return { success: false, error: error.message };
  }
};

export const downloadLockerToDefaultWallet = async (lockerCode, walletPath = null) => {
  try {
    const normalizedKey = normalizeLockerCode(lockerCode);
    if (!validateLockerCode(normalizedKey)) {
      throw new Error("Enter a locker code in the format XXX-XXXX.");
    }

    const url = new URL(`${API_BASE_URL}/locker/download`);
    url.searchParams.set("locker_key", normalizedKey);
    const resolvedWalletPath = await addWalletPathParam(url, walletPath);

    const response = await fetch(url.toString());
    const data = await handleResponse(response);
    if (data?.status !== "success" && data?.coins_saved === undefined) {
      throw new Error(extractApiErrorMessage(data, "Locker download failed."));
    }

    return { success: true, data: { ...data, locker_key: normalizedKey, wallet_path: data?.wallet_path || resolvedWalletPath } };
  } catch (error) {
    console.error("Download locker to Default wallet failed:", error);
    return { success: false, error: error.message };
  }
};

export const withdrawToLockerCode = async (amount, walletPath = null) => {
  try {
    const numericAmount = Number(amount);
    if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      throw new Error("Enter a positive whole-number CloudCoin amount.");
    }

    const lockerKey = generateLockerCode();
    const url = new URL(`${API_BASE_URL}/locker/upload`);
    url.searchParams.set("locker_key", lockerKey);
    url.searchParams.set("amount", String(numericAmount));
    const resolvedWalletPath = await addWalletPathParam(url, walletPath);

    const response = await fetch(url.toString());
    const data = await handleResponse(response);
    if (data?.status !== "success" && data?.coins_uploaded === undefined) {
      throw new Error(extractApiErrorMessage(data, "Locker withdraw failed."));
    }

    return { success: true, data: { ...data, locker_key: data?.locker_key || lockerKey, wallet_path: data?.wallet_path || resolvedWalletPath } };
  } catch (error) {
    console.error("Withdraw to locker failed:", error);
    return { success: false, error: error.message };
  }
};

export const waitForTaskCompletion = async (
  taskId,
  { timeoutMs = 180000, intervalMs = 1000, onUpdate } = {},
) => {
  if (!taskId) {
    return { success: false, error: "Task ID is required." };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await getTaskStatus(taskId);
    if (!result.success) {
      return result;
    }

    if (typeof onUpdate === "function") {
      onUpdate(result.data);
    }

    if (result.data?.isFinished) {
      return result.data.isSuccessful
        ? { success: true, data: result.data }
        : { success: false, error: result.data.error || result.data.message || "Task failed." };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    success: false,
    error: "The operation is still running. Refresh the wallet balance in a moment.",
    status: "timeout",
  };
};
/**
 * Imports credentials using a locker code.
 * Scenario 1 & 2: Success (Healthy or Healed)
 * Scenario 3: Invalid Format (400)
 * Scenario 5: Empty/Invalid Locker (404)
 */
export const importCredentials = async (lockerCode, walletPath = null) => {
  try {
    // API-FIX: Changed POST /setup/import-credentials with JSON body
    //          → GET /qmail/raida/locker/import-credentials?locker_key= (query param, like locker download)
    // API-FIX: Added required wallet_path parameter. The backend expects a full
    // filesystem path (the wallet_path field returned by /api/wallets/list), not
    // the bare wallet name "Default" - that produces 404 "Wallet not found".
    // Prefer the wallet named "Mail" - the backend saves credentials under
    // wallet_path/Mail and identity detection (qmail_users.c) prefers the
    // registered Mail wallet. Picking Default would write to Default/Mail
    // which qmail will not see as the identity.
    let resolvedPath = walletPath;
    let resolveReason = "ok";
    if (!resolvedPath) {
      const lookup = await lookupMailWalletPath();
      resolvedPath = lookup.path;
      resolveReason = lookup.reason;
    }
    if (!resolvedPath) {
      // gpt-batch4 #3: distinguish "backend unreachable" from
      // "backend reachable but no wallet registered." Both need
      // recovery, but different recovery.
      return {
        success: false,
        error:
          resolveReason === "no_wallet"
            ? "No wallet is registered on the QMail backend."
            : "Could not reach the QMail backend to look up wallets.",
        status: resolveReason === "no_wallet" ? "no_wallet" : "network",
      };
    }
    const response = await fetch(
      `${API_BASE_URL}/qmail/raida/locker/import-credentials?locker_key=${encodeURIComponent(lockerCode)}&wallet_path=${encodeURIComponent(resolvedPath)}`
    );

    const data = await response.json();

    if (response.ok) {
      return { success: true, data };
    } else {
      // Handles HTTP 400, 404, etc. handleImport switches on status.
      return {
        success: false,
        error: data.message || "Failed to import credentials",
        status: response.status,
      };
    }
  } catch (error) {
    console.error("Import API Error:", error);
    // FIX-13-0B: distinguish the network-fail catch from HTTP errors
    // so handleImport can show "backend unreachable" instead of a
    // generic "invalid code" message.
    return {
      success: false,
      error: "Network error: Server is unreachable",
      status: "network",
    };
  }
};

/**
 * Manually triggers the healing process for a fracked coin.
 */
export const healWallet = async () => {
  try {
    // API-FIX: Changed POST /api/wallet/heal → POST /api/qmail/raida/identity/heal
    const response = await fetch(`${API_BASE_URL}/qmail/raida/identity/heal`, {
      method: "POST",
    });
    return await handleResponse(response);
  } catch (error) {
    console.error("Heal API failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Prepares the coin for change/denominations.
 */
export const prepareChange = async (walletPath = null) => {
  try {
    // API-FIX: Changed POST /wallet/prepare-change → GET /coins/prepare-change with query params
    let url = `${API_BASE_URL}/coins/prepare-change`;
    if (walletPath) {
      url += `?wallet_path=${encodeURIComponent(walletPath)}`;
    }
    const response = await fetch(url);
    return await handleResponse(response);
  } catch (error) {
    console.error("Prepare Change API failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Checks if the user has an established identity.
 * @returns {Promise<{configured: boolean, ...} | null>}
 */
export const getIdentity = async () => {
  try {
    // API-FIX: Changed /api/account/identity → /api/qmail/local/identity/get
    const response = await fetch(`${API_BASE_URL}/qmail/local/identity/get`);
    if (response.ok) {
      const data = await response.json();
      const serialNumber = data.serial_number || 0;
      const result = {
        ...data,
        configured: data.registered === true && serialNumber > 0,
        identity: data.registered
          ? {
              sn: serialNumber,
              serial_number: serialNumber,
              denomination: data.denomination,
              email: data.address,
              address: data.address,
              display_name: data.display_name,
              first_name: data.first_name,
              last_name: data.last_name,
              description: data.description,
              class_name: data.class_name || data.class,
              beacon_raida: data.beacon_raida,
            }
          : null,
      };
      console.log("[getIdentity] Returned:", result);
      return result;
    }
    console.log("[getIdentity] Response not ok, status:", response.status);
    return null;
  } catch (error) {
    console.error("Identity check failed:", error);
    return null;
  }
};

/**
 * FIX-03: Normalize a getIdentity() (or import-credentials) response into
 * a flat UI-friendly shape that consumers can read without guessing field
 * names. Returns BOTH camelCase (preferred for new code) AND snake_case
 * aliases (preserve compatibility with existing consumers like
 * AccountPane and WalletSetupScreen).
 *
 * Pass null/undefined safely — returns null so callers can check.
 *
 * @param {object|null} raw - the getIdentity() response
 * @param {object} [opts]
 * @param {string} [opts.defaultDomain="qmail.cloud"] - domain to use when
 *   building pretty_address; the backend response does not carry one.
 * @returns {object|null}
 */
export const normalizeIdentityForUi = (raw, opts = {}) => {
  if (!raw) return null;
  const defaultDomain = opts.defaultDomain || "qmail.cloud";

  // The backend currently returns: address, serial_number, registered,
  // display_name, first_name, last_name, description, denomination,
  // class_name (or class), beacon_raida — plus a synthetic `configured`
  // flag and a nested `identity` object added by getIdentity(). We read
  // both top-level AND nested fields so callers can pass either shape.
  //
  // The import-credentials response is shaped differently (coins_found,
  // coins_saved, wallet_path, mail_wallet_path) and does NOT include
  // identity fields at all. Callers should run getIdentity() first and
  // pass that response here; passing raw import metadata returns a
  // sparse object with configured=false.
  // gpt-batch2 #5: actually read raw.identity.
  const nested = raw.identity || {};

  // gpt-batch2 #1: the backend already returns a fully-formed QMail
  // address in `address` (e.g. "Alice.Admin@Developer.C25.Giga"). DON'T
  // append a default domain to a value that already has one — that
  // produced "Alice.Admin@Developer.C25.Giga@qmail.cloud" for every
  // returning user. Only synthesize a domain when the source value
  // looks like a bare local-part.
  const rawAddress =
    raw.address ||
    raw.email ||
    raw.email_address ||
    nested.address ||
    nested.email ||
    "";

  // pretty_address: prefer an explicit backend value; otherwise use
  // rawAddress as-is if it already contains '@'; otherwise synthesize
  // local@defaultDomain.
  const explicitPretty = raw.pretty_address || raw.prettyAddress || nested.pretty_address || "";
  const prettyAddress =
    explicitPretty ||
    (rawAddress.includes("@")
      ? rawAddress
      : rawAddress
        ? `${rawAddress}@${defaultDomain}`
        : "");

  // address field on the returned shape: the local-part (text before @)
  // if rawAddress was a full email, otherwise rawAddress as-is.
  const address = rawAddress.includes("@") ? rawAddress.split("@")[0] : rawAddress;

  // Derive domain: from rawAddress if it had one, else default.
  const domain = rawAddress.includes("@")
    ? rawAddress.split("@").slice(1).join("@")
    : raw.domain || defaultDomain;

  const serialNumber =
    raw.serial_number || raw.serialNumber || nested.serial_number || nested.sn || 0;

  // needsHealing: backend doesn't expose a direct identity-health flag
  // yet (CORE-F is the hard prerequisite). Surface false here and let
  // FIX-10 wire the real signal once CORE-F lands.
  const needsHealing = Boolean(raw.needs_healing || raw.needsHealing || false);

  const configured = Boolean(
    raw.configured === true || (raw.registered === true && serialNumber > 0),
  );

  const displayName = raw.display_name || raw.displayName || nested.display_name || "";
  const firstName = raw.first_name || raw.firstName || nested.first_name || "";
  const lastName = raw.last_name || raw.lastName || nested.last_name || "";
  const autoAddress = raw.auto_address || raw.autoAddress || nested.auto_address || "";
  const className =
    raw.class_name || raw.className || raw.class || nested.class_name || "";

  // gpt-batch4 #2: preserve mail_wallet_path when present (only the
  // import-credentials response carries this; getIdentity() does not).
  // Callers can fall back to lookupMailWalletPath() if absent.
  const mailWalletPath =
    raw.mail_wallet_path || raw.mailWalletPath || nested.mail_wallet_path || null;

  return {
    // camelCase (new convention)
    address,
    prettyAddress,
    serialNumber,
    domain,
    displayName,
    firstName,
    lastName,
    autoAddress,
    description: raw.description || nested.description || "",
    className,
    beaconRaida: raw.beacon_raida || raw.beaconRaida || nested.beacon_raida || null,
    isHealthy: !needsHealing,
    needsHealing,
    configured,
    mailWalletPath,
    // snake_case aliases (preserve compatibility — existing consumers
    // read these). Updating every consumer in one ticket would risk
    // missing a callsite.
    pretty_address: prettyAddress,
    serial_number: serialNumber,
    email_address: prettyAddress,
    auto_address: autoAddress,
    needs_healing: needsHealing,
    display_name: displayName,
    first_name: firstName,
    last_name: lastName,
    class_name: className,
    mail_wallet_path: mailWalletPath,
    // Original raw response, for any consumer that needs fields we
    // didn't enumerate.
    raw,
  };
};

/**
 * Checks if the Mail wallet has any ID coin files (Bank or Fracked).
 * Uses local filesystem check via IPC (no API call needed).
 * @returns {Promise<{has_id: boolean} | null>}
 */
export const hasId = async () => {
  try {
    if (!window.electronAPI || !window.electronAPI.hasIdCoin) {
      console.warn("hasId: electronAPI.hasIdCoin not available (running in browser?)");
      return null;
    }
    return await window.electronAPI.hasIdCoin();
  } catch (error) {
    console.error("has-id check failed:", error);
    return null;
  }
};

/**
 * Polls for new email notifications (returns guids and sender info)
 */
export const getMailNotifications = async () => {
  try {
    // API-FIX: Changed /api/mail/notifications → /api/qmail/db/notifications/list
    const response = await fetch(`${API_BASE_URL}/qmail/db/notifications/list`);
    const data = await handleResponse(response);
    return {
      success: true,
      data: {
        ...data,
        notifications: (data.notifications || []).map((notification) => {
          const senderFields = withSenderFields(notification, "");
          return {
            ...notification,
            ...senderFields,
            id: notification.id ?? notification.notification_id ?? null,
            notificationId: notification.notification_id ?? notification.id ?? null,
            guid: notification.file_guid,
            fileGuid: notification.file_guid,
            sender_address:
              senderFields.sender_address ||
              notification.sender_name ||
              "",
          };
        }),
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Downloads the actual email text/content using the GUID
 */
// background=true asks the backend to download on a worker thread and return
// 202 immediately (the single-threaded HTTP server otherwise blocks every other
// request, including the inbox list, for the whole 30s+ download). Completion
// arrives via the SSE "new-mail" event. Interactive opens leave it false so they
// still get the synchronous body to render right away.
export const downloadEmailContent = async (guid, { background = false } = {}) => {
  try {
    // API-FIX: Changed GET /api/mail/download/{guid} → POST /api/qmail/net/messages/download?file_guid={guid}
    const asyncQuery = background ? "&async=1" : "";
    const response = await fetch(
      `${API_BASE_URL}/qmail/net/messages/download?file_guid=${guid}${asyncQuery}`,
      {
        method: "POST",
      },
    );
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      httpStatus: error.httpStatus,
      data: error.apiData || null,
      apiData: error.apiData || null,
    };
  }
};

export const dismissMailNotification = async ({ id, fileGuid, guid } = {}) => {
  try {
    const notificationId = id ?? null;
    const notificationGuid = fileGuid || guid || "";
    const query = notificationId
      ? `id=${encodeURIComponent(notificationId)}`
      : `file_guid=${encodeURIComponent(notificationGuid)}`;
    if (!notificationId && !notificationGuid) {
      throw new Error("Notification id or file GUID is required");
    }

    const response = await fetch(
      `${API_BASE_URL}/qmail/db/notifications/dismiss?${query}`,
      { method: "DELETE" },
    );
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      httpStatus: error.httpStatus,
      data: error.apiData || null,
    };
  }
};

/**
 * Gets the list of attachments for a specific email
 */
export const getMailAttachmentsList = async (guid) => {
  try {
    // API-FIX: Changed /api/mail/{guid}/attachments → /api/qmail/db/attachments/list?email_id={guid}
    const response = await fetch(`${API_BASE_URL}/qmail/db/attachments/list?email_id=${guid}`);
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Downloads a specific attachment and triggers the browser save dialog
 */
export const downloadMailAttachment = async (
  guid,
  n,
  defaultFilename = "downloaded_file",
  { expectedBytes = 0, onProgress, signal } = {},
) => {
  try {
    // API-FIX: Changed /api/mail/{guid}/attachment/{n} → /api/qmail/db/attachments/get?email_id={guid}&attachment_id={n}
    const response = await fetch(
      `${API_BASE_URL}/qmail/db/attachments/get?email_id=${guid}&attachment_id=${n}`,
      { signal },
    );

    if (!response.ok) {
      let errorData = null;
      try {
        errorData = await response.json();
      } catch {
        // Some transport failures return no JSON body.
      }
      const error = new Error(
        extractApiErrorMessage(
          errorData,
          `Server responded with ${response.status}`,
        ),
      );
      error.httpStatus = response.status;
      error.apiData = errorData;
      throw error;
    }

    // 1. Try to read the filename from the CORS-exposed header we just fixed!
    let filename = defaultFilename;
    const disposition = response.headers.get("Content-Disposition");
    if (disposition && disposition.indexOf("filename=") !== -1) {
      const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
        disposition,
      );
      if (matches != null && matches[1]) {
        filename = matches[1].replace(/['"]/g, "");
      }
    }

    const contentLength = response.headers.get("Content-Length");
    const operationIdHeader = response.headers.get("X-QMail-Operation-Id");
    const operationId =
      operationIdHeader &&
      OBJECT_TRANSFER_ID_PATTERN.test(operationIdHeader.trim())
        ? operationIdHeader.trim()
        : null;
    const headerBytes =
      contentLength && /^\d+$/.test(contentLength)
        ? Number(contentLength)
        : 0;
    const expectedByteCount = Number(expectedBytes);
    const totalBytes =
      Number.isFinite(headerBytes) && headerBytes > 0
        ? headerBytes
        : Number.isFinite(expectedByteCount) && expectedByteCount > 0
          ? expectedByteCount
          : 0;
    const reportProgress = (completed, done = false) => {
      if (typeof onProgress !== "function") return;
      const boundedCompleted =
        totalBytes > 0 ? Math.min(completed, totalBytes) : completed;
      const percentage =
        totalBytes > 0
          ? Math.min(100, (boundedCompleted / totalBytes) * 100)
          : done
            ? 100
            : 0;
      onProgress({
        completedBytes: String(Math.max(0, Math.trunc(boundedCompleted))),
        totalBytes: String(Math.max(0, Math.trunc(totalBytes))),
        percentage: Math.round(percentage * 10) / 10,
        done,
        operationId,
      });
    };

    reportProgress(0);

    // Let Chromium's blob storage spill large responses to disk instead of
    // retaining every response chunk in the renderer's V8 heap.
    const blob = await response.blob();
    reportProgress(blob.size, true);

    // 3. Create a temporary URL pointing to the Blob
    const url = window.URL.createObjectURL(blob);

    // 4. Create an invisible anchor tag, attach the URL, and click it!
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // 5. Clean up the DOM and memory
    // BUG-16 FIX: Delay revocation so the browser has time to read the blob
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 200);

    return {
      success: true,
      data: {
        filename,
        sizeBytes: String(blob.size),
        operationId,
      },
    };
  } catch (error) {
    const aborted = signal?.aborted || error?.name === "AbortError";
    const transferError = aborted
      ? null
      : normalizeTransferError(error?.apiData || error, {
          fallbackMessage: error.message,
          terminal: true,
        });
    if (!aborted) {
      console.error("Attachment download failed:", error);
    }
    return {
      success: false,
      status: aborted ? "aborted" : "error",
      error: aborted
        ? "Attachment download was cancelled."
        : transferError?.message || error.message,
      ...(transferError ? { transferError } : {}),
      ...(error?.httpStatus ? { httpStatus: error.httpStatus } : {}),
    };
  }
};

/**
 * Permanently deletes an email from the trash
 * @param {string} emailId - The email ID
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const deleteEmailPermanent = async (emailId) => {
  try {
    // API-FIX: Changed DELETE /api/mail/{emailId}/permanent → DELETE /api/qmail/db/messages/delete?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/db/messages/delete?email_id=${emailId}`, {
      method: "DELETE",
    });
    const data = await handleResponse(response);

    console.log("Data received from DELETE /qmail/db/messages/delete:", data);

    // API-FIX: Check data.success instead of data.status === "success"
    if (data && data.success) {
      return {
        success: true,
        data: {
          message: data.message,
          emailId: emailId,
        },
      };
    } else {
      throw new Error("Invalid response from permanent delete email endpoint");
    }
  } catch (error) {
    console.error("Permanent delete email failed:", error);
    return { success: false, error: error.message };
  }
};

export const emptyTrashFolder = async (emailIds = []) => {
  const ids = [...new Set(emailIds.filter(Boolean))];
  const results = [];

  for (const emailId of ids) {
    const result = await deleteEmailPermanent(emailId);
    results.push({ emailId, ...result });
  }

  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0,
    data: {
      requestedCount: ids.length,
      deletedCount: ids.length - failed.length,
      failedIds: failed.map((result) => result.emailId),
    },
    error:
      failed.length > 0
        ? `Failed to delete ${failed.length} message${failed.length === 1 ? "" : "s"}.`
        : null,
  };
};
