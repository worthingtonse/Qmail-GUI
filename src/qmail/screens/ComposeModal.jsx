import React, { useState, useEffect } from "react";
import { X, Send, Paperclip } from "lucide-react";
import "./QMailDashboard.css";
import { getDrafts } from "../../api/qmailApiServices";

const ComposeModal = ({ isOpen, onClose, onSend, replyTo }) => {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    if (isOpen) {
      if (replyTo) {
        setTo(replyTo.senderEmail);
        setSubject(`Re: ${replyTo.subject}`);
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
        setSubject("");
        setBody("");
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

  const handleSend = () => {
    if (!to || !subject) {
      alert("Please fill in the recipient and subject fields.");
      return;
    }
    setIsSending(true);
    // Simulate network delay
    setTimeout(() => {
      onSend({ to, subject, body });
      setIsSending(false);
    }, 1000);
  };

  return (
    <div className="compose-modal-overlay">
      <div className="compose-modal glass-container">
        <div className="compose-modal-header">
          <h3>{replyTo ? "Reply to Message" : "New Message"}</h3>
          <button onClick={onClose} className="close-modal-btn ghost">
            <X size={20} />
          </button>
        </div>
        <div className="compose-modal-body">
          <div className="form-group">
            <label htmlFor="to">To:</label>
            <input
              type="email"
              id="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={isSending}
              placeholder="recipient@example.com"
            />
          </div>
          <div className="form-group">
            <label htmlFor="subject">Subject:</label>
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
            <label htmlFor="body">Message:</label>
            <textarea
              id="body"
              placeholder="Write your message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isSending}
              rows={12}
            />
          </div>
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
