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
} from "lucide-react";
import ComposeModal from "./ComposeModal";
import ContactsPane from "./ContactsPane";
import AccountPane from "./AccountPane";
import {
  pingQMail,
  getMailList,
  getHealthStatus,
  searchEmails,
} from "../../api/qmailApiServices";
import "./QMailDashboard.css";

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

// Navigation Pane
const NavigationPane = ({
  activeView,
  setActiveView,
  onComposeClick,
  unreadCount,
  onRefresh,
  isRefreshing,
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
        {unreadCount > 0 && <span className="email-count">{unreadCount}</span>}
      </a>
      <a href="#" className="nav-link">
        <Star size={18} />
        <span>Starred</span>
      </a>
      <a href="#" className="nav-link">
        <Send size={18} />
        <span>Sent</span>
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
      <a href="#" className="nav-link">
        <Trash2 size={18} />
        <span>Trash</span>
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
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    onSearch(value);
  };

  return (
    <section className="email-list-pane">
      <div className="search-bar-container">
        <Search size={20} className="search-icon" />
        <input
          type="text"
          placeholder="Search mail..."
          className="search-input"
          value={searchQuery}
          onChange={handleSearch}
        />
      </div>
      <div className="email-list">
        {isLoading ? (
          <div className="loading-state">
            <RefreshCw size={32} className="spinning" />
            <p>Loading emails...</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="empty-state">
            <Mail size={48} />
            <p>No emails found</p>
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

// Reading Pane
const ReadingPane = ({ email, onReply, onMarkAsDownloaded }) => {
  const [downloadState, setDownloadState] = useState({
    isDownloaded: email ? email.isDownloaded : false,
    isDownloading: false,
    statusIndex: 0,
  });

  useEffect(() => {
    setDownloadState({
      isDownloaded: email ? email.isDownloaded : false,
      isDownloading: false,
      statusIndex: 0,
    });
  }, [email]);

  useEffect(() => {
    let interval;
    if (
      downloadState.isDownloading &&
      downloadState.statusIndex < downloadStatuses.length - 1
    ) {
      interval = setInterval(() => {
        setDownloadState((prevState) => ({
          ...prevState,
          statusIndex: prevState.statusIndex + 1,
        }));
      }, 700);
    } else if (downloadState.statusIndex === downloadStatuses.length - 1) {
      setTimeout(() => {
        setDownloadState((prevState) => ({
          ...prevState,
          isDownloading: false,
          isDownloaded: true,
        }));
        if (email) {
          onMarkAsDownloaded(email.id);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [
    downloadState.isDownloading,
    downloadState.statusIndex,
    email,
    onMarkAsDownloaded,
  ]);

  const handleDownload = () => {
    setDownloadState({
      isDownloaded: false,
      isDownloading: true,
      statusIndex: 0,
    });
  };

  if (!email) {
    return (
      <main className="reading-pane empty">
        <Mail size={64} />
        <p>Select an email to read</p>
      </main>
    );
  }

  return (
    <main className="reading-pane">
      <div className="email-header">
        <div className="email-subject-actions">
          <h2>{email.subject}</h2>
          <div className="sender-actions">
            <button
              className="action-button secondary"
              onClick={() => onReply(email)}
            >
              <Reply size={16} /> Reply
            </button>
            <button className="action-button whitelist success">
              <UserCheck size={16} /> Whitelist
            </button>
            <button className="action-button blacklist danger">
              <UserX size={16} /> Blacklist
            </button>
          </div>
        </div>
        <div className="sender-info">
          <SenderAvatar sender={email.sender} status={email.senderStatus} />
          <div className="sender-details">
            <span className="sender-name">{email.sender}</span>
            <span className="sender-email">&lt;{email.senderEmail}&gt;</span>
          </div>
          <span className="email-timestamp-full">{email.timestamp}</span>
        </div>
      </div>

      <div className="email-body">
        {!downloadState.isDownloaded && !downloadState.isDownloading && (
          <div className="download-prompt">
            <p>
              This QMail's metadata has been loaded. Download the full message
              to view its content.
            </p>
            <button
              className="download-button primary"
              onClick={handleDownload}
            >
              Download Full Message
            </button>
          </div>
        )}

        {downloadState.isDownloading && (
          <div className="download-status">
            <p className="status-text">
              {downloadStatuses[downloadState.statusIndex].status}
            </p>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{
                  width: `${
                    downloadStatuses[downloadState.statusIndex].progress
                  }%`,
                }}
              ></div>
            </div>
            <p className="progress-percentage">
              {downloadStatuses[downloadState.statusIndex].progress}%
            </p>
          </div>
        )}

        {downloadState.isDownloaded && <p>{email.body}</p>}
      </div>
    </main>
  );
};

const QMailDashboard = () => {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [activeView, setActiveView] = useState("inbox");
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [replyToEmail, setReplyToEmail] = useState(null);
  const [notification, setNotification] = useState("");
  const [userAccount, setUserAccount] = useState({
    status: "bronze",
    email: "C3E4A1B9F2@qmail.mobi",
  });
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [currentFolder, setCurrentFolder] = useState("inbox");
  const [serverHealth, setServerHealth] = useState(null);
  const [searchDebounceTimer, setSearchDebounceTimer] = useState(null);

  const unreadCount = emails.filter((e) => !e.isRead).length;

  // Initial load
  useEffect(() => {
    checkHealth();
    loadEmails("inbox");
    checkForNewMail();

    // Poll for new messages every 60 seconds
    const interval = setInterval(checkForNewMail, 300000);
    return () => clearInterval(interval);
  }, []);

  // Clear notification after 3 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const checkHealth = async () => {
    const result = await getHealthStatus();
    if (result.success) {
      setServerHealth(result.data);
      console.log("Server health:", result.data);
    } else {
      console.error("Server health check failed:", result.error);
      setNotification("Server connection error");
    }
  };

  const loadEmails = async (folder) => {
    setLoading(true);
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
    setLoading(false);
  };

  const checkForNewMail = async () => {
    const result = await pingQMail();
    if (result.success) {
      setMessageCount(result.data.messageCount);
      if (result.data.hasMail) {
        loadEmails(currentFolder);
        setNotification("New mail received!");
      }
    } else {
      console.error("Ping failed:", result.error);
    }
  };

  const handleFolderChange = (folder) => {
    setCurrentFolder(folder);
    setActiveView(folder);
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
    setIsRefreshing(false);
    setNotification("Refreshed successfully");
  };

  const handleSelectEmail = (email) => {
    setSelectedEmail(email);
    setEmails((currentEmails) =>
      currentEmails.map((e) => (e.id === email.id ? { ...e, isRead: true } : e))
    );
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
        unreadCount={unreadCount}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {activeView === "inbox" && (
        <>
          <EmailListPane
            emails={emails}
            onSelectEmail={handleSelectEmail}
            selectedEmail={selectedEmail}
            onSearch={handleSearch}
            isLoading={loading}
          />
          <ReadingPane
            email={selectedEmail}
            onReply={handleReply}
            onMarkAsDownloaded={handleMarkAsDownloaded}
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
