import React, { useState, useEffect } from "react";
import { X, Send, Paperclip, Loader } from "lucide-react";
import "./QMailDashboard.css";
import {
  getDrafts,
  sendEmail,
  pollTaskStatus,
} from "../../api/qmailApiServices";

const ComposeModal = ({ isOpen, onClose, onSend, replyTo }) => {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [subsubject, setSubsubject] = useState("");
  const [body, setBody] = useState("");
  const [storageWeeks, setStorageWeeks] = useState(8);
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (replyTo) {
        setTo(replyTo.senderEmail);
        setCc("");
        setBcc("");
        setSubject(`Re: ${replyTo.subject}`);
        setSubsubject("");
        setStorageWeeks(8);
        // Only include the body if the email has been "downloaded"
        if (replyTo.isDownloaded) {
          setBody(
            `\n\n\n--- On ${replyTo.timestamp}, ${
              replyTo.sender
            } wrote: ---\n> ${replyTo.body.replace(/\n/g, "\n> ")}`
          );
        } else {
          setBody("\n\n\n--- Original message not downloaded ---");
        }
      } else {
        // Reset for new message
        setTo("");
        setCc("");
        setBcc("");
        setSubject("");
        setSubsubject("");
        setBody("");
        setStorageWeeks(8);
        setSendProgress("");
        setShowAdvanced(false);
        // Load drafts when opening new compose
        loadDrafts();
      }
    }
  }, [isOpen, replyTo]);

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

  if (!isOpen) {
    return null;
  }

  const parseEmailList = (emailString) => {
    if (!emailString || emailString.trim() === "") {
      return [];
    }
    // Split by comma, trim whitespace, and filter out empty strings
    return emailString
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0);
  };

  const handleSend = async () => {
    // Validate required fields
    if (!to || to.trim() === "") {
      alert("Please provide at least one recipient.");
      return;
    }

    if (!subject || subject.trim() === "") {
      alert("Please provide a subject.");
      return;
    }

    setIsSending(true);
    setSendProgress("Preparing email...");

    try {
      // Parse email addresses
      const toList = parseEmailList(to);
      const ccList = parseEmailList(cc);
      const bccList = parseEmailList(bcc);

      // Validate email lists
      if (toList.length === 0) {
        throw new Error("At least one recipient is required");
      }

      // Build email data object matching the API structure
      const emailData = {
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: subject.trim(),
        subsubject: subsubject.trim() || "",
        body: body || "",
        attachments: [], // No attachments support yet
        storage_weeks: storageWeeks,
      };

      setSendProgress("Sending email...");

      // Call the sendEmail API
      const result = await sendEmail(emailData);

      if (result.success) {
        const taskId = result.data.taskId;
        setSendProgress(`Email queued (Task: ${taskId.substring(0, 8)}...)`);

        // Poll the task status to track sending progress
        const pollResult = await pollTaskStatus(
          taskId,
          1000, // Check every 1 second
          60, // Max 60 attempts (60 seconds)
          (progressData) => {
            // Update progress message
            if (progressData.message) {
              setSendProgress(progressData.message);
            } else if (progressData.progress !== undefined) {
              setSendProgress(`Progress: ${progressData.progress}%`);
            }
          }
        );

        if (pollResult.success) {
          setSendProgress("Email sent successfully!");
          // Wait a moment to show success message
          setTimeout(() => {
            onSend({ to, cc, bcc, subject, body });
            setIsSending(false);
            setSendProgress("");
          }, 1500);
        } else {
          throw new Error(pollResult.error || "Email sending failed");
        }
      } else {
        throw new Error(result.error || "Failed to queue email");
      }
    } catch (error) {
      console.error("Send email error:", error);
      alert(`Failed to send email: ${error.message}`);
      setIsSending(false);
      setSendProgress("");
    }
  };

  return (
    <div className="compose-modal-overlay">
      <div className="compose-modal glass-container">
        <div className="compose-modal-header">
          <h3>{replyTo ? "Reply to Message" : "New Message"}</h3>
          <button
            onClick={onClose}
            className="close-modal-btn ghost"
            disabled={isSending}
          >
            <X size={20} />
          </button>
        </div>
        <div className="compose-modal-body">
          <div className="form-group">
            <label htmlFor="to">To: *</label>
            <input
              type="text"
              id="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={isSending}
              placeholder="0006.1.12345678 (separate multiple with commas)"
            />
          </div>

          {/* Advanced options toggle */}
          <div className="advanced-toggle">
            <button
              type="button"
              className="toggle-advanced-btn ghost"
              onClick={() => setShowAdvanced(!showAdvanced)}
              disabled={isSending}
            >
              {showAdvanced ? "▼" : "▶"} Advanced Options
            </button>
          </div>

          {/* Advanced fields */}
          {showAdvanced && (
            <>
              <div className="form-group">
                <label htmlFor="cc">CC:</label>
                <input
                  type="text"
                  id="cc"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  disabled={isSending}
                  placeholder="0006.1.87654321 (separate multiple with commas)"
                />
              </div>
              <div className="form-group">
                <label htmlFor="bcc">BCC:</label>
                <input
                  type="text"
                  id="bcc"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  disabled={isSending}
                  placeholder="0006.1.11223344 (separate multiple with commas)"
                />
              </div>
              <div className="form-group">
                <label htmlFor="subsubject">Sub-Subject:</label>
                <input
                  type="text"
                  id="subsubject"
                  value={subsubject}
                  onChange={(e) => setSubsubject(e.target.value)}
                  disabled={isSending}
                  placeholder="Secondary subject header (optional)"
                />
              </div>
              <div className="form-group">
                <label htmlFor="storageWeeks">Storage Duration (weeks):</label>
                <input
                  type="number"
                  id="storageWeeks"
                  min="1"
                  max="52"
                  value={storageWeeks}
                  onChange={(e) =>
                    setStorageWeeks(parseInt(e.target.value) || 8)
                  }
                  disabled={isSending}
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="subject">Subject: *</label>
            <input
              type="text"
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isSending}
              placeholder="Email subject"
            />
          </div>
          <div className="form-group form-group-textarea">
            <label htmlFor="body">Message: *</label>
            <textarea
              id="body"
              placeholder="Write your message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isSending}
              rows={12}
            />
          </div>

          {/* Progress indicator */}
          {isSending && sendProgress && (
            <div className="send-progress">
              <Loader size={16} className="spinning" />
              <span>{sendProgress}</span>
            </div>
          )}
        </div>
        <div className="compose-modal-footer">
          <button
            className="send-button primary"
            onClick={handleSend}
            disabled={isSending}
          >
            <Send size={16} /> {isSending ? "Sending..." : "Send"}
          </button>
          <button className="attach-button secondary" disabled={isSending}>
            <Paperclip size={16} /> Attach
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComposeModal;
