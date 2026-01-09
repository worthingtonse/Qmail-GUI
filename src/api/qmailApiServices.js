// --- src/api/qmailApiServices.js ---
// This file contains all QMail-specific API call functions.

// Define the base URL for your local server
const API_BASE_URL = "http://localhost:8080/api"
/**
 * A helper function to handle fetch responses.
 * It checks for network errors and non-ok responses.
 * @param {Response} response - The fetch Response object
 */
const handleResponse = async (response) => {
  if (!response.ok) {
    // Handle HTTP errors (e.g., 404, 500)
    throw new Error(
      `Server responded with ${response.status} ${response.statusText}`
    );
  }

  // Get the JSON response from the server
  const data = await response.json();
  return data;
};

/**
 * Gets the health status of the QMail Client Core service.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getHealthStatus = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    const data = await handleResponse(response);

    console.log("Data received from /health:", data);

    if (data && data.status) {
      return {
        success: true,
        data: {
          status: data.status,
          service: data.service || "QMail Client Core",
          version: data.version || "unknown",
          timestamp: data.timestamp || Date.now(),
        },
      };
    } else {
      throw new Error("Invalid response from health endpoint");
    }
  } catch (error) {
    console.error("Health check failed:", error);
    const errorMessage = `Error: ${error.message}\n\nIs the QMail server running?`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Gets the list of popular contacts from the DRD (Distributed Resource Directory).
 * @param {number} limit - Maximum number of contacts to return (default: 10)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getPopularContacts = async (limit = 10) => {
  try {
    const url = `${API_BASE_URL}/data/contacts/popular?limit=${limit}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /data/contacts/popular:", data);

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
export const getMailList = async (folder = "inbox", limit = 50, offset = 0) => {
  try {
    const url = `${API_BASE_URL}/mail/list?folder=${folder}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /mail/list:", data);

    if (data && Array.isArray(data.emails)) {
      // Transform backend response to match frontend expectations
      const transformedEmails = data.emails.map((email) => ({
        id: email.EmailID,
        subject: email.Subject || "No Subject",
        sender: "Unknown", // Backend doesn't provide sender in list view
        senderEmail: "",
        timestamp: email.ReceivedTimestamp || email.SentTimestamp,
        sentTimestamp: email.SentTimestamp,
        receivedTimestamp: email.ReceivedTimestamp,
        isRead: email.is_read || false,
        isStarred: email.is_starred || false,
        isTrashed: email.is_trashed || false,
        folder: email.folder || folder,
        // Add preview as empty - will be filled when full email is loaded
        preview: "",
        body: ""
      }));

      return {
        success: true,
        data: {
          folder: data.folder || folder,
          emails: transformedEmails,
          totalCount: data.total_count || 0,
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
    const response = await fetch(`${API_BASE_URL}/mail/drafts`);
    const data = await handleResponse(response);

    console.log("Data received from /mail/drafts:", data);

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
    const response = await fetch(`${API_BASE_URL}/mail/draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subject: draftData.subject || "",
        body: draftData.body || "",
        to: draftData.to || "",
        cc: draftData.cc || "",
        bcc: draftData.bcc || "",
        subsubject: draftData.subsubject || ""
      })
    });
    
    const data = await handleResponse(response);
    
    console.log("Data received from /mail/draft:", data);
    
    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message || "Draft saved successfully",
          draftId: data.draft_id,
          timestamp: data.timestamp
        }
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
    const response = await fetch(`${API_BASE_URL}/mail/draft/${draftId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subject: draftData.subject || "",
        body: draftData.body || "",
        to: draftData.to || "",
        cc: draftData.cc || "",
        bcc: draftData.bcc || "",
        subsubject: draftData.subsubject || ""
      })
    });
    
    const data = await handleResponse(response);
    
    console.log("Data received from PUT /mail/draft:", data);
    
    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message || "Draft updated successfully",
          draftId: draftId,
          timestamp: data.timestamp
        }
      };
    } else {
      throw new Error(data.error || "Invalid response from update draft endpoint");
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
export const pingQMail = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/qmail/ping`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/ping:", data);
// Handle different status responses
    if (data && data.status) {
      // Handle error status (offline, etc.)
      if (data.status === "error") {
        return {
          success: false,
          error: data.message || "Server returned error status"
        };
      }
      
      // Handle ok and healing statuses
      if (data.status === "ok" || data.status === "healing") {
        return {
          success: true,
          data: {
            status: data.status,
            timestamp: data.timestamp,
            beaconStatus: data.beacon_status,
            hasMail: data.has_mail || false,
            messageCount: data.message_count || 0,
            messages: data.messages || [],
            // Healing indicates Identity Coin is being repaired
            isHealing: data.status === "healing",
            healingMessage: data.status === "healing" 
              ? "Repairing mailbox identity... please wait." 
              : null
          },
        };
      }
    }
    
    throw new Error("Invalid response from qmail ping endpoint");
  } catch (error) {
    console.error("QMail ping failed:", error);
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

    const response = await fetch(`${API_BASE_URL}/task/status/${taskId}`);
    const data = await handleResponse(response);

    console.log("Data received from /task/status:", data);

    if (data && data.task_id) {
      return {
        success: true,
        data: {
          taskId: data.task_id,
          state: data.state,
          progress: data.progress || 0,
          message: data.message,
          result: data.result,
          error: data.error,
          createdAt: data.created_at,
          startedAt: data.started_at,
          completedAt: data.completed_at,
          isFinished: data.is_finished || false,
          isSuccessful: data.is_successful || false,
        },
      };
    } else {
      throw new Error("Invalid response from task status endpoint");
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
    const url = `${API_BASE_URL}/data/emails/search?q=${encodedQuery}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /data/emails/search:", data);

    if (data) {
      return {
        success: true,
        data: {
          query: data.query || query,
          results: data.results || [],
          count: data.count || 0,
          limit: data.limit || limit,
          offset: data.offset || offset,
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

/**
 * Polls a task status repeatedly until it completes or fails.
 * Useful for long-running operations like sending emails.
 * @param {string} taskId - The task ID to monitor
 * @param {number} pollInterval - How often to check status in milliseconds (default: 1000ms)
 * @param {number} maxAttempts - Maximum number of polling attempts (default: 60)
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const pollTaskStatus = async (
  taskId,
  pollInterval = 1000,
  maxAttempts = 60,
  onProgress = null
) => {
  try {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const result = await getTaskStatus(taskId);

      if (!result.success) {
        return result;
      }

      // Call progress callback if provided
      if (onProgress && typeof onProgress === "function") {
        onProgress(result.data);
      }

      // Check if task is finished
      if (result.data.isFinished) {
        return {
          success: result.data.isSuccessful,
          data: result.data,
          error:
            result.data.error ||
            (result.data.isSuccessful ? null : "Task failed"),
        };
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      attempts++;
    }

    // Max attempts reached
    return {
      success: false,
      error: `Task ${taskId} did not complete within ${
        (maxAttempts * pollInterval) / 1000
      } seconds`,
    };
  } catch (error) {
    console.error("Poll task status failed:", error);
    return {
      success: false,
      error: `Error polling task status: ${error.message}`,
    };
  }
};

// /**
//  * Sends an email via QMail.
//  * @param {Object} emailData - Email data object
//  * @param {Array<string>} emailData.to - Array of recipient addresses (required)
//  * @param {Array<string>} emailData.cc - Array of CC addresses (optional)
//  * @param {Array<string>} emailData.bcc - Array of BCC addresses (optional)
//  * @param {string} emailData.subject - Email subject (required)
//  * @param {string} emailData.subsubject - Secondary subject header (optional)
//  * @param {string} emailData.body - Email body content (required)
//  * @param {Array} emailData.attachments - Array of attachments (optional)
//  * @param {number} emailData.storage_weeks - Storage duration in weeks (default: 8)
//  * @returns {Promise<{success: boolean, data?: any, error?: string}>}
//  */
// export const sendEmail = async (emailData) => {
//   try {
//     // Validate required fields
//     if (
//       !emailData.to ||
//       !Array.isArray(emailData.to) ||
//       emailData.to.length === 0
//     ) {
//       throw new Error("At least one recipient is required");
//     }
//     if (!emailData.subject) {
//       throw new Error("Subject is required");
//     }
//     if (!emailData.body) {
//       throw new Error("Email body is required");
//     }

//     // Build request payload
//     const payload = {
//       to: emailData.to,
//       cc: emailData.cc || [],
//       bcc: emailData.bcc || [],
//       subject: emailData.subject,
//       subsubject: emailData.subsubject || "",
//       body: emailData.body,
//       attachments: emailData.attachments || [],
//       storage_weeks: emailData.storage_weeks || 8,
//     };

//     const response = await fetch(`${API_BASE_URL}/mail/send`, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(payload),
//     });

//     const data = await handleResponse(response);

//     console.log("Data received from /mail/send:", data);

//     if (data && data.status === "accepted") {
//       return {
//         success: true,
//         data: {
//           status: data.status,
//           taskId: data.task_id,
//           message: data.message,
//           fileGroupGuid: data.file_group_guid,
//           fileCount: data.file_count,
//           estimatedCost: data.estimated_cost,
//         },
//       };
//     } else {
//       throw new Error(data.message || "Failed to send email");
//     }
//   } catch (error) {
//     console.error("Send email failed:", error);
//     const errorMessage = `Error: ${error.message}\n\nFailed to send email.`;
//     return { success: false, error: errorMessage };
//   }
// };

/**
 * Gets the list of available mail folders.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getMailFolders = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/mail/folders`);
    const data = await handleResponse(response);

    console.log("Data received from /mail/folders:", data);

    if (data && Array.isArray(data.folders)) {
      return {
        success: true,
        data: {
          folders: data.folders.map((folder) => ({
            name: folder.name,
            displayName: folder.display_name,
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
    const response = await fetch(`${API_BASE_URL}/mail/count`);
    const data = await handleResponse(response);

    console.log("Data received from /mail/count:", data);

    if (data && data.counts) {
      return {
        success: true,
        data: {
          counts: data.counts,
          summary: data.summary || {
            total_emails: 0,
            total_unread: 0,
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
 * Gets complete metadata for a specific email by ID.
 * @param {string} emailId - The unique email identifier (32-character hex string)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getEmailById = async (emailId) => {
  try {
    if (!emailId || emailId.length !== 32) {
      throw new Error(
        "Invalid email ID. Must be a 32-character hexadecimal string."
      );
    }

    const response = await fetch(`${API_BASE_URL}/mail/${emailId}`);
    const data = await handleResponse(response);

    console.log("Data received from /mail/{id}:", data);

    if (data && data.id) {
      return {
        success: true,
        data: {
          id: data.id,
          from: data.from,
          to: data.to || [],
          cc: data.cc || [],
          subject: data.subject,
          timestamp: data.timestamp,
          isRead: data.is_read,
          folder: data.folder,
          attachments: (data.attachments || []).map((att) => ({
            fileType: att.file_type,
            filename: att.filename,
            size: att.size,
          })),
          bodyPreview: data.body_preview,
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
        "Invalid email ID. Must be a 32-character hexadecimal string."
      );
    }

    const response = await fetch(`${API_BASE_URL}/mail/${emailId}/attachments`);
    const data = await handleResponse(response);

    console.log("Data received from /mail/{id}/attachments:", data);

    if (data) {
      return {
        success: true,
        data: {
          emailId: data.email_id,
          attachments: (data.attachments || []).map((att) => ({
            attachmentId: att.attachment_id,
            name: att.name,
            fileExtension: att.file_extension,
            size: att.size,
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
    // Always call the base endpoint without search params
    const url = `${API_BASE_URL}/contacts`;
    
    console.log("Fetching contacts from:", url);
    
    const response = await fetch(url);
    
    // Check if response is ok before trying to parse JSON
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log("Data received from /contacts:", data);

    let contacts = [];

    // Handle different possible response formats
    if (data && Array.isArray(data.contacts)) {
      contacts = data.contacts;
    } else if (data && Array.isArray(data)) {
      contacts = data;
    } else {
      throw new Error("Invalid response format from contacts endpoint");
    }

    // Transform the contacts
    let transformedContacts = contacts.map((contact) => ({
      userId: contact.user_id || contact.userId || Math.random().toString(36).substr(2, 9),
      firstName: contact.first_name || contact.firstName || "",
      lastName: contact.last_name || contact.lastName || "",
      middleName: contact.middle_name || contact.middleName || "",
      autoAddress: contact.auto_address || contact.autoAddress || contact.email || "",
      description: contact.description || "",
      sendingFee: contact.sending_fee || contact.sendingFee || 0,
      beaconId: contact.beacon_id || contact.beaconId || "",
      fullName: `${contact.first_name || contact.firstName || ""} ${contact.middle_name || contact.middleName ? " " + (contact.middle_name || contact.middleName) : ""} ${contact.last_name || contact.lastName || ""}`.trim() || contact.name || "Unknown Contact",
    }));

    // If we have a search query, filter the results client-side
    if (query && query.trim() !== "") {
      const searchTerm = query.trim().toLowerCase();
      transformedContacts = transformedContacts.filter((contact) =>
        contact.fullName.toLowerCase().includes(searchTerm) ||
        contact.autoAddress.toLowerCase().includes(searchTerm) ||
        (contact.firstName && contact.firstName.toLowerCase().includes(searchTerm)) ||
        (contact.lastName && contact.lastName.toLowerCase().includes(searchTerm)) ||
        (contact.description && contact.description.toLowerCase().includes(searchTerm))
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

/**
 * Gets information about all RAIDA servers.
 * @param {boolean} includeUnavailable - Whether to include unavailable servers (default: false)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getServers = async (includeUnavailable = false) => {
  try {
    const url = `${API_BASE_URL}/data/servers?include_unavailable=${includeUnavailable}`;
    const response = await fetch(url);
    const data = await handleResponse(response);

    console.log("Data received from /data/servers:", data);

    if (data && Array.isArray(data.servers)) {
      return {
        success: true,
        data: {
          servers: data.servers,
          totalServers: data.count || data.servers.length,
          availableServers: data.servers.filter(s => s.is_available).length
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
export const getParityServer = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/servers/parity`);
    const data = await handleResponse(response);

    console.log("Data received from /admin/servers/parity:", data);

    if (data) {
      return {
        success: true,
        data: {
          status: data.status,
          parityServer: data.parity_server
            ? {
                serverId: data.parity_server.server_id,
                address: data.parity_server.ip_address,  // ← Changed from address to ip_address
                port: data.parity_server.port,
                isAvailable: data.parity_server.is_available,
              }
            : null,
          message: data.message || (data.status === 'configured' ? 'Parity server configured' : 'Not configured'),
        },
      };
    } else {
      throw new Error("Invalid response from parity server endpoint");
    }
  } catch (error) {
    console.error("Get parity server failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to fetch parity server configuration.`;
    return { success: false, error: errorMessage };
  }
};

/**
 * Triggers manual sync of user directory and server records from RAIDA
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const syncData = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/sync`, {
      method: 'POST'
    });
    const data = await handleResponse(response);

    console.log("Data received from /admin/sync:", data);

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message || 'Sync completed',
          usersUpdated: data.users_synced || 0,
          serversUpdated: data.servers_synced || 0,
          timestamp: data.timestamp
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
 * Gets the wallet balance and coin distribution across folders.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const getWalletBalance = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/wallet/balance`);
    const data = await handleResponse(response);

    console.log("Data received from /wallet/balance:", data);

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          walletPath: data.wallet_path,
          walletName: data.wallet_name,
          totalCoins: data.total_coins,
          totalValue: data.total_value,
          folders: {
            bank: {
              coins: data.folders.bank_coins,
              value: data.folders.bank_value
            },
            fracked: {
              coins: data.folders.fracked_coins,
              value: data.folders.fracked_value
            },
            limbo: {
              coins: data.folders.limbo_coins,
              value: data.folders.limbo_value
            }
          },
          denominations: data.denominations,
          warnings: data.warnings || []
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
    const response = await fetch(`${API_BASE_URL}/mail/${emailId}/read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_read: isRead })
    });
    const data = await handleResponse(response);

    console.log("Data received from /mail/{id}/read:", data);

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message,
          emailId: emailId,
          isRead: isRead
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
    const response = await fetch(`${API_BASE_URL}/mail/${emailId}/move`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ folder: folder })
    });
    const data = await handleResponse(response);

    console.log("Data received from /mail/{id}/move:", data);

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message,
          emailId: emailId,
          folder: folder
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
    const response = await fetch(`${API_BASE_URL}/mail/${emailId}`, {
      method: 'DELETE'
    });
    const data = await handleResponse(response);

    console.log("Data received from DELETE /mail/{id}:", data);

    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message,
          emailId: emailId
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
export const downloadLockerCoins = async (lockerCode, onProgress) => {
  try {
    const cleanCode = lockerCode.replace(/-/g, '').trim();
    
    // if (cleanCode.length !== 8) {
    //   throw new Error('Locker code must be 8 characters');
    // }

    // Format with hyphen XXX-XXXXX
    const formattedCode = cleanCode.slice(0, 3) + '-' + cleanCode.slice(3);

    const response = await fetch(`${API_BASE_URL}/locker/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locker_code: formattedCode })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.details || 'Failed to download coins');
    }

    const data = await response.json();

    // Check for immediate error
    if (data.status === 'error') {
      throw new Error(data.error || data.details || 'Invalid locker code');
    }

    // If task_id exists, poll for status
    if (data.id || data.task_id) {
      const taskId = data.id || data.task_id;
      return await pollTaskStatus(taskId, onProgress);
    }

    return data;
  } catch (error) {
    console.error('Locker download error:', error);
    throw error;
  }
};

// Create mailbox after locker download
export const createMailbox = async (address, domain, lockerCode, recoveryEmail = null) => {
  try {
    const cleanCode = lockerCode.replace(/-/g, '').trim();
    
    // Convert to hex
    const hexCode = Array.from(cleanCode)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');

    const response = await fetch(`${API_BASE_URL}/mail/create-mailbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        domain,
        locker_code: hexCode,
        recovery_email: recoveryEmail
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.details || 'Failed to create mailbox');
    }

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.error || data.details || 'Failed to create mailbox');
    }

    return data;
  } catch (error) {
    console.error('Create mailbox error:', error);
    throw error;
  }
};

/**
 * Sends an email
 * @param {Object} emailData
 * @param {string} emailData.to - Recipient address
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.body - Email body
 * @param {string} [emailData.cc] - CC recipients
 * @param {string} [emailData.bcc] - BCC recipients
 * @param {string} [emailData.subsubject] - Sub-subject
 * @param {Array} [emailData.attachments] - File attachments
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const sendEmail = async (emailData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/mail/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: emailData.to,
        subject: emailData.subject || "",
        body: emailData.body || "",
        cc: emailData.cc || "",
        bcc: emailData.bcc || "",
        subsubject: emailData.subsubject || "",
        attachments: emailData.attachments || []
      })
    });
    
    const data = await handleResponse(response);
    
    console.log("Data received from /mail/send:", data);
    
    if (data && data.status === "success") {
      return {
        success: true,
        data: {
          message: data.message || "Email sent successfully",
          taskId: data.task_id,
          timestamp: data.timestamp
        }
      };
    } else {
      throw new Error(data.error || "Invalid response from send endpoint");
    }
  } catch (error) {
    console.error("Send email failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to send email.`;
    return { success: false, error: errorMessage };
  }
};
