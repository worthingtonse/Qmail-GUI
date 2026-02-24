import React, { useState, useEffect, useMemo } from "react";
import ComposeModal from "./ComposeModal";
import ContactsPane from "./ContactsPane";
import AccountPane from "./AccountPane";
import NavigationPane from "./NavigationPane";
import EmailListPane from "./EmailListPane";
import ReadingPane from "./ReadingPane";
import {
  pingQMail,
  getMailList,
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
  getMailNotifications, 
  downloadEmailContent, 
  downloadMailAttachment
} from "../../api/qmailApiServices";

import "./QMailDashboard.css";

const QMailDashboard = ({ initValues }) => {
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
  
  const [pendingMails, setPendingMails] = useState([]);
  const [isDownloadingItem, setIsDownloadingItem] = useState(null); 
  const [emailAttachments, setEmailAttachments] = useState([]);
  const [searchDebounceTimer, setSearchDebounceTimer] = useState(null);
  
  const [serverHealth, setServerHealth] = useState({
    status: "healthy",
    service: "QMail Client Core",
    version: "1.0.0"
  });
  
  const [userAccount, setUserAccount] = useState({
    name: "John Doe",
    email: "john.doe@qmail.cloud",
    balance: 150,
    status: "verified",
  });

  // YAHAN FIX KIYA HAI: Sender, Preview aur Timestamp proper keys ke sath map kiye hain
  const formattedPendingMails = useMemo(() => {
    return pendingMails.map(notif => ({
      id: `pending-${notif.guid}`,
      guid: notif.guid,
      sender: notif.sender_address || "Unknown Sender",
      senderEmail: notif.sender_address || "",
      from: notif.sender_address || "",
      subject: "🔒 Encrypted Message (Tap to Download)",
      preview: "Encrypted payload waiting to be downloaded...", 
      timestamp: notif.timestamp || new Date().toISOString(),
      isPending: true,
      isDownloaded: false 
    }));
  }, [pendingMails]);

  const displayEmails = useMemo(() => {
    return [...formattedPendingMails, ...emails];
  }, [formattedPendingMails, emails]);

  // Background Watcher
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const result = await getMailNotifications();
        if (result.success && result.data.count > 0) {
          setPendingMails(prev => {
            const newNotifs = result.data.notifications.filter(
              n => !prev.some(p => p.guid === n.guid)
            );
            return [...prev, ...newNotifs];
          });
        }
      } catch (error) {
        console.error("Watch error:", error);
      }
    };

    const interval = setInterval(fetchNotifications, 10000);
    fetchNotifications();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadInitialData();

    const mailCountInterval = setInterval(() => {
      loadMailCounts();
    }, 60000);

    const walletInterval = setInterval(() => {
      loadWalletBalance();
    }, 120000);

    const handleFocus = () => {
      loadWalletBalance();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(mailCountInterval);
      clearInterval(walletInterval);
      window.removeEventListener("focus", handleFocus);
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadWalletBalance(),
        syncData().catch((err) => console.warn("Background sync failed:", err)),
      ]);

      await Promise.all([loadFolders(), loadMailCounts(), loadDrafts()]);
      await loadEmails(currentFolder);
      await checkForNewMail();
    } catch (error) {
      console.error("Error loading initial data:", error);
      setNotification("Error loading dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const loadWalletBalance = async () => {
    try {
      const result = await getWalletBalance();
      if (result.success) {
        setWalletBalance(result.data);
      } else {
        setWalletBalance(null);
      }
    } catch (error) {
      setWalletBalance(null);
    }
  };

  const loadDrafts = async () => {
    try {
      const result = await getDrafts();
      if (result.success) {
        const draftsList = result.data.drafts || [];
        setDrafts(draftsList);
        setMailCounts((prev) => ({
          ...prev,
          drafts: { total: draftsList.length, unread: 0 },
        }));
      } else {
        setDrafts([]);
      }
    } catch (error) {
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
      }
    } catch (error) {
      console.error("Ping error:", error);
    }
  };

  const loadFolders = async () => {
    const result = await getMailFolders();
    if (result.success) {
      setFolders(result.data.folders);
    } else {
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

      if (previousMailCounts.inbox && newCounts.inbox.total > previousMailCounts.inbox.total) {
        const newMailCount = newCounts.inbox.total - previousMailCounts.inbox.total;
        setNotification(`${newMailCount} new email${newMailCount > 1 ? "s" : ""} arrived!`);

        if (currentFolder === "inbox") {
          loadEmails("inbox");
        }
      }

      if (newCounts.drafts) newCounts.drafts.unread = 0;

      if (summary.total_unread > 0) {
        document.title = `(${summary.total_unread}) QMail - ${currentFolder}`;
      } else {
        document.title = `QMail - ${currentFolder}`;
      }

      setPreviousMailCounts(newCounts);
      setMailCounts(newCounts);
    }
  };

  const loadEmails = async (folder) => {
    setLoading(true);

    try {
      if (folder === "drafts") {
        await loadDrafts();
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
          senderStatus: "none",
          isDraft: true,
        }));
        setEmails(transformedDrafts);
        setLoading(false);
        return;
      }

      const offset = currentPage * EMAILS_PER_PAGE;
      const result = await getMailList(folder, EMAILS_PER_PAGE, offset);
      if (result.success) {
        setTotalEmailCount(result.data.totalCount);
        
        const transformedEmails = result.data.emails.map((email) => ({
          id: email.EmailID || email.id,
          sender: email.sender || email.sender_address || email.from || "Unknown",
          senderEmail: email.senderEmail || email.sender_address || "",
          subject: email.Subject || email.subject || "No Subject",
          body: email.body || "",
          preview: email.preview || email.Subject || email.subject || "",
          timestamp: email.ReceivedTimestamp || email.receivedTimestamp || email.timestamp,
          isRead: email.is_read || email.isRead || false,
          isDownloaded: email.downloaded === true || email.downloaded === "true" || email.downloaded === 1 || email.isDownloaded === true, 
          tags: email.tags || [],
          starred: email.isStarred || false,
          senderStatus: "none", 
        }));
        
        setEmails(transformedEmails);
      } else {
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

    const unreadCount = mailCounts[folder]?.unread || 0;
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) QMail - ${folder}`;
    } else {
      document.title = `QMail - ${folder}`;
    }

    loadEmails(folder);
  };

  const handleSearch = async (query) => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (query.trim() === "") {
      loadEmails(currentFolder);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchEmails(query, 50, 0);
      if (result.success) {
        const transformedEmails = result.data.results.map((email) => ({
          id: email.id || Date.now() + Math.random(),
          sender: email.sender || email.sender_address || email.from || "Unknown",
          senderEmail: email.senderEmail || email.sender_address || "",
          subject: email.subject || "No Subject",
          body: email.body || email.content || "",
          preview: email.preview || email.snippet || (email.body ? email.body.substring(0, 100) : ""),
          timestamp: email.timestamp || email.date || new Date().toLocaleTimeString(),
          isRead: email.isRead || email.read || false,
          isDownloaded: email.downloaded === true || email.downloaded === "true" || email.downloaded === 1 || email.isDownloaded === true,
          tags: email.tags || [],
          starred: email.starred || false,
          senderStatus: email.senderStatus || "none",
        }));
        setEmails(transformedEmails);
        setSelectedEmail(transformedEmails.length > 0 ? transformedEmails[0] : null);
      }
      setLoading(false);
    }, 500);

    setSearchDebounceTimer(timer);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await checkForNewMail();
    await loadEmails(currentFolder);
    await loadDrafts();
    setIsRefreshing(false);
    setNotification("Refreshed successfully");
  };

  const handleSelectEmail = async (email) => {
    if (!email) return;

    if (email.isPending || email.isDownloaded === false) {
      setSelectedEmail(email);
      setEmailAttachments([]); 
      return;
    }

    if (email.isDraft) {
      setEditDraft(email);
      setIsComposeOpen(true);
      return;
    }

    setSelectedEmail(email);

    if (!email.isRead && !email.isDraft) {
      setEmails((currentEmails) =>
        currentEmails.map((e) =>
          e.id === email.id ? { ...e, isRead: true } : e
        )
      );
      handleMarkAsRead(email.id, true); 
    }

    if (email.id && !email.isDraft && email.isDownloaded) {
      setLoading(true);
      try {
        const [attRes, bodyRes] = await Promise.allSettled([
          getEmailAttachments(email.id),
          getEmailById(email.id)
        ]);

        if (attRes.status === 'fulfilled' && attRes.value.success) {
          setEmailAttachments(attRes.value.data.attachments || []);
        } else {
          setEmailAttachments([]);
        }

        if (bodyRes.status === 'fulfilled' && bodyRes.value.success) {
          const fetchedData = bodyRes.value.data;
          setSelectedEmail((prev) => ({
            ...prev,
            ...fetchedData,
            isRead: true,
            isDownloaded: true
          }));

          setEmails((prevEmails) => 
            prevEmails.map((e) => 
              e.id === email.id ? { ...e, preview: fetchedData.body?.substring(0, 100), body: fetchedData.body } : e
            )
          );
        }
      } catch (e) {
        console.error("Failed to load full email payload", e);
        setEmailAttachments([]);
      }
      setLoading(false);
    } else {
      setEmailAttachments([]);
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

  const handleSendEmail = async () => {
    setIsComposeOpen(false);
    setReplyToEmail(null);
    setEditDraft(null);
    setNotification("Email Sent!");
    await loadWalletBalance();
    await loadDrafts();
    if (currentFolder === "drafts") {
      await loadEmails("drafts");
    }
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
        setEmails((prevEmails) =>
          prevEmails.map((email) =>
            email.id === emailId ? { ...email, isRead: isRead } : email
          )
        );
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail((prev) => ({ ...prev, isRead: isRead }));
        }
        await loadMailCounts();
      }
    } catch (error) {
      console.error("Mark as read error:", error);
    }
  };

  const handleMoveEmail = async (emailId, targetFolder) => {
    try {
      const result = await moveEmail(emailId, targetFolder);
      if (result.success) {
        setEmails((prevEmails) =>
          prevEmails.filter((email) => email.id !== emailId)
        );
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail(null);
        }
        await loadMailCounts();
      }
    } catch (error) {
      console.error("Move email error:", error);
    }
  };

  const handleDeleteEmail = async (emailId) => {
    try {
      const result = await deleteEmail(emailId);
      if (result.success) {
        setEmails((prevEmails) =>
          prevEmails.filter((email) => email.id !== emailId)
        );
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail(null);
        }
        await loadMailCounts();
      }
    } catch (error) {
      console.error("Delete email error:", error);
    }
  };

  const handleDownloadMail = async (identifier) => {
    setIsDownloadingItem(identifier);
    try {
      const contentRes = await downloadEmailContent(identifier);
      
      const responseData = contentRes.data || contentRes;

      if (contentRes.success || responseData.status === "success" || responseData.body) {
        const decryptedBody = responseData.body || "";
        const decryptedSubject = responseData.subject || "";
        const incomingAttachments = responseData.attachments || [];

        setPendingMails(prev => prev.filter(m => m.guid !== identifier));
        
        setSelectedEmail(prev => ({
          ...prev,
          body: decryptedBody,
          subject: decryptedSubject || prev?.subject,
          isDownloaded: true,   
          isPending: false,     
          isRead: true
        }));

        setEmailAttachments(incomingAttachments);

        setEmails(prev => prev.map(e => 
          (e.id === identifier || e.guid === identifier) 
            ? { ...e, isDownloaded: true, body: decryptedBody, preview: decryptedBody.substring(0, 100) } 
            : e
        ));

        loadEmails(currentFolder);
        
        setNotification("Message decrypted successfully!");
      } else {
        setNotification("Failed to decrypt message.");
      }
    } catch (error) {
      console.error("Download failed:", error);
      setNotification("Download failed");
    } finally {
      setIsDownloadingItem(null);
    }
  };

  const handleDownloadAttachment = async (emailId, attachmentIndex, attachmentName) => {
    try {
      setNotification(`Downloading ${attachmentName || 'attachment'}...`);
      await downloadMailAttachment(emailId, attachmentIndex);
      setNotification(`Download started for ${attachmentName || 'attachment'}!`);
    } catch (error) {
      console.error("Attachment download failed:", error);
      setNotification("Failed to download attachment");
    }
  };

  return (
    <div className="qmail-dashboard">
      {notification && <div className="notification-popup">{notification}</div>}

      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => {
          setIsComposeOpen(false);
          setEditDraft(null);
          if (currentFolder === "drafts") {
            loadEmails("drafts");
          }
        }}
        onSend={handleSendEmail}
        replyTo={replyToEmail}
        editDraft={editDraft}
        walletBalance={walletBalance}
        onDraftSaved={async () => {
          if (currentFolder === "drafts") {
            await loadEmails("drafts");
          }
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
            emails={displayEmails} 
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
          {!isComposeOpen && (
            <ReadingPane
              email={selectedEmail} 
              onDownload={handleDownloadMail} 
              isDownloading={isDownloadingItem === (selectedEmail?.guid || selectedEmail?.id)}
              onReply={handleReply}
              onMarkAsRead={handleMarkAsRead}
              onDeleteEmail={handleDeleteEmail}
              onMoveEmail={handleMoveEmail}
              attachments={emailAttachments}
              onDownloadAttachment={handleDownloadAttachment} 
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