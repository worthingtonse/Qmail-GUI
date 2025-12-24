// --- src/api/qmailApiServices.js ---
// This file contains all QMail-specific API call functions.

// Define the base URL for your local server
const API_BASE_URL = "http://127.0.0.1:8080/api";

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
      return {
        success: true,
        data: {
          folder: data.folder || folder,
          emails: data.emails,
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
 * Pings the QMail server to check for new messages and beacon status.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const pingQMail = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/qmail/ping`);
    const data = await handleResponse(response);

    console.log("Data received from /qmail/ping:", data);

    if (data && data.status === "ok") {
      return {
        success: true,
        data: {
          status: data.status,
          timestamp: data.timestamp,
          beaconStatus: data.beacon_status,
          hasMail: data.has_mail || false,
          messageCount: data.message_count || 0,
          messages: data.messages || [],
        },
      };
    } else {
      throw new Error("Invalid response from qmail ping endpoint");
    }
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

/**
 * Sends an email via QMail.
 * @param {Object} emailData - Email data object
 * @param {Array<string>} emailData.to - Array of recipient addresses (required)
 * @param {Array<string>} emailData.cc - Array of CC addresses (optional)
 * @param {Array<string>} emailData.bcc - Array of BCC addresses (optional)
 * @param {string} emailData.subject - Email subject (required)
 * @param {string} emailData.subsubject - Secondary subject header (optional)
 * @param {string} emailData.body - Email body content (required)
 * @param {Array} emailData.attachments - Array of attachments (optional)
 * @param {number} emailData.storage_weeks - Storage duration in weeks (default: 8)
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const sendEmail = async (emailData) => {
  try {
    // Validate required fields
    if (
      !emailData.to ||
      !Array.isArray(emailData.to) ||
      emailData.to.length === 0
    ) {
      throw new Error("At least one recipient is required");
    }
    if (!emailData.subject) {
      throw new Error("Subject is required");
    }
    if (!emailData.body) {
      throw new Error("Email body is required");
    }

    // Build request payload
    const payload = {
      to: emailData.to,
      cc: emailData.cc || [],
      bcc: emailData.bcc || [],
      subject: emailData.subject,
      subsubject: emailData.subsubject || "",
      body: emailData.body,
      attachments: emailData.attachments || [],
      storage_weeks: emailData.storage_weeks || 8,
    };

    const response = await fetch(`${API_BASE_URL}/mail/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await handleResponse(response);

    console.log("Data received from /mail/send:", data);

    if (data && data.status === "accepted") {
      return {
        success: true,
        data: {
          status: data.status,
          taskId: data.task_id,
          message: data.message,
          fileGroupGuid: data.file_group_guid,
          fileCount: data.file_count,
          estimatedCost: data.estimated_cost,
        },
      };
    } else {
      throw new Error(data.message || "Failed to send email");
    }
  } catch (error) {
    console.error("Send email failed:", error);
    const errorMessage = `Error: ${error.message}\n\nFailed to send email.`;
    return { success: false, error: errorMessage };
  }
};
