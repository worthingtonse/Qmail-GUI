import React, { useState, useEffect, useMemo, useRef } from "react";
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
  getQMailWalletBalance,
  syncData,
  markEmailRead,
  moveEmail,
  deleteEmail,
  deleteEmailPermanent,
  getMailNotifications,
  downloadEmailContent,
  downloadMailAttachment,
  starEmail,
  convertSnToEmail,
} from "../../api/qmailApiServices";
import { formatTimestamp } from "./formatTimestamp";

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
  const [sortMode, setSortMode] = useState("newest");
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
  // BUG-22 FIX: Use ref instead of state for debounce timer
  const searchDebounceTimerRef = useRef(null);
  // BUG-21 FIX: Track current folder load to prevent race conditions
  const loadEmailsRequestRef = useRef(0);

  const [serverHealth, setServerHealth] = useState({
    status: "healthy",
    service: "QMail Client Core",
    version: "1.0.0",
  });

  const [userAccount, setUserAccount] = useState({
    name: "John Doe",
    email: "john.doe@qmail.cloud",
    balance: 150,
    status: "verified",
  });

  // YAHAN FIX KIYA HAI: Sender, Preview aur Timestamp proper keys ke sath map kiye hain
  const formattedPendingMails = useMemo(() => {
    return pendingMails.map((notif) => ({
      id: `pending-${notif.guid}`,
      guid: notif.guid,
      sender: notif.sender_address || "Unknown Sender",
      senderEmail: notif.sender_address || "",
      from: notif.sender_address || "",
      subject: "🔒 Encrypted Message (Tap to Download)",
      preview: "Encrypted payload waiting to be downloaded...",
      rawTimestamp: Number(notif.timestamp) || 0,
      timestamp: formatTimestamp(notif.timestamp) || new Date().toLocaleTimeString(),
      isPending: true,
      isDownloaded: false,
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
          setPendingMails((prev) => {
            const newNotifs = result.data.notifications.filter(
              (n) => !prev.some((p) => p.guid === n.guid),
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
      if (searchDebounceTimerRef.current) {
        clearTimeout(searchDebounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // BUG-25 FIX: Sync document.title with state via useEffect
  useEffect(() => {
    const unread = mailCounts[currentFolder]?.unread || 0;
    document.title = unread > 0
      ? `(${unread}) QMail - ${currentFolder}`
      : `QMail - ${currentFolder}`;
  }, [currentFolder, mailCounts]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadWalletBalance(),
        syncData().catch((err) => console.warn("Background sync failed:", err)),
      ]);

      await Promise.all([loadFolders(), loadMailCounts(), loadDrafts()]);
      await loadEmails(currentFolder);
      // await checkForNewMail();
    } catch (error) {
      console.error("Error loading initial data:", error);
      setNotification("Error loading dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const loadWalletBalance = async () => {
    try {
      const result = await getQMailWalletBalance();
      if (result.success) {
        setWalletBalance(result.data);
      } else {
        setWalletBalance(null);
      }
    } catch (error) {
      setWalletBalance(null);
    }
  };

  // BUG-03 FIX: Return the draft list so callers can use the fresh value
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
        return draftsList;
      } else {
        setDrafts([]);
        return [];
      }
    } catch (error) {
      setDrafts([]);
      return [];
    }
  };

  // const checkForNewMail = async () => {
  //   try {
  //     const result = await pingQMail();
  //     if (result.success) {
  //       setMessageCount(result.data.messageCount);
  //       if (result.data.hasMail) {
  //         loadEmails(currentFolder);
  //         setNotification("New mail received!");
  //       }
  //     }
  //   } catch (error) {
  //     console.error("Ping error:", error);
  //   }
  // };

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

      if (
        previousMailCounts.inbox &&
        newCounts.inbox.total > previousMailCounts.inbox.total
      ) {
        const newMailCount =
          newCounts.inbox.total - previousMailCounts.inbox.total;
        setNotification(
          `${newMailCount} new email${newMailCount > 1 ? "s" : ""} arrived!`,
        );

        if (currentFolder === "inbox") {
          loadEmails("inbox");
        }
      }

      if (newCounts.drafts) newCounts.drafts.unread = 0;

      // BUG-25 FIX: document.title is now managed by useEffect
      setPreviousMailCounts(newCounts);
      setMailCounts(newCounts);
    }
  };

  // BUG-12 FIX: Accept optional page parameter to avoid stale currentPage
  // BUG-21 FIX: Track request ID to discard stale responses
  const loadEmails = async (folder, page = null) => {
    const requestId = ++loadEmailsRequestRef.current;
    setLoading(true);

    try {
      if (folder === "drafts") {
        // BUG-03 FIX: Use returned value instead of stale closure
        const freshDrafts = await loadDrafts();
        const transformedDrafts = freshDrafts.map((draft) => ({
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
          senderStatus: "none",
          isDraft: true,
        }));
        setEmails(transformedDrafts);
        setLoading(false);
        return;
      }

      const effectivePage = page !== null ? page : currentPage;
      const offset = effectivePage * EMAILS_PER_PAGE;
      const result = await getMailList(folder, EMAILS_PER_PAGE, offset, sortMode);

      // BUG-21 FIX: Discard stale response if a newer request was started
      if (requestId !== loadEmailsRequestRef.current) return;

      if (result.success) {
        setTotalEmailCount(result.data.totalCount);

       const transformedEmails = result.data.emails.map((email) => ({
          id: email.EmailID || email.id,
          sender:
            email.sender || email.sender_address || email.from || "Unknown",
          senderEmail: email.senderEmail || email.sender_address || "",
          subject: email.Subject || email.subject || "No Subject",
          body: email.body || "",
          preview:
            email.preview ||
            (email.body
              ? email.body.substring(0, 100)
              : "No preview available..."),
          rawTimestamp: Number(
            email.ReceivedTimestamp ||
            email.receivedTimestamp ||
            email.timestamp
          ) || 0,
          timestamp: formatTimestamp(
            email.ReceivedTimestamp ||
            email.receivedTimestamp ||
            email.timestamp
          ),
          // FIX: Force read status in trash to prevent "new email" bolding
          isRead: folder === 'trash' ? true : (email.is_read || email.isRead || false),
          // FIX: Force downloaded status in trash to bypass the download button UI
          isDownloaded: folder === 'trash' ? true : (
            email.downloaded === true ||
            email.downloaded === "true" ||
            email.downloaded === 1 ||
            email.isDownloaded === true
          ),
          tags: email.tags || [],
          starred: email.isStarred || email.starred || false,
          senderStatus: "none",
          // FIX: Attach the folder identity so ReadingPane knows to use "Delete Permanently"
          folder: folder,
          isTrashed: folder === 'trash'
        }));

        setEmails(transformedEmails);
      } else {
        setEmails([]);
        setNotification("Failed to load emails");
      }
    } catch (error) {
      console.error("Email loading error:", error);
      if (requestId === loadEmailsRequestRef.current) {
        setEmails([]);
        setNotification("Error loading emails");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFolderChange = (folder) => {
    setCurrentFolder(folder);
    setActiveView(folder);
    setSelectedEmail(null);

    // BUG-25 FIX: document.title is now managed by useEffect
    loadEmails(folder);
  };

  const handleSortChange = (newSort) => {
    // Toggle: if already active, switch back to newest; otherwise activate
    const effectiveSort = sortMode === newSort ? "newest" : newSort;
    setSortMode(effectiveSort);
    // Reload with new sort — need to pass it directly since setState is async
    const requestId = ++loadEmailsRequestRef.current;
    setLoading(true);
    getMailList(currentFolder, EMAILS_PER_PAGE, 0, effectiveSort).then((result) => {
      if (requestId !== loadEmailsRequestRef.current) return;
      if (result.success) {
        setTotalEmailCount(result.data.totalCount);
        const transformedEmails = result.data.emails.map((email) => ({
          id: email.EmailID || email.id,
          sender: email.sender || email.sender_address || email.from || "Unknown",
          senderEmail: email.senderEmail || email.sender_address || "",
          subject: email.Subject || email.subject || "No Subject",
          body: email.body || "",
          preview: email.preview || (email.body ? email.body.substring(0, 100) : "No preview available..."),
          rawTimestamp: Number(email.ReceivedTimestamp || email.receivedTimestamp || email.timestamp) || 0,
          timestamp: formatTimestamp(email.ReceivedTimestamp || email.receivedTimestamp || email.timestamp),
          isRead: currentFolder === 'trash' ? true : (email.is_read || email.isRead || false),
          isDownloaded: currentFolder === 'trash' ? true : (email.downloaded === true || email.downloaded === "true" || email.downloaded === 1 || email.isDownloaded === true),
          tags: email.tags || [],
          starred: email.isStarred || email.starred || false,
          inboxFee: email.inboxFee || 0,
          senderStatus: "none",
          folder: currentFolder,
          isTrashed: currentFolder === 'trash',
        }));
        setEmails(transformedEmails);
      }
      setLoading(false);
    });
    setCurrentPage(0);
  };

  const handleSearch = async (query) => {
    if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);
    if (query.trim() === "") {
      loadEmails(currentFolder);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchEmails(query, 50, 0);
      if (result.success) {
        const transformedEmails = result.data.results.map((email) => ({
          id: email.email_id || email.id || Date.now() + Math.random(),
          sender:
            email.sender || email.sender_address || String(email.sender_sn || "Unknown"),
          senderEmail: email.senderEmail || email.sender_address || String(email.sender_sn || ""),
          subject: email.subject || "No Subject",
          body: email.body || email.content || "",
          preview:
            email.preview || email.body_preview ||
            email.snippet ||
            (email.body ? email.body.substring(0, 100) : "No preview available..."),
          timestamp: formatTimestamp(
            email.received_timestamp || email.timestamp || email.date
          ),
          isRead: email.is_read || email.isRead || email.read || false,
          isDownloaded:
            email.downloaded === true ||
            email.downloaded === "true" ||
            email.downloaded === 1 ||
            email.isDownloaded === true,
          tags: email.tags || [],
          starred: email.is_starred || email.starred || false,
          inboxFee: email.inbox_fee || email.inboxFee || 0,
          senderStatus: "none",
          folder: email.folder != null ? (typeof email.folder === "number" ? ["inbox","sent","drafts","trash","starred","archive"][email.folder] || "inbox" : email.folder) : currentFolder,
        }));
        setEmails(transformedEmails);
        setSelectedEmail(
          transformedEmails.length > 0 ? transformedEmails[0] : null,
        );
      }
      setLoading(false);
    }, 500);

    searchDebounceTimerRef.current = timer;
  };

  // BUG-02 FIX: Removed undefined checkForNewMail() call
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadEmails(currentFolder);
    await loadDrafts();
    await loadMailCounts();
    setIsRefreshing(false);
    setNotification("Refreshed successfully");
  };

  const handleSelectEmail = async (email) => {
    if (!email) return;

    if (email.isPending || email.isDownloaded === false) {
      setSelectedEmail(email);
      setEmailAttachments([]);
      // Auto-download the message
      handleDownloadMail(email.guid || email.id);
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
          String(e.id).toLowerCase() === String(email.id).toLowerCase()
            ? { ...e, isRead: true }
            : e,
        ),
      );
      handleMarkAsRead(email.id, true);
    }

    if (email.id && !email.isDraft && email.isDownloaded) {
      // FIX: Removed setLoading(true) so the list doesn't disappear and jump!
      try {
        const [attRes, bodyRes] = await Promise.allSettled([
          getEmailAttachments(email.id),
          getEmailById(email.id),
        ]);

        if (attRes.status === "fulfilled" && attRes.value.success) {
          setEmailAttachments(attRes.value.data.attachments || []);
        } else {
          setEmailAttachments([]);
        }

        if (bodyRes.status === "fulfilled" && bodyRes.value.success) {
          const fetchedData = bodyRes.value.data;
          setSelectedEmail((prev) => ({
            ...prev,
            ...fetchedData,
            isRead: true,
            isDownloaded: true,
          }));

          setEmails((prevEmails) =>
            prevEmails.map((e) =>
              String(e.id).toLowerCase() === String(email.id).toLowerCase()
                ? {
                    ...e,
                    // FIX: Ab yahan subject aur preview dono backend ke fresh data se update honge
                    subject: fetchedData.Subject || fetchedData.subject || e.subject,
                    preview: fetchedData.preview || (fetchedData.body ? fetchedData.body.substring(0, 100) : "No preview available..."),
                    body: fetchedData.body || e.body,
                  }
                : e,
            ),
          );
        }
      } catch (e) {
        console.error("Failed to load full email payload", e);
        setEmailAttachments([]);
      }
      // FIX: Removed setLoading(false)
    } else {
      setEmailAttachments([]);
    }
  };

  const handleOpenCompose = () => {
    setReplyToEmail(null);
    setEditDraft(null);
    setIsComposeOpen(true);
  };

  const handleReply = async (email) => {
    // Resolve sender's full email address from serial number if needed
    let replyEmail = { ...email };
    const senderEmail = email.senderEmail || email.from || "";
    // If senderEmail looks like just a serial number, resolve it
    if (senderEmail && /^\d+$/.test(senderEmail)) {
      const result = await convertSnToEmail(parseInt(senderEmail, 10));
      if (result.success) {
        replyEmail.senderEmail = result.email;
      }
    }
    setReplyToEmail(replyEmail);
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

  // BUG-12 FIX: Pass the page number directly to avoid stale closure
  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    loadEmails(currentFolder, newPage);
  };

  const handleMarkAsRead = async (emailId, isRead = true) => {
    try {
      const result = await markEmailRead(emailId, isRead);
      if (result.success) {
        setEmails((prevEmails) =>
          prevEmails.map((email) =>
            email.id === emailId ? { ...email, isRead: isRead } : email,
          ),
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

  const handleToggleStar = async (emailId) => {
    // Find current starred state
    const email = emails.find((e) => String(e.id) === String(emailId));
    const newStarred = !(email?.starred);

    // Optimistic update
    setEmails((prev) =>
      prev.map((e) =>
        String(e.id) === String(emailId) ? { ...e, starred: newStarred } : e
      )
    );
    if (selectedEmail && String(selectedEmail.id) === String(emailId)) {
      setSelectedEmail((prev) => ({ ...prev, starred: newStarred }));
    }

    // Persist to backend
    try {
      const result = await starEmail(emailId, newStarred);
      if (!result.success) {
        // Revert on failure
        setEmails((prev) =>
          prev.map((e) =>
            String(e.id) === String(emailId) ? { ...e, starred: !newStarred } : e
          )
        );
      }
    } catch (error) {
      console.error("Star toggle error:", error);
    }
  };

  const handleMoveEmail = async (emailId, targetFolder) => {
    try {
      const result = await moveEmail(emailId, targetFolder);
      if (result.success) {
        setEmails((prevEmails) =>
          prevEmails.filter((email) => email.id !== emailId),
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

const handleDeleteEmail = async (emailId, isPermanent = false) => {
    // FIX: Automatically force permanent delete if we are currently viewing the trash folder!
    const forcePermanent = isPermanent || currentFolder === "trash";

    try {
      const result = forcePermanent
        ? await deleteEmailPermanent(emailId)
        : await deleteEmail(emailId);

      if (result.success) {
        setEmails((prevEmails) => {
          const remaining = prevEmails.filter((email) => email.id !== emailId);
          // If folder is now empty after delete, navigate to inbox
          if (remaining.length === 0 && currentFolder !== "inbox") {
            setTimeout(() => handleFolderChange("inbox"), 0);
          }
          return remaining;
        });
        if (selectedEmail && selectedEmail.id === emailId) {
          setSelectedEmail(null);
        }
        loadMailCounts();
      }
    } catch (error) {
      console.error("Delete email error:", error);
    }
  };

  // the code works

  const handleDownloadMail = async (identifier) => {
    setIsDownloadingItem(identifier);
    try {
      // First try reading from local DB (already downloaded emails)
      // identifier is 32-char hex email_id for DB emails, guid for pending
      let contentRes;
      if (identifier && identifier.length === 32 && !identifier.startsWith("pending-")) {
        const localRes = await getEmailById(identifier);
        if (localRes.success && localRes.data && localRes.data.body) {
          contentRes = { success: true, data: localRes.data };
        } else {
          contentRes = await downloadEmailContent(identifier);
        }
      } else {
        contentRes = await downloadEmailContent(identifier);
      }

      const responseData = contentRes.data || contentRes;

      if (
        contentRes.success ||
        responseData.status === "success" ||
        responseData.body
      ) {
        const decryptedBody = responseData.body || "";
        const decryptedSubject = responseData.subject || "";
        const incomingAttachments = responseData.attachments || [];

        setPendingMails((prev) => prev.filter((m) => m.guid !== identifier));

        setSelectedEmail((prev) => ({
          ...prev,
          body: decryptedBody,
          subject: decryptedSubject || prev?.subject,
          isDownloaded: true,
          isPending: false,
          isRead: true,
        }));

        setEmailAttachments(incomingAttachments);

        setEmails((prev) =>
          prev.map((e) =>
            e.id === identifier || e.guid === identifier
              ? {
                  ...e,
                  isDownloaded: true,
                  body: decryptedBody,
                  preview: decryptedBody.substring(0, 100),
                }
              : e,
          ),
        );

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

  const handleDownloadAttachment = async (
    emailId,
    attachmentIndex,
    attachmentName,
  ) => {
    try {
      setNotification(`Downloading ${attachmentName || "attachment"}...`);
      await downloadMailAttachment(emailId, attachmentIndex);
      setNotification(
        `Download started for ${attachmentName || "attachment"}!`,
      );
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
        activeView === "trash" ||
        activeView === "starred" ||
        activeView === "archive") && (
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
            onToggleStar={handleToggleStar}
            sortMode={sortMode}
            onSortChange={handleSortChange}
          />
          {!isComposeOpen && (
            <ReadingPane
              email={selectedEmail}
              onDownload={handleDownloadMail}
              isDownloading={
                isDownloadingItem === (selectedEmail?.guid || selectedEmail?.id)
              }
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
