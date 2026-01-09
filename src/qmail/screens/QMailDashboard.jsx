import React, { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import ComposeModal from "./ComposeModal";
import ContactsPane from "./ContactsPane";
import AccountPane from "./AccountPane";
import NavigationPane from "./NavigationPane";
import EmailListPane from "./EmailListPane";
import ReadingPane from "./ReadingPane";
import {
  pingQMail,
  getMailList,
  getHealthStatus,
  searchEmails,
  getMailCount,
  getMailFolders,
  getEmailById,
  getDrafts,
  getEmailAttachments,
  getWalletBalance,
  syncData,
  markEmailRead,
  moveEmail,
  deleteEmail,
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
  const [currentPage, setCurrentPage] = useState(0);
  const [totalEmailCount, setTotalEmailCount] = useState(0);
  const EMAILS_PER_PAGE = 50;
  const [mailCounts, setMailCounts] = useState({
    inbox: { unread: 0, total: 0 },
    sent: { unread: 0, total: 0 },
    drafts: { unread: 0, total: 0 },
    trash: { unread: 0, total: 0 },
  });
  const [previousMailCounts, setPreviousMailCounts] = useState({});
  const [walletBalance, setWalletBalance] = useState(null);
  const [folders, setFolders] = useState([]);
  const [messageCount, setMessageCount] = useState(0);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [replyToEmail, setReplyToEmail] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [notification, setNotification] = useState(null);
  const [serverHealth, setServerHealth] = useState(null);
  const [emailAttachments, setEmailAttachments] = useState([]);
  const [searchDebounceTimer, setSearchDebounceTimer] = useState(null);
  const [userAccount, setUserAccount] = useState({
    name: "John Doe",
    email: "john.doe@qmail.cloud",
    balance: 150,
    status: "verified",
  });

  // Load initial data
  useEffect(() => {
    loadInitialData();

    // Periodic mail count polling (60 seconds)
    const mailCountInterval = setInterval(() => {
      loadMailCounts();
    }, 60000);

    // Periodic health check heartbeat (30 seconds)
    const healthInterval = setInterval(() => {
      loadServerHealth();
    }, 30000);

    // Periodic wallet balance check (2 minutes)
    const walletInterval = setInterval(() => {
      loadWalletBalance();
    }, 120000);

    // Check health and balance when window regains focus
    const handleFocus = () => {
      console.log("Window regained focus - checking health and balance");
      loadServerHealth();
      loadWalletBalance();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(mailCountInterval);
      clearInterval(healthInterval);
      clearInterval(walletInterval);
      window.removeEventListener("focus", handleFocus);
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
      // Load health status and wallet balance first
      await Promise.all([
        loadServerHealth(),
        loadWalletBalance(),
        syncData().catch((err) => console.warn("Background sync failed:", err)),
      ]);

      // Load folders and mail counts
      await Promise.all([loadFolders(), loadMailCounts(), loadDrafts()]);

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
        console.log(
          "Server health:",
          result.data.status,
          "- Version:",
          result.data.version
        );
      } else {
        console.error("Failed to load server health:", result.error);
        setServerHealth({
          status: "disconnected",
          message: result.error,
          service: "QMail Client Core",
          version: "unknown",
        });
      }
    } catch (error) {
      console.error("Health check error:", error);
      setServerHealth({
        status: "disconnected",
        message: "Backend not responding",
        service: "QMail Client Core",
        version: "unknown",
      });
    }
  };

  const loadWalletBalance = async () => {
    try {
      const result = await getWalletBalance();
      if (result.success) {
        setWalletBalance(result.data);
        console.log("Wallet balance loaded:", result.data.totalValue, "CC");

        // Check for warnings (missing wallet folders, etc.)
        if (result.data.warnings && result.data.warnings.length > 0) {
          console.warn("Wallet warnings:", result.data.warnings);
          setNotification("Wallet needs attention - check Account page");
        }

        // Alert if balance is zero
        if (result.data.totalCoins === 0) {
          console.warn("No coins in wallet");
        }
      } else {
        console.error("Failed to load wallet balance:", result.error);
        setWalletBalance(null);
      }
    } catch (error) {
      console.error("Wallet balance error:", error);
      setWalletBalance(null);
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
        setMailCounts((prev) => ({
          ...prev,
          drafts: { total: draftsList.length, unread: 0 },
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
      const newCounts = result.data.counts;
      const summary = result.data.summary;

      // Check if inbox count increased (new mail arrived)
      if (
        previousMailCounts.inbox &&
        newCounts.inbox.total > previousMailCounts.inbox.total
      ) {
        const newMailCount =
          newCounts.inbox.total - previousMailCounts.inbox.total;
        setNotification(
          `${newMailCount} new email${newMailCount > 1 ? "s" : ""} arrived!`
        );

        // Auto-refresh inbox if user is viewing it
        if (currentFolder === "inbox") {
          console.log("New mail detected - auto-refreshing inbox");
          loadEmails("inbox");
        }
      }

      // FIX: Force drafts unread count to 0 (drafts don't have unread state)
      if (newCounts.drafts) {
        newCounts.drafts.unread = 0;
      }

      // Update browser tab title with unread count
      if (summary.total_unread > 0) {
        document.title = `(${summary.total_unread}) QMail - ${currentFolder}`;
      } else {
        document.title = `QMail - ${currentFolder}`;
      }

      // Save current counts for next comparison
      setPreviousMailCounts(newCounts);
      setMailCounts(newCounts);

      console.log(
        "Mail counts loaded:",
        newCounts,
        "| Unread:",
        summary.total_unread
      );
    } else {
      console.error("Failed to load mail counts:", result.error);
    }
  };

  const loadEmails = async (folder) => {
    setLoading(true);

    try {
      // Handle drafts separately
      if (folder === "drafts") {
        await loadDrafts();
        // Transform drafts to match email structure
        const transformedDrafts = drafts.map((draft) => ({
          id: draft.id || `draft_${Date.now()}_${Math.random()}`,
          sender: "You (Draft)",
          senderEmail: userAccount.email,
          subject: draft.subject || "No Subject",
          body: draft.body || draft.content || "",
          preview:
            draft.preview || (draft.body ? draft.body.substring(0, 100) : ""),
          timestamp:
            draft.timestamp ||
            draft.created_at ||
            new Date().toLocaleTimeString(),
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
      const offset = currentPage * EMAILS_PER_PAGE;
      const result = await getMailList(folder, EMAILS_PER_PAGE, offset);
      if (result.success) {
        setTotalEmailCount(result.data.totalCount);
        // Transform API data to match UI structure
        const transformedEmails = result.data.emails.map((email) => ({
          id: email.id,
          sender: email.sender || "Unknown",
          senderEmail: email.senderEmail || "",
          subject: email.subject || "No Subject",
          body: email.body || "",
          preview: email.preview || email.subject || "",
          timestamp: email.receivedTimestamp || email.timestamp,
          isRead: email.isRead || false,
          isDownloaded: false, // Will be set when user clicks download
          tags: email.tags || [],
          starred: email.isStarred || false,
          annoyanceReported: false,
          senderStatus: "none", // Will be determined later from contacts
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
    setSelectedEmail(null);

    // Update browser tab title
    const unreadCount = mailCounts[folder]?.unread || 0;
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) QMail - ${folder}`;
    } else {
      document.title = `QMail - ${folder}`;
    }

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
    // If it's a draft, open compose modal instead
    if (email.isDraft) {
      setEditDraft(email);
      setIsComposeOpen(true);
      return;
    }

    setSelectedEmail(email);

    // Auto-mark as read when opening an unread email
    if (!email.isRead && !email.isDraft) {
      // Optimistically update UI
      setEmails((currentEmails) =>
        currentEmails.map((e) =>
          e.id === email.id ? { ...e, isRead: true } : e
        )
      );

      // Call API to mark as read
      await handleMarkAsRead(email.id, true);
    }

    // Fetch full email details and attachments if email has an ID
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
        console.error("Failed to load email details:", result.error);
      }

      setLoading(false);
    } else {
      // For emails without IDs, clear attachments
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
    setEditDraft(null);
    setIsComposeOpen(true);
  };

  const handleReply = (email) => {
    setReplyToEmail(email);
    setIsComposeOpen(true);
  };

  const handleSendEmail = async (sentEmail) => {
    setIsComposeOpen(false);
    setReplyToEmail(null);
    setEditDraft(null);
    setNotification("Email Sent!");

    // Refresh wallet balance after sending (coins were spent)
    await loadWalletBalance();

    // Refresh drafts in case a draft was sent
    await loadDrafts();

    // Reload current folder if we're in drafts (draft was deleted after sending)
    if (currentFolder === "drafts") {
      await loadEmails("drafts");
    }

    // Update counts
    await loadMailCounts();
  };

  const handleAccountUpdate = (newAccountDetails) => {
    setUserAccount((prev) => ({ ...prev, ...newAccountDetails }));
    setNotification(`Account upgraded to ${newAccountDetails.status}!`);
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    loadEmails(currentFolder);
  };

  const handleMarkAsRead = async (emailId, isRead = true) => {
    try {
      const result = await markEmailRead(emailId, isRead);
      if (result.success) {
        // Update local state
        setEmails((prevEmails) =>
          prevEmails.map((email) =>
            email.id === emailId ? { ...email, isRead: isRead } : email
          )
        );

        // Update selected email if it's the current one
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail((prev) => ({ ...prev, isRead: isRead }));
        }

        // Refresh mail counts to update sidebar badges
        await loadMailCounts();

        setNotification(isRead ? "Marked as read" : "Marked as unread");
      } else {
        setNotification(`Failed to update read status: ${result.error}`);
      }
    } catch (error) {
      console.error("Mark as read error:", error);
      setNotification("Failed to update read status");
    }
  };

  const handleMoveEmail = async (emailId, targetFolder) => {
    try {
      const result = await moveEmail(emailId, targetFolder);
      if (result.success) {
        // Remove from current list
        setEmails((prevEmails) =>
          prevEmails.filter((email) => email.id !== emailId)
        );

        // Clear selection if it was the selected email
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail(null);
        }

        // Refresh counts
        await loadMailCounts();

        setNotification(`Moved to ${targetFolder}`);
      } else {
        setNotification(`Failed to move email: ${result.error}`);
      }
    } catch (error) {
      console.error("Move email error:", error);
      setNotification("Failed to move email");
    }
  };

  const handleDeleteEmail = async (emailId) => {
    try {
      const result = await deleteEmail(emailId);
      if (result.success) {
        // Remove from current list
        setEmails((prevEmails) =>
          prevEmails.filter((email) => email.id !== emailId)
        );

        // Clear selection if it was the selected email
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail(null);
        }

        // Refresh counts
        await loadMailCounts();

        setNotification("Moved to trash");
      } else {
        setNotification(`Failed to delete email: ${result.error}`);
      }
    } catch (error) {
      console.error("Delete email error:", error);
      setNotification("Failed to delete email");
    }
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
        onClose={() => {
          setIsComposeOpen(false);
          setEditDraft(null);

          // Reload drafts when closing if in drafts folder
          if (currentFolder === "drafts") {
            loadEmails("drafts");
          }
        }}
        onSend={handleSendEmail}
        replyTo={replyToEmail}
        editDraft={editDraft}
        walletBalance={walletBalance}
        onDraftSaved={async () => {
          // This will be called immediately after save/update
          console.log("Draft saved callback triggered");

          // Reload drafts list in main view
          if (currentFolder === "drafts") {
            await loadEmails("drafts");
          }

          // Update mail counts
          await loadMailCounts();
        }}
      />

      <NavigationPane
        activeView={activeView}
        setActiveView={handleFolderChange}
        onComposeClick={handleOpenCompose}
        mailCounts={mailCounts}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        draftsCount={drafts.length}
        serverHealth={serverHealth}
        walletBalance={walletBalance}
        folders={folders}
      />

      {(activeView === "inbox" ||
        activeView === "sent" ||
        activeView === "drafts" ||
        activeView === "trash") && (
        <>
          <EmailListPane
            emails={emails}
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
          />
          {!isComposeOpen && ( // ADD THIS CONDITION
            <ReadingPane
              email={selectedEmail}
              onReply={handleReply}
              onMarkAsDownloaded={handleMarkAsDownloaded}
              onMarkAsRead={handleMarkAsRead}
              onDeleteEmail={handleDeleteEmail}
              onMoveEmail={handleMoveEmail}
              attachments={emailAttachments}
            />
          )}
        </>
      )}

      {activeView === "contacts" && <ContactsPane />}
      {activeView === "account" && (
        <AccountPane
          userAccount={userAccount}
          onAccountUpdate={handleAccountUpdate}
          walletBalance={walletBalance}
        />
      )}
    </div>
  );
};

export default QMailDashboard;

