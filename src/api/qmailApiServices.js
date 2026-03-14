// --- src/api/qmailApiServices.js ---
// This file contains all QMail-specific API call functions.

// API port is configurable via VITE_API_PORT env variable (default: 8080)
const API_PORT = import.meta.env.VITE_API_PORT || "8080";
const API_BASE_URL = `http://localhost:${API_PORT}/api`;
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
    // Prefer human-readable 'message', then 'details', then code-level 'error'
    const backendError =
      data.message ||
      data.details ||
      data.error ||
      `Server responded with ${response.status}`;
    throw new Error(backendError);
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
    // API-FIX: Changed /data/contacts/popular → /qmail/contacts/popular
    const url = `${API_BASE_URL}/qmail/contacts/popular?limit=${limit}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/contacts/popular:", data);

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
    // API-FIX: Changed /api/mail/list → /api/qmail/inbox, folder name → folder ID
    // sort: "newest" (default), "unread", "fee", "starred"
    const sortParam = sort && sort !== "newest" ? `&sort=${sort}` : "";
    const url = `${API_BASE_URL}/qmail/inbox?folder=${folderNameToId(folder)}&limit=${limit}&offset=${offset}${sortParam}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/inbox:", data);

    if (data && Array.isArray(data.emails)) {
      // Transform backend response to match frontend expectations
      const transformedEmails = data.emails.map((email) => ({
        // API-FIX: email.EmailID → email.email_id
        id: email.email_id,
        // API-FIX: email.Subject → email.subject
        subject: email.subject || "No Subject",
        // API-FIX: email.sender → email.sender_sn (serial number, convert to string)
        sender: String(email.sender_sn || "Unknown Sender"),
        senderEmail: String(email.sender_sn || ""),
        // API-FIX: email.ReceivedTimestamp → email.received_timestamp, removed SentTimestamp
        timestamp: email.received_timestamp,
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
    // API-FIX: Changed /api/mail/drafts → /api/qmail/drafts
    const response = await fetch(`${API_BASE_URL}/qmail/drafts`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/drafts:", data);

    // Check if there's an error in the response
    if (data.error || data.status === "error") {
      // Return empty drafts array for error cases (like invalid format)
      return {
        success: true,
        data: {
          drafts: [],
          error: data.error,
          details: data.details,
        },
      };
    }

    // If successful, return the drafts
    if (data && Array.isArray(data.drafts)) {
      return {
        success: true,
        data: {
          drafts: data.drafts,
        },
      };
    } else {
      // Handle unexpected response format
      return {
        success: true,
        data: {
          drafts: [],
        },
      };
    }
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
    // API-FIX: Changed /api/mail/draft → /api/qmail/draft
    const response = await fetch(`${API_BASE_URL}/qmail/draft`, {
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

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message || "Draft saved successfully",
          draftId: data.draft_id,
          timestamp: data.timestamp,
        },
      };
    } else {
      throw new Error(data.error || "Invalid response from draft endpoint");
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
    // API-FIX: Changed PUT /api/mail/draft/{id} → POST /api/qmail/draft/update?draft_id={id}
    const response = await fetch(`${API_BASE_URL}/qmail/draft/update?draft_id=${draftId}`, {
      // API-FIX: Changed method from PUT to POST
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

    console.log("Data received from POST /qmail/draft/update:", data);

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message || "Draft updated successfully",
          draftId: draftId,
          timestamp: data.timestamp,
        },
      };
    } else {
      throw new Error(
        data.error || "Invalid response from update draft endpoint",
      );
    }
  } catch (error) {
    console.error("Update draft failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to update draft.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Pings the QMail server to check for new messages and beacon status.
 * This endpoint performs an immediate RAIDA beacon check, bypassing the background monitor.
 * Use cases:
 * - On application startup to get current mail state
 * - When user clicks "Refresh" button to force immediate check
 * - To detect if Identity Coin needs healing (Status 200 Invalid AN)
 *
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
/**
 * Pings the QMail server to check for new messages and beacon status.
 * UPDATED: Handles missing beacon_status and maps notification_count.
 */
export const pingQMail = async () => {
  try {
    // API-FIX: Changed /api/qmail/ping → /api/qmail/check
    const response = await fetch(`${API_BASE_URL}/qmail/check`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/check:", data);

    // API-FIX: Backend /qmail/check returns { success, new_mail_count, total_remaining, notifications[] }
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
    const errorMessage = `Error: ${error.message}\n\nFailed to ping QMail server.`;
    return { success: false, error: errorMessage };
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
      return {
        success: true,
        data: {
          taskId: p.id || taskId,
          state: taskStatus,
          status: taskStatus,
          progress: p.progress || 0,
          message: p.message || '',
          result: p.data || null,
          error: isSuccess ? null : (p.message || null),
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

/**
 * Searches emails by query string.
 * @param {string} query - The search query string
 * @param {number} limit - Maximum number of results to return (default: 50)
 * @param {number} offset - Number of results to skip for pagination (default: 0)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const searchEmails = async (query, limit = 50, offset = 0) => {
  try {
    if (!query || query.trim() === "") {
      throw new Error("Search query is required");
    }

    const encodedQuery = encodeURIComponent(query);
    // API-FIX: Changed /api/data/emails/search?q= → /api/qmail/search?query=, removed offset param
    const url = `${API_BASE_URL}/qmail/search?query=${encodedQuery}&limit=${limit}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/search:", data);

    if (data) {
      return {
        success: true,
        data: {
          query: data.query || query,
          results: data.results || [],
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
    // API-FIX: Changed /api/mail/folders → /api/qmail/folders
    const response = await fetch(`${API_BASE_URL}/qmail/folders`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/folders:", data);

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
    // API-FIX: Changed /api/mail/count → /api/qmail/counts
    const response = await fetch(`${API_BASE_URL}/qmail/counts`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/counts:", data);

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
    const url = `${API_BASE_URL}/qmail/star?email_id=${encodeURIComponent(emailId)}&starred=${starred ? "true" : "false"}`;
    const response = await fetch(url);
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    console.error("Star email failed:", error);
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

    // API-FIX: Changed /api/mail/{emailId} → /api/qmail/read?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/read?email_id=${emailId}`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/read:", data);

    // API-FIX: Backend returns { success, email_id, subject, sender_sn, received_timestamp, is_read, is_starred, folder, body, body_length }
    if (data && (data.email_id || data.success)) {
      return {
        success: true,
        data: {
          // API-FIX: id mapped from data.email_id
          id: data.email_id || emailId,
          // API-FIX: from mapped from data.sender_sn (serial number as string)
          from: String(data.sender_sn),
          // API-FIX: subject mapped from data.subject
          subject: data.subject || "No Subject",
          // API-FIX: body mapped from data.body
          body: data.body || "",
          // API-FIX: timestamp mapped from data.received_timestamp
          timestamp: data.received_timestamp,
          // API-FIX: isRead mapped from data.is_read
          isRead: data.is_read,
          // API-FIX: folder mapped via folderIdToName
          folder: folderIdToName(data.folder),
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

    // API-FIX: Changed /api/mail/{emailId}/attachments → /api/qmail/attachments?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/attachments?email_id=${emailId}`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/attachments:", data);

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
 * Gets the list of contacts with optional search.
 * @param {string} query - Optional search query to filter contacts
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getContacts = async (query = "") => {
  try {
    // API-FIX: Changed /api/contacts → /api/qmail/contacts/list
    const url = `${API_BASE_URL}/qmail/contacts/list`;

    console.log("Fetching contacts from:", url);

    const response = await fetch(url);

    // Check if response is ok before trying to parse JSON
    if (!response.ok) {
      throw new Error(
        `Server responded with ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    console.log("Data received from /qmail/contacts/list:", data);

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
    let transformedContacts = contacts.map((contact) => ({
      // API-FIX: serial_number → userId
      userId:
        contact.serial_number ||
        contact.user_id ||
        contact.userId ||
        Math.random().toString(36).substr(2, 9),
      firstName: contact.first_name || contact.firstName || "",
      lastName: contact.last_name || contact.lastName || "",
      middleName: contact.middle_name || contact.middleName || "",
      autoAddress:
        contact.auto_address || contact.autoAddress || contact.email || "",
      description: contact.description || "",
      denomination: contact.denomination || "",
      className: contact.class_name || "",
      fullName:
        `${contact.first_name || contact.firstName || ""} ${contact.middle_name || contact.middleName ? " " + (contact.middle_name || contact.middleName) : ""} ${contact.last_name || contact.lastName || ""}`.trim() ||
        contact.denomination ||
        "Unknown Contact",
    }));

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
            contact.description.toLowerCase().includes(searchTerm)),
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
 * Adds a contact to the backend via POST /api/qmail/contacts/add
 * @param {object} contactData - { serial_number, denomination, first_name, last_name, description, class_name }
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const addContact = async (contactData) => {
  try {
    const params = new URLSearchParams();
    if (contactData.serial_number) params.append('serial_number', contactData.serial_number);
    if (contactData.denomination) params.append('denomination', contactData.denomination);
    if (contactData.first_name) params.append('first_name', contactData.first_name);
    if (contactData.last_name) params.append('last_name', contactData.last_name);
    if (contactData.description) params.append('description', contactData.description);
    if (contactData.class_name) params.append('class_name', contactData.class_name);

    const response = await fetch(`${API_BASE_URL}/qmail/contacts/add?${params.toString()}`, {
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
 * Deletes a contact from the backend via DELETE /api/qmail/contacts/delete
 * @param {number} serialNumber - The serial number of the contact to delete
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const deleteContact = async (serialNumber) => {
  try {
    const response = await fetch(
      `${API_BASE_URL}/qmail/contacts/delete?serial_number=${encodeURIComponent(serialNumber)}`,
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
 * Gets information about all RAIDA servers.
 * @param {boolean} includeUnavailable - Whether to include unavailable servers (default: false)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getServers = async (includeUnavailable = false) => {
  try {
    // API-FIX: Changed /api/data/servers → /api/qmail/status
    const url = `${API_BASE_URL}/qmail/status`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/status:", data);

    // API-FIX: Backend returns { success, servers: { count, list: [...] } }
    if (data && data.servers && Array.isArray(data.servers.list)) {
      return {
        success: true,
        data: {
          // API-FIX: data.servers.list → servers array
          servers: data.servers.list,
          totalServers: data.servers.count || data.servers.list.length,
          availableServers: data.servers.list.filter((s) => s.is_available).length,
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
 * Gets the current parity server configuration.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
// API-FIX: Parity server endpoint removed
export const getParityServer = async () => {
  return { success: false, error: 'Parity server endpoint removed' };
};

/**
 * Triggers manual sync of user directory and server records from RAIDA
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const syncData = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/sync`, {
      method: "POST",
    });
    const data = await handleResponse(response);

    console.log("Data received from /admin/sync:", data);

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message || "Sync completed",
          usersUpdated: data.users_synced || 0,
          serversUpdated: data.servers_synced || 0,
          timestamp: data.timestamp,
        },
      };
    } else {
      throw new Error("Invalid response from sync endpoint");
    }
  } catch (error) {
    console.error("Sync data failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to sync data.`;
    return { success: false, error: errorMessage };
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

/**
 * Gets the wallet balance and coin distribution across folders.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
// Renamed from getWalletBalance to getQMailWalletBalance to avoid
// name collision with apiService.js getWalletBalance (different endpoint/shape).
export const getQMailWalletBalance = async () => {
  try {
    // API-FIX: Changed /api/wallet/balance → /api/wallets/balance to match rest_core
    // rest_core requires wallet_path param; omitting it defaults to "Default" wallet
    const response = await fetch(`${API_BASE_URL}/wallets/balance`);
    const data = await handleResponse(response);

    console.log("Data received from /wallets/balance:", data);

    // API-FIX: rest_core returns { success, command, wallet_path, wallet_name,
    //   total_value, total_notes, bank_value, bank_notes, fracked_value, fracked_notes,
    //   limbo_value, limbo_notes }
    if (data && data.success) {
      return {
        success: true,
        data: {
          walletPath: data.wallet_path,
          walletName: data.wallet_name,
          totalCoins: data.total_notes || 0,
          totalValue: data.total_value || 0,
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
    // API-FIX: Changed PUT /api/mail/{emailId}/read → POST /api/qmail/mark-read?email_id={emailId}&is_read={isRead}
    const response = await fetch(`${API_BASE_URL}/qmail/mark-read?email_id=${emailId}&is_read=${isRead}`, {
      // API-FIX: Changed method from PUT to POST, removed JSON body
      method: "POST",
    });
    const data = await handleResponse(response);

    console.log("Data received from /qmail/mark-read:", data);

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
    // API-FIX: Changed PUT /api/mail/{emailId}/move → POST /api/qmail/move?email_id={emailId}&folder={folderId}
    const response = await fetch(`${API_BASE_URL}/qmail/move?email_id=${emailId}&folder=${folderNameToId(folder)}`, {
      // API-FIX: Changed method from PUT to POST, removed JSON body
      method: "POST",
    });
    const data = await handleResponse(response);

    console.log("Data received from /qmail/move:", data);

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
    // API-FIX: Changed DELETE /api/mail/{emailId} → DELETE /api/qmail/trash?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/trash?email_id=${emailId}`, {
      method: "DELETE",
    });
    const data = await handleResponse(response);

    console.log("Data received from DELETE /qmail/trash:", data);

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

// Locker download with polling
// export const downloadLockerCoins = async (lockerCode, onProgress) => {
//   try {
//     const cleanCode = lockerCode.replace(/-/g, '').trim();

//     // if (cleanCode.length !== 8) {
//     //   throw new Error('Locker code must be 8 characters');
//     // }

//     // Format with hyphen XXX-XXXXX
//     const formattedCode = cleanCode.slice(0, 3) + '-' + cleanCode.slice(3);

//     const response = await fetch(`${API_BASE_URL}/locker/download`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ locker_code: formattedCode })
//     });

//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new Error(errorData.error || errorData.details || 'Failed to download coins');
//     }

//     const data = await response.json();

//     // Check for immediate error
//     if (data.status === 'error') {
//       throw new Error(data.error || data.details || 'Invalid locker code');
//     }

//     // If task_id exists, poll for status
//     if (data.id || data.task_id) {
//       const taskId = data.id || data.task_id;
//       return await pollTaskStatus(taskId, onProgress);
//     }

//     return data;
//   } catch (error) {
//     console.error('Locker download error:', error);
//     throw error;
//   }
// };

// Create mailbox after locker download
// export const createMailbox = async (address, domain, lockerCode, recoveryEmail = null) => {
//   try {
//     const cleanCode = lockerCode.replace(/-/g, '').trim();

//     // Convert to hex
//     const hexCode = Array.from(cleanCode)
//       .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
//       .join('');

//     const response = await fetch(`${API_BASE_URL}/mail/create-mailbox`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         address,
//         domain,
//         locker_code: hexCode,
//         recovery_email: recoveryEmail
//       })
//     });

//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new Error(errorData.error || errorData.details || 'Failed to create mailbox');
//     }

//     const data = await response.json();

//     if (data.status === 'error') {
//       throw new Error(data.error || data.details || 'Failed to create mailbox');
//     }

//     return data;
//   } catch (error) {
//     console.error('Create mailbox error:', error);
//     throw error;
//   }
// };

export const sendEmail = async (emailData) => {
  try {
    const toList = Array.isArray(emailData.to) ? emailData.to : [];
    const ccList = Array.isArray(emailData.cc) ? emailData.cc : [];

    // Build URL-encoded form body (backend parses POST body as query params)
    const params = new URLSearchParams();
    if (toList.length > 0) params.set("to", toList.join(","));
    if (ccList.length > 0) params.set("cc", ccList.join(","));
    if (emailData.subject) params.set("subject", emailData.subject);
    if (emailData.body) params.set("body", emailData.body);
    params.set("storage_weeks",
      emailData.storage_weeks !== undefined ? String(emailData.storage_weeks) : "8");

    const response = await fetch(`${API_BASE_URL}/qmail/send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await handleResponse(response);
    console.log("Send API Response:", data);

    if (
      data &&
      (data.success || data.status === "success" || data.status === "accepted" || data.file_guid)
    ) {
      return {
        success: true,
        data: {
          message: data.message || "Email sent successfully",
          // Only set taskId for async operations (task_id field).
          // file_guid is the email identifier, NOT a pollable task.
          taskId: data.task_id || null,
          fileGuid: data.file_guid || null,
          timestamp: data.timestamp,
        },
      };
    } else {
      throw new Error(data.message || data.error || "Server rejected the email");
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
export const convertSnToEmail = async (sn) => {
  try {
    const response = await fetch(`${API_BASE_URL}/qmail/convert_coin_to_email?sn=${sn}`);
    const data = await handleResponse(response);
    if (data && data.success && data.email) {
      return { success: true, email: data.email, firstName: data.first_name, lastName: data.last_name };
    }
    return { success: false, error: data.message || "Lookup failed" };
  } catch (error) {
    console.error("Convert SN to email failed:", error);
    return { success: false, error: error.message };
  }
};

// Version check
export const checkVersion = async () => {
  try {
    // API-FIX: Changed /admin/version-check → /system/version-check
    const response = await fetch(`${API_BASE_URL}/system/version-check`);

    if (!response.ok) {
      throw new Error("Failed to check version");
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error("Version check error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Imports credentials using a locker code.
 * Scenario 1 & 2: Success (Healthy or Healed)
 * Scenario 3: Invalid Format (400)
 * Scenario 5: Empty/Invalid Locker (404)
 */
export const importCredentials = async (lockerCode) => {
  try {
    // API-FIX: Changed POST /setup/import-credentials with JSON body
    //          → GET /qmail/import-credentials?locker_key= (query param, like locker download)
    const response = await fetch(
      `${API_BASE_URL}/qmail/import-credentials?locker_key=${encodeURIComponent(lockerCode)}`
    );

    const data = await response.json();

    if (response.ok) {
      return { success: true, data };
    } else {
      // Handles HTTP 400, 404, etc.
      return {
        success: false,
        error: data.message || "Failed to import credentials",
        status: response.status,
      };
    }
  } catch (error) {
    console.error("Import API Error:", error);
    return { success: false, error: "Network error: Server is unreachable" };
  }
};

/**
 * Manually triggers the healing process for a fracked coin.
 */
export const healWallet = async () => {
  try {
    // API-FIX: Changed POST /api/wallet/heal → POST /api/qmail/heal-identity
    const response = await fetch(`${API_BASE_URL}/qmail/heal-identity`, {
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
    // API-FIX: Changed /api/account/identity → /api/qmail/identity
    const response = await fetch(`${API_BASE_URL}/qmail/identity`);
    if (response.ok) {
      const data = await response.json();
      // API-FIX: Backend returns { success, identity: { sn, denomination, email, ... } }
      // API-FIX: Add configured flag: true if identity exists and sn > 0
      return { ...data, configured: data.identity && data.identity.sn > 0 };
    }
    return null;
  } catch (error) {
    console.error("Identity check failed:", error);
    return null;
  }
};

/**
 * Checks if the Mail wallet has any ID coin files (Bank or Fracked).
 * @returns {Promise<{has_id: boolean} | null>}
 */
export const hasId = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/qmail/has-id`);
    if (response.ok) {
      return await response.json();
    }
    return null;
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
    // API-FIX: Changed /api/mail/notifications → /api/qmail/notifications
    const response = await fetch(`${API_BASE_URL}/qmail/notifications`);
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Downloads the actual email text/content using the GUID
 */
export const downloadEmailContent = async (guid) => {
  try {
    // API-FIX: Changed GET /api/mail/download/{guid} → POST /api/qmail/download?file_guid={guid}
    const response = await fetch(`${API_BASE_URL}/qmail/download?file_guid=${guid}`, {
      method: "POST",
    });
    const data = await handleResponse(response);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Gets the list of attachments for a specific email
 */
export const getMailAttachmentsList = async (guid) => {
  try {
    // API-FIX: Changed /api/mail/{guid}/attachments → /api/qmail/attachments?email_id={guid}
    const response = await fetch(`${API_BASE_URL}/qmail/attachments?email_id=${guid}`);
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
) => {
  try {
    // API-FIX: Changed /api/mail/{guid}/attachment/{n} → /api/qmail/attachment/download?email_id={guid}&attachment_id={n}
    const response = await fetch(
      `${API_BASE_URL}/qmail/attachment/download?email_id=${guid}&attachment_id=${n}`,
    );

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
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

    // 2. Convert the raw binary data into a Blob
    const blob = await response.blob();

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

    return { success: true };
  } catch (error) {
    console.error("Attachment download failed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Permanently deletes an email from the trash
 * @param {string} emailId - The email ID
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const deleteEmailPermanent = async (emailId) => {
  try {
    // API-FIX: Changed DELETE /api/mail/{emailId}/permanent → DELETE /api/qmail/delete-permanent?email_id={emailId}
    const response = await fetch(`${API_BASE_URL}/qmail/delete-permanent?email_id=${emailId}`, {
      method: "DELETE",
    });
    const data = await handleResponse(response);

    console.log("Data received from DELETE /qmail/delete-permanent:", data);

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