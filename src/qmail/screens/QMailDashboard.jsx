import React, { useState, useEffect } from "react";
import {
  Mail,
  Inbox,
  Send,
  Trash2,
  FileEdit,
  Search,
  Star,
  Tag,
  UserCheck,
  UserX,
  ShieldAlert,
  Users,
  Reply,
  UserCircle,
  RefreshCw,
  AlertCircle,
  Paperclip,
} from "lucide-react";
import ComposeModal from "./ComposeModal";
import ContactsPane from "./ContactsPane";
import AccountPane from "./AccountPane";
import {
  pingQMail,
  getMailList,
  getHealthStatus,
  searchEmails,
  getMailCount,
  getMailFolders,
  getEmailById,
  getDrafts,
  getEmailAttachments
} from "../../api/qmailApiServices";

import "./NavigationPane.css";
import "./EmailListPane.css";
import "./ReadingPane.css"; 

// Download progress statuses
const downloadStatuses = [
  { status: "QMail: Resolving QMail Servers' IP addresses...", progress: 0 },
  { status: "QMail: Pinging servers...", progress: 15 },
  { status: "QMail: Creating sessions...", progress: 30 },
  { status: "RAIDA: Getting Kerberos Tickets...", progress: 45 },
  { status: "QMail: Downloading qmail file...", progress: 60 },
  { status: "Program: Assembling qmail file stripes...", progress: 75 },
  { status: "Program: Decrypting qmail stripes...", progress: 90 },
  { status: "QMail: Finished downloading qmail with no errors", progress: 100 },
];

// Sender Avatar Component with Coin Badge
const SenderAvatar = ({ sender, status }) => {
  const getInitials = (name) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <div className="avatar-with-coins">
      <div className="sender-avatar-circle">
        <span>{getInitials(sender)}</span>
      </div>
      {status && status !== "none" && (
        <div className={`coin-badge ${status}`}>
          {status === "gold" ? "◈" : status === "silver" ? "◇" : "●"}
        </div>
      )}
    </div>
  );
};

// Email List Item
const EmailListItem = ({ email, onSelect, isSelected }) => (
  <div
    className={`email-list-item ${isSelected ? "selected" : ""} ${
      !email.isRead ? "unread" : ""
    }`}
    onClick={() => onSelect(email)}
  >
    <SenderAvatar sender={email.sender} status={email.senderStatus} />
    <div className="email-details">
      <div className="email-sender-row">
        <span className="email-sender">{email.sender}</span>
        {email.annoyanceReported && (
          <ShieldAlert
            size={14}
            className="annoyance-icon"
            title="Reported as annoying"
          />
        )}
        <Star
          size={14}
          className={`star-icon ${email.starred ? "starred" : ""}`}
        />
      </div>
      <div className="email-subject">{email.subject}</div>
      <div className="email-preview">{email.preview}</div>
      <div className="email-tags">
        {email.tags &&
          email.tags.map((tag) => (
            <span key={tag} className={`tag tag-${tag}`}>
              {tag}
            </span>
          ))}
      </div>
    </div>
    <div className="email-timestamp">{email.timestamp}</div>
  </div>
);

// Navigation Pane with enhanced folder support
const NavigationPane = ({
  activeView,
  setActiveView,
  onComposeClick,
  mailCounts,
  onRefresh,
  isRefreshing,
  draftsCount
}) => (
  <aside className="navigation-pane">
    <div className="compose-button-container">
      <button className="compose-button primary" onClick={onComposeClick}>
        <FileEdit size={18} />
        <span>Compose</span>
      </button>
    </div>
    <nav className="nav-links">
      <a
        href="#"
        className={`nav-link ${activeView === "inbox" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          setActiveView("inbox");
        }}
      >
        <Inbox size={18} />
        <span>Inbox</span>
        {mailCounts.inbox && mailCounts.inbox.unread > 0 && (
          <span className="email-count">{mailCounts.inbox.unread}</span>
        )}
      </a>
      <a href="#" className="nav-link">
        <Star size={18} />
        <span>Starred</span>
      </a>
      <a
        href="#"
        className={`nav-link ${activeView === "sent" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          setActiveView("sent");
        }}
      >
        <Send size={18} />
        <span>Sent</span>
        {mailCounts.sent && mailCounts.sent.total > 0 && (
          <span className="email-count-info">{mailCounts.sent.total}</span>
        )}
      </a>
      <a
        href="#"
        className={`nav-link ${activeView === "drafts" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          setActiveView("drafts");
        }}
      >
        <FileEdit size={18} />
        <span>Drafts</span>
        {draftsCount > 0 && (
          <span className="email-count-info">{draftsCount}</span>
        )}
      </a>
      <a
        href="#"
        className={`nav-link ${activeView === "contacts" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          setActiveView("contacts");
        }}
      >
        <Users size={18} />
        <span>Contacts</span>
      </a>
      <a
        href="#"
        className={`nav-link ${activeView === "account" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          setActiveView("account");
        }}
      >
        <UserCircle size={18} />
        <span>Account</span>
      </a>
      <a
        href="#"
        className={`nav-link ${activeView === "trash" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          setActiveView("trash");
        }}
      >
        <Trash2 size={18} />
        <span>Trash</span>
        {mailCounts.trash && mailCounts.trash.total > 0 && (
          <span className="email-count-info">{mailCounts.trash.total}</span>
        )}
      </a>
    </nav>
    <div className="labels-section">
      <h3 className="labels-title">
        <Tag size={16} />
        <span>Labels</span>
      </h3>
      <div className="label-links">
        <a href="#" className="label-link">
          <span className="label-dot label-work"></span>
          <span>Work</span>
        </a>
        <a href="#" className="label-link">
          <span className="label-dot label-development"></span>
          <span>Development</span>
        </a>
        <a href="#" className="label-link">
          <span className="label-dot label-personal"></span>
          <span>Personal</span>
        </a>
        <a href="#" className="label-link">
          <span className="label-dot label-deployment"></span>
          <span>Deployment</span>
        </a>
      </div>
    </div>
    <div className="refresh-container">
      <button
        className="refresh-button secondary"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw size={16} className={isRefreshing ? "spinning" : ""} />
        <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
      </button>
    </div>
  </aside>
);

// Email List Pane
const EmailListPane = ({
  emails,
  onSelectEmail,
  selectedEmail,
  onSearch,
  isLoading,
  currentFolder
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    onSearch(value);
  };

  const getFolderTitle = (folder) => {
    switch (folder) {
      case 'inbox': return 'Inbox';
      case 'sent': return 'Sent Messages';
      case 'drafts': return 'Draft Messages';
      case 'trash': return 'Trash';
      default: return folder.charAt(0).toUpperCase() + folder.slice(1);
    }
  };

  return (
    <section className="email-list-pane">
      <div className="search-bar-container">
        <div className="search-bar">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder={`Search ${getFolderTitle(currentFolder).toLowerCase()}...`}
            value={searchQuery}
            onChange={handleSearch}
            className="search-input"
          />
        </div>
      </div>

      <div className="email-list-header">
        <h3 className="email-list-title">{getFolderTitle(currentFolder)}</h3>
        <span className="email-count-total">
          {emails.length} {emails.length === 1 ? 'message' : 'messages'}
        </span>
      </div>

      <div className="email-list">
        {isLoading ? (
          <div className="loading-state">
            <RefreshCw size={24} className="spinning" />
            <p>Loading {getFolderTitle(currentFolder).toLowerCase()}...</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="empty-state">
            <Mail size={48} />
            <h3>No emails found</h3>
            <p>
              {searchQuery 
                ? `No emails matching "${searchQuery}" in ${getFolderTitle(currentFolder).toLowerCase()}`
                : `Your ${getFolderTitle(currentFolder).toLowerCase()} is empty`
              }
            </p>
          </div>
        ) : (
          emails.map((email) => (
            <EmailListItem
              key={email.id}
              email={email}
              onSelect={onSelectEmail}
              isSelected={selectedEmail && selectedEmail.id === email.id}
            />
          ))
        )}
      </div>
    </section>
  );
};

// Enhanced Reading Pane with FULL attachment support
const ReadingPane = ({ email, onReply, onMarkAsDownloaded, attachments = [] }) => {
  if (!email) {
    return (
      <section className="reading-pane">
        <div className="reading-pane-empty">
          <Mail size={48} />
          <h3>Select an email to read</h3>
          <p>Choose a message from the list to view its contents here.</p>
        </div>
      </section>
    );
  }

  const handleDownload = () => {
    console.log("Downloading email:", email.id);
    onMarkAsDownloaded(email.id);
  };

  const handleAttachmentDownload = (attachment) => {
    console.log("Downloading attachment:", attachment.attachmentId || attachment.name);
    // Here you would implement actual attachment download
    // You could use the attachment ID to fetch the actual file content
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  const getFileTypeIcon = (extension) => {
    const ext = extension?.toLowerCase();
    switch (ext) {
      case 'pdf': return '📄';
      case 'doc':
      case 'docx': return '📝';
      case 'xls':
      case 'xlsx': return '📊';
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif': return '🖼️';
      case 'zip':
      case 'rar': return '📦';
      default: return '📎';
    }
  };

  return (
    <section className="reading-pane">
      <div className="reading-pane-header">
        <div className="email-meta">
          <h2 className="email-subject-full">{email.subject}</h2>
          <div className="sender-info">
            <SenderAvatar sender={email.sender} status={email.senderStatus} />
            <div className="sender-details">
              <span className="sender-name">{email.sender}</span>
              <span className="sender-email">{email.senderEmail}</span>
              <span className="email-time">{email.timestamp}</span>
            </div>
          </div>
        </div>
        <div className="email-actions">
          {onReply && (
            <button 
              className="action-button secondary" 
              onClick={() => onReply(email)}
              title="Reply to email"
            >
              <Reply size={16} />
              Reply
            </button>
          )}
          {!email.isDownloaded && onMarkAsDownloaded && (
            <button 
              className="action-button primary" 
              onClick={handleDownload}
              title="Download email"
            >
              <Mail size={16} />
              Download
            </button>
          )}
        </div>
      </div>

      <div className="reading-pane-body">
        {email.isDownloaded ? (
          <>
            <div className="email-content">
              <p>{email.body || email.preview || "This email content is not available."}</p>
            </div>
            
            {/* FULL ATTACHMENTS IMPLEMENTATION */}
            {attachments && attachments.length > 0 && (
              <div className="attachments-section">
                <h4 className="attachments-title">
                  <Paperclip size={16} />
                  Attachments ({attachments.length})
                </h4>
                <div className="attachments-list">
                  {attachments.map((attachment, index) => (
                    <div 
                      key={attachment.attachmentId || index} 
                      className="attachment-item"
                      onClick={() => handleAttachmentDownload(attachment)}
                    >
                      <div className="attachment-icon">
                        {getFileTypeIcon(attachment.fileExtension)}
                      </div>
                      <div className="attachment-info">
                        <div className="attachment-name">
                          {attachment.name || `Attachment ${index + 1}`}
                        </div>
                        <div className="attachment-details">
                          <span className="attachment-size">
                            {formatFileSize(attachment.size)}
                          </span>
                          {attachment.fileExtension && (
                            <span className="attachment-type">
                              {attachment.fileExtension.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="attachment-download">
                        <button 
                          className="download-btn ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAttachmentDownload(attachment);
                          }}
                          title="Download attachment"
                        >
                          <Paperclip size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Attachment Summary */}
                <div className="attachments-summary">
                  <span className="text-sm text-tertiary">
                    Total size: {formatFileSize(
                      attachments.reduce((total, att) => total + (att.size || 0), 0)
                    )}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="email-not-downloaded">
            <div className="download-status">
              <RefreshCw size={24} />
              <p>This email needs to be downloaded to view its full content.</p>
              {onMarkAsDownloaded && (
                <button 
                  className="download-button primary" 
                  onClick={handleDownload}
                >
                  <Mail size={16} />
                  Download Email
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

// Main Dashboard Component
const QMailDashboard = () => {
  // State for different views and data
  const [activeView, setActiveView] = useState("inbox");
  const [currentFolder, setCurrentFolder] = useState("inbox");
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [emails, setEmails] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [mailCounts, setMailCounts] = useState({
    inbox: { unread: 0, total: 0 },
    sent: { unread: 0, total: 0 },
    drafts: { unread: 0, total: 0 },
    trash: { unread: 0, total: 0 }
  });
  const [folders, setFolders] = useState([]);
  const [messageCount, setMessageCount] = useState(0);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [replyToEmail, setReplyToEmail] = useState(null);
  const [notification, setNotification] = useState(null);
  const [serverHealth, setServerHealth] = useState(null);
  const [emailAttachments, setEmailAttachments] = useState([]);
  const [searchDebounceTimer, setSearchDebounceTimer] = useState(null);
  const [userAccount, setUserAccount] = useState({
    name: "John Doe",
    email: "john.doe@qmail.cloud",
    balance: 150,
    status: "verified"
  });

  // Load initial data
  useEffect(() => {
    loadInitialData();
    
    // Auto-refresh every 2 minutes
    const interval = setInterval(() => {
      checkForNewMail();
    }, 120000);

    return () => {
      clearInterval(interval);
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
    };
  }, []);

  // Show notifications temporarily
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      // Load health status first
      await loadServerHealth();
      
      // Load folders and mail counts
      await Promise.all([
        loadFolders(),
        loadMailCounts(),
        loadDrafts()
      ]);
      
      // Load emails for current folder
      await loadEmails(currentFolder);
      
      // Check for new mail
      await checkForNewMail();
    } catch (error) {
      console.error("Error loading initial data:", error);
      setNotification("Error loading dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const loadServerHealth = async () => {
    try {
      const result = await getHealthStatus();
      if (result.success) {
        setServerHealth(result.data);
        console.log("Server health loaded:", result.data);
      } else {
        console.error("Failed to load server health:", result.error);
        setServerHealth({ status: "error", message: result.error });
      }
    } catch (error) {
      console.error("Health check error:", error);
      setServerHealth({ status: "error", message: "Health check failed" });
    }
  };

  const loadDrafts = async () => {
    try {
      const result = await getDrafts();
      if (result.success) {
        const draftsList = result.data.drafts || [];
        setDrafts(draftsList);
        console.log("Drafts loaded:", draftsList);
        
        // Update mail counts with drafts count
        setMailCounts(prev => ({
          ...prev,
          drafts: { total: draftsList.length, unread: 0 }
        }));
      } else {
        console.error("Failed to load drafts:", result.error);
        setDrafts([]);
      }
    } catch (error) {
      console.error("Drafts loading error:", error);
      setDrafts([]);
    }
  };

  const checkForNewMail = async () => {
    try {
      const result = await pingQMail();
      if (result.success) {
        setMessageCount(result.data.messageCount);
        if (result.data.hasMail) {
          loadEmails(currentFolder);
          setNotification("New mail received!");
        }
      } else {
        console.error("Ping failed:", result.error);
        setNotification("Server connection error");
      }
    } catch (error) {
      console.error("Ping error:", error);
      setNotification("Server connection error");
    }
  };

  const loadFolders = async () => {
    const result = await getMailFolders();
    if (result.success) {
      setFolders(result.data.folders);
      console.log("Folders loaded:", result.data.folders);
    } else {
      console.error("Failed to load folders:", result.error);
      // Set default folders as fallback
      setFolders([
        { name: "inbox", displayName: "Inbox" },
        { name: "sent", displayName: "Sent" },
        { name: "drafts", displayName: "Drafts" },
        { name: "trash", displayName: "Trash" },
      ]);
    }
  };

  const loadMailCounts = async () => {
    const result = await getMailCount();
    if (result.success) {
      setMailCounts(result.data.counts);
      console.log("Mail counts loaded:", result.data.counts);
    } else {
      console.error("Failed to load mail counts:", result.error);
    }
  };

  const loadEmails = async (folder) => {
    setLoading(true);
    
    try {
      // Handle drafts separately
      if (folder === 'drafts') {
        await loadDrafts();
        // Transform drafts to match email structure
        const transformedDrafts = drafts.map((draft) => ({
          id: draft.id || `draft_${Date.now()}_${Math.random()}`,
          sender: "You (Draft)",
          senderEmail: userAccount.email,
          subject: draft.subject || "No Subject",
          body: draft.body || draft.content || "",
          preview: draft.preview || (draft.body ? draft.body.substring(0, 100) : ""),
          timestamp: draft.timestamp || draft.created_at || new Date().toLocaleTimeString(),
          isRead: true,
          isDownloaded: true,
          tags: draft.tags || [],
          starred: false,
          annoyanceReported: false,
          senderStatus: "none",
          isDraft: true,
        }));
        setEmails(transformedDrafts);
        if (transformedDrafts.length > 0 && !selectedEmail) {
          setSelectedEmail(transformedDrafts[0]);
        }
        setLoading(false);
        return;
      }

      // Handle regular email folders
      const result = await getMailList(folder, 50, 0);
      if (result.success) {
        // Transform API data to match your email structure
        const transformedEmails = result.data.emails.map((email) => ({
          id: email.id || Date.now() + Math.random(),
          sender: email.sender || "Unknown",
          senderEmail: email.senderEmail || email.from || "",
          subject: email.subject || "No Subject",
          body: email.body || email.content || "",
          preview:
            email.preview ||
            email.snippet ||
            (email.body ? email.body.substring(0, 100) : ""),
          timestamp:
            email.timestamp || email.date || new Date().toLocaleTimeString(),
          isRead: email.isRead || email.read || false,
          isDownloaded: email.isDownloaded || false,
          tags: email.tags || [],
          starred: email.starred || false,
          annoyanceReported: email.annoyanceReported || false,
          senderStatus: email.senderStatus || "none",
        }));
        setEmails(transformedEmails);
        if (transformedEmails.length > 0 && !selectedEmail) {
          setSelectedEmail(transformedEmails[0]);
        }
      } else {
        console.error("Failed to load emails:", result.error);
        setEmails([]);
        setNotification("Failed to load emails");
      }
    } catch (error) {
      console.error("Email loading error:", error);
      setEmails([]);
      setNotification("Error loading emails");
    } finally {
      setLoading(false);
    }
  };

  const handleFolderChange = (folder) => {
    setCurrentFolder(folder);
    setActiveView(folder);
    setSelectedEmail(null); // Clear selection when changing folders
    loadEmails(folder);
  };

  const handleSearch = async (query) => {
    // Clear existing timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    // If query is empty, reload current folder
    if (query.trim() === "") {
      loadEmails(currentFolder);
      return;
    }

    // Debounce search by 500ms
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchEmails(query, 50, 0);
      if (result.success) {
        const transformedEmails = result.data.results.map((email) => ({
          id: email.id || Date.now() + Math.random(),
          sender: email.sender || "Unknown",
          senderEmail: email.senderEmail || email.from || "",
          subject: email.subject || "No Subject",
          body: email.body || email.content || "",
          preview:
            email.preview ||
            email.snippet ||
            (email.body ? email.body.substring(0, 100) : ""),
          timestamp:
            email.timestamp || email.date || new Date().toLocaleTimeString(),
          isRead: email.isRead || email.read || false,
          isDownloaded: email.isDownloaded || false,
          tags: email.tags || [],
          starred: email.starred || false,
          annoyanceReported: email.annoyanceReported || false,
          senderStatus: email.senderStatus || "none",
        }));
        setEmails(transformedEmails);
        setSelectedEmail(
          transformedEmails.length > 0 ? transformedEmails[0] : null
        );
      } else {
        console.error("Search failed:", result.error);
        setNotification("Search failed");
      }
      setLoading(false);
    }, 500);

    setSearchDebounceTimer(timer);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await checkForNewMail();
    await loadEmails(currentFolder);
    await loadDrafts(); // Refresh drafts count
    setIsRefreshing(false);
    setNotification("Refreshed successfully");
  };

  // ENHANCED EMAIL ATTACHMENTS LOADING
  const loadEmailAttachments = async (emailId) => {
    try {
      const result = await getEmailAttachments(emailId);
      if (result.success) {
        setEmailAttachments(result.data.attachments);
        console.log("Email attachments loaded:", result.data.attachments);
      } else {
        console.error("Failed to load attachments:", result.error);
        setEmailAttachments([]);
      }
    } catch (error) {
      console.error("Attachments loading error:", error);
      setEmailAttachments([]);
    }
  };

  const handleSelectEmail = async (email) => {
    setSelectedEmail(email);
    setEmails((currentEmails) =>
      currentEmails.map((e) => (e.id === email.id ? { ...e, isRead: true } : e))
    );

    // ENHANCED: Fetch full email details and attachments if email has an ID
    if (email.id && !email.isDraft) {
      setLoading(true);

      // Load attachments and email details in parallel
      await loadEmailAttachments(email.id);
      const result = await getEmailById(email.id);

      if (result.success) {
        // Update selected email with full details
        setSelectedEmail({
          ...email,
          ...result.data,
          isRead: true,
        });
      } else {
        // Handle error - maybe show notification
        console.error("Failed to load email details:", result.error);
      }

      setLoading(false);
    } else {
      // For drafts or emails without IDs, clear attachments
      setEmailAttachments([]);
    }
  };

  const handleMarkAsDownloaded = (emailId) => {
    setEmails((currentEmails) =>
      currentEmails.map((e) =>
        e.id === emailId ? { ...e, isDownloaded: true } : e
      )
    );
    if (selectedEmail && selectedEmail.id === emailId) {
      setSelectedEmail((prev) => ({ ...prev, isDownloaded: true }));
    }
  };

  const handleOpenCompose = () => {
    setReplyToEmail(null);
    setIsComposeOpen(true);
  };

  const handleReply = (email) => {
    setReplyToEmail(email);
    setIsComposeOpen(true);
  };

  const handleSendEmail = (sentEmail) => {
    setIsComposeOpen(false);
    setReplyToEmail(null);
    setNotification("Email Sent!");
    // Refresh drafts in case a draft was sent
    loadDrafts();
  };

  const handleAccountUpdate = (newAccountDetails) => {
    setUserAccount((prev) => ({ ...prev, ...newAccountDetails }));
    setNotification(`Account upgraded to ${newAccountDetails.status}!`);
  };

  return (
    <div className="qmail-dashboard">
      {notification && <div className="notification-popup">{notification}</div>}

      {serverHealth && serverHealth.status !== "healthy" && (
        <div className="health-warning">
          <AlertCircle size={16} />
          <span>Server Status: {serverHealth.status}</span>
        </div>
      )}

      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSend={handleSendEmail}
        replyTo={replyToEmail}
      />

      <NavigationPane
        activeView={activeView}
        setActiveView={handleFolderChange}
        onComposeClick={handleOpenCompose}
        mailCounts={mailCounts}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        draftsCount={drafts.length}
      />

      {(activeView === "inbox" || activeView === "sent" || activeView === "drafts" || activeView === "trash") && (
        <>
          <EmailListPane
            emails={emails}
            onSelectEmail={handleSelectEmail}
            selectedEmail={selectedEmail}
            onSearch={handleSearch}
            isLoading={loading}
            currentFolder={currentFolder}
          />
          <ReadingPane
            email={selectedEmail}
            onReply={handleReply}
            onMarkAsDownloaded={handleMarkAsDownloaded}
            attachments={emailAttachments}
          />
        </>
      )}

      {activeView === "contacts" && <ContactsPane />}
      {activeView === "account" && (
        <AccountPane
          userAccount={userAccount}
          onAccountUpdate={handleAccountUpdate}
        />
      )}
    </div>
  );
};

export default QMailDashboard;