import React, { useState, useEffect } from "react";
import { X, Send, Paperclip, Loader, Users, CheckCircle, AlertCircle } from "lucide-react";
import "./ComposeModal.css";
import {
  getDrafts,
  sendEmail,
  getTaskStatus,
  getContacts,
} from "../../api/qmailApiServices";

const ComposeModal = ({ isOpen, onClose, onSend, replyTo, walletBalance }) => {
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

  // Enhanced states for new functionality
  const [contacts, setContacts] = useState([]);
  const [showContactSuggestions, setShowContactSuggestions] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [taskId, setTaskId] = useState(null);
  const [sendingStatus, setSendingStatus] = useState(null); // 'sending', 'completed', 'failed'
  const [isPolling, setIsPolling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      // Load contacts when modal opens
      loadContacts();

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

      // Reset enhanced states
      setShowContactSuggestions(false);
      setContactQuery("");
      setTaskId(null);
      setSendingStatus(null);
      setIsPolling(false);
      setProgress(0);
      setError(null);
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

  // Enhanced task status polling
  const pollTaskStatus = async (taskId) => {
    if (!taskId || !isPolling) return;

    try {
      const result = await getTaskStatus(taskId);
      if (result.success) {
        const { status, progress: currentProgress, message } = result.data;
        
        setProgress(currentProgress || 0);
        setSendProgress(message || "Processing...");
        
        // Update sending status based on task status
        if (status === "completed") {
          setSendingStatus("completed");
          setIsPolling(false);
          setSendProgress("Email sent successfully!");
          setTimeout(() => {
            onSend({ to, cc, bcc, subject, body });
            setIsSending(false);
            setSendingStatus(null);
            setSendProgress("");
          }, 1500);
        } else if (status === "failed" || status === "error") {
          setSendingStatus("failed");
          setIsPolling(false);
          setError(message || "Failed to send email");
          setIsSending(false);
        } else if (status === "running" || status === "pending") {
          setSendingStatus("sending");
          // Continue polling
          setTimeout(() => pollTaskStatus(taskId), 1000);
        }
      } else {
        console.error("Failed to get task status:", result.error);
        setIsPolling(false);
        setSendingStatus("failed");
        setError("Failed to track email status");
        setIsSending(false);
      }
    } catch (error) {
      console.error("Task polling error:", error);
      setIsPolling(false);
      setSendingStatus("failed");
      setError("Failed to track email status");
      setIsSending(false);
    }
  };

  // Handle contact suggestions
  const handleToChange = (value) => {
    setTo(value);
    setContactQuery(value);
    setShowContactSuggestions(value.length > 1 && contacts.length > 0);
  };

  const handleContactSelect = (contact) => {
    setTo(contact.autoAddress || contact.email || contact.fullName);
    setShowContactSuggestions(false);
    setContactQuery("");
  };

  // Filter contacts for suggestions
  const filteredContacts = contacts.filter(contact =>
    contact.fullName.toLowerCase().includes(contactQuery.toLowerCase()) ||
    (contact.autoAddress && contact.autoAddress.toLowerCase().includes(contactQuery.toLowerCase()))
  );

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

    // Check wallet balance first (passed as prop)
    if (walletBalance && walletBalance.folders.bank.value < 1) {
      setError("Insufficient balance. You need at least 1 CC to send an email.");
      return;
    }

    // Validate required fields
    if (!to || to.trim() === "") {
      setError("Please provide at least one recipient.");
      return;
    }

    if (!subject || subject.trim() === "") {
      setError("Please provide a subject.");
      return;
    }

    setIsSending(true);
    setError(null);
    setSendingStatus("sending");
    setSendProgress("Preparing email...");
    setProgress(0);

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
      setProgress(10);

      // Call the sendEmail API
      const result = await sendEmail(emailData);

      if (result.success) {
        const newTaskId = result.data.taskId;
        setTaskId(newTaskId);
        setSendProgress(`Email queued for sending...`);
        setProgress(20);
        
        // Start enhanced task status polling
        if (newTaskId) {
          setIsPolling(true);
          setTimeout(() => pollTaskStatus(newTaskId), 1000);
        } else {
          // If no task ID, assume immediate success
          setSendingStatus("completed");
          setSendProgress("Email sent successfully!");
          setTimeout(() => {
            onSend({ to, cc, bcc, subject, body });
            setIsSending(false);
            setSendingStatus(null);
            setSendProgress("");
          }, 1500);
        }
      } else {
        throw new Error(result.error || "Failed to queue email");
      }
    } catch (error) {
      console.error("Send email error:", error);
      setError(`Failed to send email: ${error.message}`);
      setIsSending(false);
      setSendingStatus("failed");
      setSendProgress("");
    }
  };

  // Enhanced progress indicator
  const renderProgressIndicator = () => {
    if (!isSending && !sendProgress) return null;

    const getIcon = () => {
      switch (sendingStatus) {
        case "sending":
          return <Loader size={16} className="spinning" />;
        case "completed":
          return <CheckCircle size={16} style={{ color: 'var(--accent-success)' }} />;
        case "failed":
          return <AlertCircle size={16} style={{ color: 'var(--accent-danger)' }} />;
        default:
          return <Loader size={16} className="spinning" />;
      }
    };

    return (
      <div className="send-progress">
        {getIcon()}
        <span>{sendProgress}</span>
        {progress > 0 && progress < 100 && (
          <span>({Math.round(progress)}%)</span>
        )}
      </div>
    );
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
          {/* Error Message */}
          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              padding: 'var(--space-md)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--accent-danger)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--accent-danger)',
              marginBottom: 'var(--space-md)'
            }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Enhanced To field with contact suggestions */}
          <div className="form-group" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <label htmlFor="to" style={{ flex: 'none' }}>To: </label>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="text"
                  id="to"
                  value={to}
                  onChange={(e) => handleToChange(e.target.value)}
                  disabled={isSending}
                  placeholder="write address here"
                  style={{ width: '100%', paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowContactSuggestions(!showContactSuggestions)}
                  disabled={isSending}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    padding: '4px'
                  }}
                >
                  <Users size={16} />
                </button>
              </div>
            </div>
            
            {/* Contact Suggestions */}
            {showContactSuggestions && filteredContacts.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: 'var(--card-bg)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                zIndex: 1000,
                maxHeight: '200px',
                overflowY: 'auto'
              }}>
                {filteredContacts.slice(0, 5).map((contact, index) => (
                  <div 
                    key={contact.userId || index} 
                    onClick={() => handleContactSelect(contact)}
                    style={{
                      padding: 'var(--space-md)',
                      cursor: 'pointer',
                      borderBottom: index < filteredContacts.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      ':hover': {
                        backgroundColor: 'var(--card-hover)'
                      }
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--card-hover)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                  >
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {contact.fullName}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>
                      {contact.autoAddress}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            <label htmlFor="subject">Subject: </label>
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
            <label htmlFor="body">Message: </label>
            <textarea
              id="body"
              placeholder="Write your message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isSending}
              rows={12}
            />
          </div>

          {/* Enhanced Progress indicator */}
          {renderProgressIndicator()}

          {/* Draft info */}
          {drafts.length > 0 && !isSending && (
            <div style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-tertiary)',
              padding: 'var(--space-sm) 0'
            }}>
              {drafts.length} draft{drafts.length !== 1 ? 's' : ''} available
            </div>
          )}
        </div>
        <div className="compose-modal-footer">
          <button
            className="send-button primary"
            onClick={handleSend}
            disabled={isSending}
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
            ) : (
              <>
                <Send size={16} />
                Send
              </>
            )}
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