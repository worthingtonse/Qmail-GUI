/* eslint-disable react/prop-types */
import { useState, useEffect, useMemo, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import ComposeModal from "./ComposeModal";
import ContactsPane from "./ContactsPane";
import AccountPane from "./AccountPane";
import NavigationPane from "./NavigationPane";
import EmailListPane from "./EmailListPane";
import ReadingPane from "./ReadingPane";
import {
  getMailList,
  searchEmails,
  getMailCount,
  getMailFolders,
  getEmailById,
  getDrafts,
  getEmailAttachments,
  getQMailWalletBalance,
  checkMailNow,
  echoRaida,
  markEmailRead,
  moveEmail,
  deleteEmail,
  deleteEmailPermanent,
  emptyTrashFolder,
  getMailNotifications,
  downloadEmailContent,
  downloadMailAttachment,
  starEmail,
  convertSnToEmail,
  getIdentity,
  normalizeIdentityForUi,
} from "../../api/qmailApiServices";
import { formatTimestamp } from "./formatTimestamp";
import {
  clearQmailLocalStorageExceptSkip,
  setSkipAutoRestore,
} from "../skipAutoRestore";
import { useNotification } from "../../components/common/notifications/NotificationContext";

import "./QMailDashboard.css";

const PENDING_DUPLICATE_WINDOW_MS = 60000;
const SEARCH_RESULT_LIMIT = 50;
const EMPTY_BODY_PREVIEW = "(no message body)";

const getFirstNonBlankText = (...values) =>
  values.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  ) || "";

const buildPreviewState = (body, ...previewCandidates) => {
  const preview = getFirstNonBlankText(...previewCandidates);
  if (preview) {
    return { preview, isEmptyBodyPreview: false };
  }

  const bodyText = typeof body === "string" ? body.trim() : "";
  if (bodyText) {
    return {
      preview: bodyText.substring(0, 100),
      isEmptyBodyPreview: false,
    };
  }

  return {
    preview: EMPTY_BODY_PREVIEW,
    isEmptyBodyPreview: true,
  };
};

const getPendingTimestamp = (notif) =>
  notif.timestamp ||
  notif.received_timestamp ||
  notif.receivedTimestamp ||
  notif.created_at ||
  notif.createdAt ||
  0;

const timestampToMs = (value) => {
  const num = Number(value);
  if (!num || Number.isNaN(num)) return 0;
  return num < 1e12 ? num * 1000 : num;
};

const getPendingSender = (notif) =>
  notif.sender_address ||
  notif.senderAddress ||
  notif.sender_name ||
  notif.senderName ||
  (notif.sender_sn ? String(notif.sender_sn) : "") ||
  "Unknown Sender";

// FIX-03: replace the dead `initValues` prop with `initialIdentity`
// (threaded from App via QMail). May be null on the has_id fallback
// path — userAccount falls back to a mount-time getIdentity() call.
const INITIAL_MAIL_COUNTS = {
  inbox: { unread: 0, total: 0 },
  sent: { unread: 0, total: 0 },
  drafts: { unread: 0, total: 0 },
  trash: { unread: 0, total: 0 },
  archive: { unread: 0, total: 0 },
  starred: { unread: 0, total: 0 },
};

const QMailDashboard = ({ initialIdentity, onSignOut }) => {
  const [activeView, setActiveView] = useState("inbox");
  const [currentFolder, setCurrentFolder] = useState("inbox");
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [emails, setEmails] = useState([]);
  const [, setDrafts] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalEmailCount, setTotalEmailCount] = useState(0);
  const [sortMode, setSortMode] = useState("newest");
  const EMAILS_PER_PAGE = 50;

  const [mailCounts, setMailCounts] = useState(INITIAL_MAIL_COUNTS);
  const [searchResultCapHit, setSearchResultCapHit] = useState(false);

  const [walletBalance, setWalletBalance] = useState(null);
  const [folders, setFolders] = useState([]);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeContext, setComposeContext] = useState(null);
  const [raidaEchoSnapshot, setRaidaEchoSnapshot] = useState(null);
  const { addNotification, clearAllNotifications } = useNotification();

  const [pendingMails, setPendingMails] = useState([]);
  const [isDownloadingItem, setIsDownloadingItem] = useState(null);
  const [emailAttachments, setEmailAttachments] = useState([]);
  const [pendingDangerousAttachment, setPendingDangerousAttachment] =
    useState(null);
  // FIX-04: track which draft row is currently being hydrated so
  // EmailListItem can show a spinner while we fetch the full draft
  // before opening ComposeModal. Hydrate-before-mount avoids the v3
  // "open modal with empty body, user types, save clobbers the
  // persisted full draft" failure mode.
  const [loadingDraftId, setLoadingDraftId] = useState(null);
  // BUG-22 FIX: Use ref instead of state for debounce timer
  const searchDebounceTimerRef = useRef(null);
  // BUG-21 FIX: Track current folder load to prevent race conditions
  const loadEmailsRequestRef = useRef(0);
  // gpt-batch1: ref-mirror of selectedEmail so async hydrate
  // completion can detect "user has moved on" without relying on a
  // stale closure of selectedEmail.
  const selectedEmailRef = useRef(null);
  // gpt-batch3 #2: monotonic request counter for draft hydration.
  // handleSelectEmail's isDraft branch captures the counter value
  // before awaiting; if a newer click bumps it (or a different folder
  // is opened), the in-flight result is dropped silently.
  const draftHydrateRequestRef = useRef(0);
  const previousMailCountsRef = useRef({});
  const pendingMailsRef = useRef([]);

  // FIX-03: seed from App's normalized identity, or null if the
  // has_id fallback path skipped seeding. The mount-time useEffect
  // below will retry getIdentity() when this is null.
  //
  // gpt-batch2 #2: ONLY seed from initialIdentity when it's
  // configured. A truthy-but-unconfigured object would skip the
  // mount-time retry and leave the user with placeholder data.
  const [userAccount, setUserAccount] = useState(
    initialIdentity && initialIdentity.configured ? initialIdentity : null,
  );

  const formattedPendingMails = useMemo(() => {
    const seenBySenderWindow = new Map();

    return pendingMails.map((notif) => {
      const sender = getPendingSender(notif);
      const rawTimestamp = getPendingTimestamp(notif);
      const timestampMs = timestampToMs(rawTimestamp);
      const duplicateKey = `${sender.toLowerCase()}::${
        timestampMs ? Math.floor(timestampMs / PENDING_DUPLICATE_WINDOW_MS) : "unknown"
      }`;
      const sequence = (seenBySenderWindow.get(duplicateKey) || 0) + 1;
      seenBySenderWindow.set(duplicateKey, sequence);
      const formattedTime =
        formatTimestamp(rawTimestamp) || new Date().toLocaleTimeString();

      return {
        id: `pending-${notif.guid}`,
        guid: notif.guid,
        sender,
        senderEmail: sender,
        from: sender,
        subject: `🔒 Encrypted message${sequence > 1 ? ` #${sequence}` : ""}`,
        preview: `Waiting to decrypt. Arrived ${formattedTime}.`,
        rawTimestamp: Number(rawTimestamp) || 0,
        timestamp: formattedTime,
        isPending: true,
        isDownloaded: false,
        isPlaceholderSubject: true,
      };
    });
  }, [pendingMails]);

  const displayEmails = useMemo(() => {
    return currentFolder === "inbox"
      ? [...formattedPendingMails, ...emails]
      : emails;
  }, [currentFolder, formattedPendingMails, emails]);

  useEffect(() => {
    pendingMailsRef.current = pendingMails;
  }, [pendingMails]);

  const showDashboardNotification = (notification, fallbackType = "info") => {
    if (!notification) return null;
    const payload =
      typeof notification === "string"
        ? { message: notification, type: fallbackType }
        : {
            ...notification,
            type: notification.type || notification.variant || fallbackType,
          };

    if (!payload.message) return null;

    const hasClickTarget = payload.targetPendingGuid || payload.targetEmailId;
    return addNotification(payload.message, payload.type, {
      duration: payload.duration ?? (payload.type === "error" ? 8000 : 5000),
      timestamp: payload.timestamp,
      targetPendingGuid: payload.targetPendingGuid,
      targetEmailId: payload.targetEmailId,
      onClick: hasClickTarget
        ? () => {
            if (payload.targetPendingGuid) {
              focusPendingMail(payload.targetPendingGuid);
              return;
            }
            focusInboxEmail(payload.targetEmailId);
          }
        : undefined,
    });
  };

  const mergePendingNotifications = (incoming, { showToasts = true } = {}) => {
    const existing = pendingMailsRef.current;
    const newNotifs = (incoming || []).filter(
      (n) => !existing.some((p) => p.guid === n.guid),
    );

    if (newNotifs.length === 0) return [];

    pendingMailsRef.current = [...existing, ...newNotifs];
    setPendingMails((prev) => {
      const additions = newNotifs.filter(
        (n) => !prev.some((p) => p.guid === n.guid),
      );
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });

    if (showToasts) {
      if (newNotifs.length > 1) {
        showDashboardNotification({
          message: `${newNotifs.length} new emails arrived!`,
          variant: "success",
        });
      } else {
        const [notif] = newNotifs;
        showDashboardNotification({
          message: `New mail from ${getPendingSender(notif)}`,
          timestamp: formatTimestamp(getPendingTimestamp(notif)),
          targetPendingGuid: notif.guid,
          variant: "success",
        });
      }
    }

    return newNotifs;
  };

  // Background Watcher
  useEffect(() => {
    // Don't toast on the very first poll — those notifications were
    // already pending before the user opened the dashboard, so calling
    // them "new mail" is a lie. Hydrate silently on first run; toast
    // for arrivals discovered on subsequent polls.
    let isFirstPoll = true;

    const fetchNotifications = async () => {
      try {
        const result = await getMailNotifications();
        if (result.success && result.data.count > 0) {
          const newNotifs = mergePendingNotifications(
            result.data.notifications || [],
            { showToasts: !isFirstPoll },
          );

          if (newNotifs.length === 0) {
            isFirstPoll = false;
            return;
          }
        }
      } catch (error) {
        console.error("Watch error:", error);
      } finally {
        isFirstPoll = false;
      }
    };

    const interval = setInterval(fetchNotifications, 10000);
    fetchNotifications();
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Dashboard bootstrap intentionally runs once; these loaders close over
    // initial view state and are also called directly by UI handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FIX-03: if App didn't pre-seed userAccount (has_id fallback path
  // — coin files on disk but identity not yet visible to the API),
  // hydrate here.
  //
  // gpt-batch2 #4: the original single-shot was too weak. Use the
  // same retry+backoff discipline as hydrateDownloadedEmail —
  // 3 attempts (immediate, +500ms, +1000ms) wrapped in try/catch and
  // cancellable. After 3 failures, leave userAccount null; AccountPane
  // already conditionally renders the profile section so the rest of
  // the dashboard remains usable. The user can refresh later.
  useEffect(() => {
    if (userAccount) return; // Already seeded from props.
    let cancelled = false;
    const MAX_ATTEMPTS = 3;

    (async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        try {
          const raw = await getIdentity();
          if (cancelled) return;
          const normalized = normalizeIdentityForUi(raw);
          if (normalized && normalized.configured) {
            setUserAccount(normalized);
            return;
          }
        } catch (e) {
          console.warn(`Mount-time getIdentity attempt ${attempt + 1} failed:`, e);
        }
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      console.warn("Mount-time identity hydration gave up after retries.");
    })();

    return () => {
      cancelled = true;
    };
  }, [userAccount]);

  // gpt-batch1: mirror selectedEmail into a ref so async hydrate
  // completion can detect when the user has moved on to a different
  // message. See handleDownloadMail.
  useEffect(() => {
    selectedEmailRef.current = selectedEmail;
  }, [selectedEmail]);

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
      // syncData() was removed from the background load: /api/admin/sync
      // was removed in QMail v2 and the stub always returns failure.
      await loadWalletBalance();

      await Promise.all([loadFolders(), loadMailCounts(), loadDrafts()]);
      await loadEmails(currentFolder);
    } catch (error) {
      console.error("Error loading initial data:", error);
      showDashboardNotification("Error loading dashboard data", "error");
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

  const loadFolders = async () => {
    const result = await getMailFolders();
    if (result.success) {
      // CORE-J is still open. The backend currently exposes Starred as
      // folder=4, but the star icon writes is_starred and does not move
      // rows there. Hide the nav entry until /messages/list supports
      // the cross-folder starred=true filter.
      setFolders(
        (result.data.folders || []).filter(
          (folder) => folder.name !== "starred",
        ),
      );
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
      const previousMailCounts = previousMailCountsRef.current;

      if (
        previousMailCounts.inbox &&
        newCounts.inbox.total > previousMailCounts.inbox.total
      ) {
        const newMailCount =
          newCounts.inbox.total - previousMailCounts.inbox.total;
        if (newMailCount > 1) {
          showDashboardNotification({
            message: `${newMailCount} new emails arrived!`,
            variant: "success",
          });
        } else if (pendingMailsRef.current.length === 0) {
          const latest = await getMailList("inbox", 1, 0, "newest");
          const latestEmail = latest.success ? latest.data.emails[0] : null;
          const sender = latestEmail
            ? latestEmail.sender ||
              latestEmail.sender_address ||
              latestEmail.from ||
              "Unknown Sender"
            : "Unknown Sender";
          showDashboardNotification({
            message: `New mail from ${sender}`,
            targetEmailId: latestEmail?.id,
            variant: "success",
          });
        }

        if (currentFolder === "inbox") {
          loadEmails("inbox");
        }
      }

      if (newCounts.drafts) newCounts.drafts.unread = 0;

      // BUG-25 FIX: document.title is now managed by useEffect
      previousMailCountsRef.current = newCounts;
      setMailCounts(newCounts);
    }
    return result;
  };

  // BUG-12 FIX: Accept optional page parameter to avoid stale currentPage
  // BUG-21 FIX: Track request ID to discard stale responses
  const loadEmails = async (folder, page = null, options = {}) => {
    const { notifyOnError = true } = options;
    const requestId = ++loadEmailsRequestRef.current;
    setLoading(true);
    setSearchResultCapHit(false);

    try {
      if (folder === "drafts") {
        // BUG-03 FIX: Use returned value instead of stale closure
        const freshDrafts = await loadDrafts();
        const transformedDrafts = freshDrafts.map((draft) => {
          const body = draft.body || draft.content || "";
          const previewState = buildPreviewState(body, draft.preview);

          return {
            id: draft.id || `draft_${Date.now()}_${Math.random()}`,
            sender: "You (Draft)",
            // FIX-03: userAccount may be null briefly during initial load.
            // Use the normalized prettyAddress / pretty_address / address
            // fields; fall back to a generic placeholder rather than the
            // old placeholder address.
            senderEmail:
              userAccount?.prettyAddress ||
              userAccount?.pretty_address ||
              userAccount?.address ||
              "",
            subject: draft.subject || "No Subject",
            body,
            ...previewState,
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
          };
        });
        setEmails(transformedDrafts);
        return { success: true };
      }

      const effectivePage = page !== null ? page : currentPage;
      const offset = effectivePage * EMAILS_PER_PAGE;
      const result = await getMailList(folder, EMAILS_PER_PAGE, offset, sortMode);

      // BUG-21 FIX: Discard stale response if a newer request was started
      if (requestId !== loadEmailsRequestRef.current) {
        return { success: true, stale: true };
      }

      if (result.success) {
        setTotalEmailCount(result.data.totalCount);

        const transformedEmails = result.data.emails.map((email) => {
          const body = email.body || "";
          const previewState = buildPreviewState(body, email.preview);

          return {
            id: email.EmailID || email.id,
            sender:
              email.sender || email.sender_address || email.from || "Unknown",
            senderEmail: email.senderEmail || email.sender_address || "",
            subject: email.Subject || email.subject || "No Subject",
            body,
            ...previewState,
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
          };
        });

        setEmails(transformedEmails);
        return result;
      } else {
        setEmails([]);
        if (notifyOnError) {
          showDashboardNotification("Failed to load emails", "error");
        }
        return result;
      }
    } catch (error) {
      console.error("Email loading error:", error);
      if (requestId === loadEmailsRequestRef.current) {
        setEmails([]);
        if (notifyOnError) {
          showDashboardNotification("Error loading emails", "error");
        }
      }
      return { success: false, error: error.message };
    } finally {
      if (requestId === loadEmailsRequestRef.current) {
        setLoading(false);
      }
    }
  };

  const handleFolderChange = (folder) => {
    setCurrentFolder(folder);
    setActiveView(folder);
    setSelectedEmail(null);
    // gpt-batch3 #2: invalidate any in-flight draft hydrate so it
    // doesn't pop the modal after the user navigated away.
    draftHydrateRequestRef.current += 1;
    setLoadingDraftId(null);

    // BUG-25 FIX: document.title is now managed by useEffect
    loadEmails(folder);
  };

  const handleSortChange = (newSort) => {
    // Toggle: if already active, switch back to newest; otherwise activate
    const effectiveSort = sortMode === newSort ? "newest" : newSort;
    setSortMode(effectiveSort);
    setCurrentPage(0);
    setSearchResultCapHit(false);
    // Reload with new sort — need to pass it directly since setState is async
    const requestId = ++loadEmailsRequestRef.current;
    setLoading(true);
    getMailList(currentFolder, EMAILS_PER_PAGE, 0, effectiveSort)
      .then((result) => {
        if (requestId !== loadEmailsRequestRef.current) return;
        if (result.success) {
          setTotalEmailCount(result.data.totalCount);
          const transformedEmails = result.data.emails.map((email) => {
            const body = email.body || "";
            const previewState = buildPreviewState(body, email.preview);

            return {
              id: email.EmailID || email.id,
              sender: email.sender || email.sender_address || email.from || "Unknown",
              senderEmail: email.senderEmail || email.sender_address || "",
              subject: email.Subject || email.subject || "No Subject",
              body,
              ...previewState,
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
            };
          });
          setEmails(transformedEmails);
        }
      })
      .catch((error) => {
        console.error("Email sort error:", error);
        if (requestId === loadEmailsRequestRef.current) {
          setEmails([]);
          showDashboardNotification("Error loading emails", "error");
        }
      })
      .finally(() => {
        if (requestId === loadEmailsRequestRef.current) {
          setLoading(false);
        }
      });
  };

  const handleSearch = async (query) => {
    if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);
    if (query.trim() === "") {
      setSearchResultCapHit(false);
      loadEmails(currentFolder);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchEmails(query, SEARCH_RESULT_LIMIT);
      if (result.success) {
        const transformedEmails = result.data.results.map((email) => {
          const body = email.body || email.content || "";
          const previewState = buildPreviewState(
            body,
            email.preview,
            email.body_preview,
            email.snippet,
          );

          return {
            id: email.email_id || email.id || Date.now() + Math.random(),
            sender:
              email.sender || email.sender_address || String(email.sender_sn || "Unknown"),
            senderEmail: email.senderEmail || email.sender_address || String(email.sender_sn || ""),
            subject: email.subject || "No Subject",
            body,
            ...previewState,
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
          };
        });
        setEmails(transformedEmails);
        setTotalEmailCount(transformedEmails.length);
        setSearchResultCapHit(transformedEmails.length === SEARCH_RESULT_LIMIT);
        setSelectedEmail(
          transformedEmails.length > 0 ? transformedEmails[0] : null,
        );
      } else {
        setSearchResultCapHit(false);
      }
      setLoading(false);
    }, 500);

    searchDebounceTimerRef.current = timer;
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    let hadFailure = false;

    const runRefreshStep = async (label, step) => {
      try {
        return await step();
      } catch (error) {
        hadFailure = true;
        console.warn(`${label} refresh step failed:`, error);
        return null;
      }
    };

    try {
      await runRefreshStep("Beacon ping", async () => {
        const result = await checkMailNow();
        if (!result.success) {
          throw new Error(result.error || "Beacon ping failed");
        }
        return result;
      });

      await runRefreshStep("RAIDA echo", async () => {
        const result = await echoRaida();
        if (!result.success) throw new Error(result.error || "RAIDA echo failed");
        setRaidaEchoSnapshot(result.data);
        return result;
      });

      await runRefreshStep("Mail notifications", async () => {
        const result = await getMailNotifications();
        if (!result.success) {
          throw new Error(result.error || "Mail notifications failed");
        }
        mergePendingNotifications(result.data.notifications || []);
        return result;
      });

      await runRefreshStep("Mail counts", async () => {
        const result = await loadMailCounts();
        if (!result?.success) {
          throw new Error(result?.error || "Mail counts failed");
        }
        return result;
      });

      await runRefreshStep("Message list", async () => {
        const result = await loadEmails(currentFolder, null, {
          notifyOnError: false,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Message list failed");
        }
        return result;
      });

      showDashboardNotification(
        hadFailure
          ? "Refresh completed with some service errors."
          : "Refresh complete.",
        hadFailure ? "warning" : "success",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelectEmail = async (email) => {
    if (!email) return;

    if (email.isPending || email.isDownloaded === false) {
      setSelectedEmail(email);
      setEmailAttachments([]);
      return;
    }

    if (email.isDraft) {
      // FIX-04: /db/drafts/list returns preview metadata only
      // (subject, body_preview, recipient_count, timestamps). If we
      // opened ComposeModal directly with that row, body/to/cc/bcc
      // would be empty and a Save Draft would overwrite the persisted
      // full draft with the empty fields. Fetch the full draft via
      // /db/messages/get BEFORE mounting the modal.
      if (loadingDraftId) return; // Ignore re-clicks while loading.

      // gpt-batch3 #2: capture a request id so we can detect if the
      // user clicks something else (or changes folder) while the
      // fetch is in flight. Stale results are dropped silently
      // instead of opening the modal after the user moved on.
      const requestId = ++draftHydrateRequestRef.current;
      setLoadingDraftId(email.id);
      try {
        const res = await getEmailById(email.id);
        if (draftHydrateRequestRef.current !== requestId) {
          // User moved on before this fetch completed; drop silently.
          return;
        }
        if (res.success && res.data) {
          // Merge the preview row with the fetched full body so any
          // fields ComposeModal reads (subject, body, to, cc, bcc,
          // subsubject) are populated.
          setComposeContext({
            mode: "draft",
            sourceEmail: { ...email, ...res.data },
            ownIdentity: userAccount,
            draftId: email.id
          });
          setIsComposeOpen(true);
        } else {
          showDashboardNotification("Could not load draft. Try again.", "error");
        }
      } catch (e) {
        if (draftHydrateRequestRef.current !== requestId) return;
        console.warn("Draft hydration failed:", e);
        showDashboardNotification("Could not load draft. Try again.", "error");
      } finally {
        if (draftHydrateRequestRef.current === requestId) {
          setLoadingDraftId(null);
        }
      }
      return;
    }

    // gpt-batch3 #2: any click on a non-draft message also
    // invalidates an in-flight draft hydrate. Without this, clicking
    // a regular inbox row while a draft hydrate is loading would
    // still pop the draft modal when the fetch resolved.
    if (draftHydrateRequestRef.current > 0) {
      draftHydrateRequestRef.current += 1;
      if (loadingDraftId) setLoadingDraftId(null);
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
          const fetchedBody = fetchedData.body || email.body || "";
          const previewState = buildPreviewState(
            fetchedBody,
            fetchedData.preview,
          );
          setSelectedEmail((prev) => ({
            ...prev,
            ...fetchedData,
            ...previewState,
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
                    ...previewState,
                    body: fetchedBody || e.body,
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
    setComposeContext({
      mode: "new",
      ownIdentity: userAccount
    });
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
    setComposeContext({
      mode: "reply",
      sourceEmail: replyEmail,
      ownIdentity: userAccount
    });
    setIsComposeOpen(true);
  };

  const hasRecipientValue = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  };

  const hasReplyAllRecipientData = (email) =>
    hasRecipientValue(email?.to) ||
    hasRecipientValue(email?.To) ||
    hasRecipientValue(email?.to_addresses) ||
    hasRecipientValue(email?.cc) ||
    hasRecipientValue(email?.CC) ||
    hasRecipientValue(email?.cc_addresses);

  // FIX-07: handleReplyAll
  const handleReplyAll = async (email) => {
    if (!hasReplyAllRecipientData(email)) {
      showDashboardNotification(
        "Recipient list not stored with this message.",
        "warning",
      );
      return;
    }

    let replyEmail = { ...email };
    const senderEmail = email.senderEmail || email.from || "";
    if (senderEmail && /^\d+$/.test(senderEmail)) {
      const result = await convertSnToEmail(parseInt(senderEmail, 10));
      if (result.success) {
        replyEmail.senderEmail = result.email;
      }
    }
    setComposeContext({
      mode: "replyAll",
      sourceEmail: replyEmail,
      ownIdentity: userAccount
    });
    setIsComposeOpen(true);
  };

  // FIX-06: handleForward
  const handleForward = async (email) => {
    if (
      email?.isPending ||
      email?.isDownloaded === false ||
      email?.isDownloaded === "false" ||
      email?.isDownloaded === 0
    ) {
      showDashboardNotification("Download the message first to forward.", "info");
      return;
    }

    setComposeContext({
      mode: "forward",
      sourceEmail: email,
      ownIdentity: userAccount
    });
    setIsComposeOpen(true);
  };

  const handleSendEmail = async () => {
    setIsComposeOpen(false);
    setComposeContext(null);
    showDashboardNotification("Email Sent!", "success");
    await loadWalletBalance();
    await loadDrafts();
    if (currentFolder === "drafts") {
      await loadEmails("drafts");
    }
    await loadMailCounts();
  };

  const handleSignOut = () => {
    const persisted = setSkipAutoRestore();
    if (persisted) {
      clearQmailLocalStorageExceptSkip();
    }

    loadEmailsRequestRef.current += 1;
    draftHydrateRequestRef.current += 1;

    setActiveView("inbox");
    setCurrentFolder("inbox");
    setLoading(false);
    setIsRefreshing(false);
    setEmails([]);
    setDrafts([]);
    setSelectedEmail(null);
    setCurrentPage(0);
    setTotalEmailCount(0);
    setSortMode("newest");
    setMailCounts(INITIAL_MAIL_COUNTS);
    previousMailCountsRef.current = {};
    pendingMailsRef.current = [];
    setWalletBalance(null);
    setFolders([]);
    setIsComposeOpen(false);
    setComposeContext(null);
    clearAllNotifications();
    setPendingMails([]);
    setIsDownloadingItem(null);
    setEmailAttachments([]);
    setPendingDangerousAttachment(null);
    setLoadingDraftId(null);
    setUserAccount(null);

    if (onSignOut) {
      onSignOut({ persisted });
    }
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

  const handleDeleteVisibleTrash = async (visibleMessages) => {
    if (currentFolder !== "trash") return;
    const ids = visibleMessages
      .map((email) => email.id)
      .filter(Boolean);
    if (ids.length === 0) return;

    const totalBeforeDelete =
      totalEmailCount || mailCounts.trash?.total || ids.length;

    try {
      const result = await emptyTrashFolder(ids);
      const deletedCount = result.data?.deletedCount || 0;
      const remainingCount = Math.max(0, totalBeforeDelete - deletedCount);

      if (selectedEmail && ids.includes(selectedEmail.id)) {
        setSelectedEmail(null);
      }

      const nextPage =
        currentPage > 0 && currentPage * EMAILS_PER_PAGE >= remainingCount
          ? currentPage - 1
          : currentPage;
      if (nextPage !== currentPage) {
        setCurrentPage(nextPage);
      }

      await loadEmails("trash", nextPage);
      await loadMailCounts();

      if (result.success) {
        showDashboardNotification(
          remainingCount > 0
            ? `Page deleted. ${remainingCount} more message${
                remainingCount === 1 ? "" : "s"
              } remain in trash.`
            : "Trash is empty.",
          "success",
        );
        return;
      }

      showDashboardNotification(
        deletedCount > 0
          ? `${deletedCount} message${
              deletedCount === 1 ? "" : "s"
            } deleted. ${result.data.failedIds.length} could not be deleted.`
          : result.error || "Could not delete these messages.",
        "warning",
      );
    } catch (error) {
      // Trash refresh / count refresh shouldn't throw, but if they do
      // the EmailListPane confirm modal would otherwise stay open
      // because its try/finally only catches via .finally(). Surface
      // the failure as a notification and let the caller's finally
      // close the modal.
      console.error("Trash page delete error:", error);
      showDashboardNotification(
        "Could not delete these messages. Try again.",
        "error",
      );
    }
  };

  // the code works

  // FIX-01: POST /api/qmail/net/messages/download returns metadata
  // (email_id, sender_sn, stripes_*), not the decrypted body. The body
  // lives in /db/messages/get afterwards. Hydrate from there.
  const hydrateDownloadedEmail = async (emailId) => {
    // Backend may lag indexing the row briefly after a successful
    // download. Retry up to 3 times with a short backoff. Each call
    // is wrapped in try/catch so a transient 5xx doesn't abort the
    // whole operation.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const [bodyRes, attRes] = await Promise.allSettled([
          getEmailById(emailId),
          getEmailAttachments(emailId),
        ]);

        if (bodyRes.status === "fulfilled" && bodyRes.value.success && bodyRes.value.data) {
          return {
            body: bodyRes.value.data,
            attachments:
              attRes.status === "fulfilled" && attRes.value.success
                ? attRes.value.data.attachments || []
                : [],
          };
        }
      } catch (e) {
        console.warn(`hydrateDownloadedEmail attempt ${attempt + 1} failed:`, e);
      }
      // gpt-batch1: only sleep between attempts, not after the last one.
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    return null;
  };

  const handleDownloadMail = async (identifier) => {
    setIsDownloadingItem(identifier);
    try {
      const isLocalEmailId =
        identifier && identifier.length === 32 && !identifier.startsWith("pending-");

      let hydrated;

      if (isLocalEmailId) {
        // Already-downloaded path: read directly from local DB.
        // Gem-batch1: wrap in try/catch to match the resilience of the
        // pending path (DB read can transiently fail).
        try {
          hydrated = await hydrateDownloadedEmail(identifier);
        } catch (e) {
          console.warn("Local DB short-circuit failed; falling through to network:", e);
        }
      }

      if (!hydrated) {
        // Pending path (or local short-circuit miss): download from network,
        // then hydrate body+attachments from the local DB using the returned
        // email_id.
        const downloadRes = await downloadEmailContent(identifier);
        const downloadData = downloadRes.data || downloadRes;

        const downloadOk =
          downloadRes.success ||
          downloadData.status === "success" ||
          downloadData.email_id;

        if (!downloadOk) {
          showDashboardNotification("Failed to decrypt message.", "error");
          return;
        }

        // The download response carries email_id; the body lives in /db/messages/get.
        const emailId = downloadData.email_id || (isLocalEmailId ? identifier : null);

        if (!emailId) {
          showDashboardNotification("Failed to decrypt message.", "error");
          return;
        }

        hydrated = await hydrateDownloadedEmail(emailId);

        if (!hydrated) {
          // Download succeeded but DB hydration failed after retries.
          // Leave the pending row in place so the user can retry.
          showDashboardNotification(
            "Service temporarily unavailable. Try opening the message again.",
            "warning",
          );
          return;
        }
      }

      const decryptedBody = hydrated.body.body || "";
      const decryptedSubject = hydrated.body.subject || hydrated.body.Subject || "";
      const incomingAttachments = hydrated.attachments;
      const hydratedId = hydrated.body.email_id || hydrated.body.EmailID || identifier;
      const previewState = buildPreviewState(decryptedBody, hydrated.body.preview);

      // Build the row to insert synchronously so the list doesn't flicker
      // between "pending row removed" and "loadEmails finished refreshing."
      // loadEmails() below will replace this with the canonical server data.
      // Gem-batch1 follow-up: prevent the visible gap.
      const hydratedRow = {
        id: hydratedId,
        sender:
          hydrated.body.sender ||
          hydrated.body.sender_address ||
          hydrated.body.from ||
          "Unknown",
        senderEmail:
          hydrated.body.senderEmail || hydrated.body.sender_address || "",
        subject: decryptedSubject || "No Subject",
        body: decryptedBody,
        ...previewState,
        rawTimestamp: Number(
          hydrated.body.ReceivedTimestamp ||
            hydrated.body.receivedTimestamp ||
            hydrated.body.timestamp,
        ) || 0,
        timestamp: formatTimestamp(
          hydrated.body.ReceivedTimestamp ||
            hydrated.body.receivedTimestamp ||
            hydrated.body.timestamp,
        ),
        isRead: true,
        isDownloaded: true,
        tags: hydrated.body.tags || [],
        starred: hydrated.body.isStarred || hydrated.body.starred || false,
        senderStatus: "none",
        folder: currentFolder,
        isTrashed: currentFolder === "trash",
      };

      // Step 1: insert hydrated row into emails (or update if already present
      // — happens when this was a local short-circuit on an existing row).
      setEmails((prev) => {
        const existingIdx = prev.findIndex(
          (e) => e.id === identifier || e.guid === identifier || e.id === hydratedId,
        );
        if (existingIdx >= 0) {
          const next = prev.slice();
          next[existingIdx] = { ...prev[existingIdx], ...hydratedRow };
          return next;
        }
        return [hydratedRow, ...prev];
      });

      // Step 2: drop the pending row only after emails has the replacement,
      // so displayEmails never has a gap.
      // Gem-batch1: removed the ineffective `m.guid !== hydrated.body.email_id`
      // filter — guid (network) and email_id (local DB) are different ID
      // namespaces, so that comparison never matched anything.
      setPendingMails((prev) => prev.filter((m) => m.guid !== identifier));

      // gpt-batch1: stale-selection guard. If the user clicked away
      // mid-hydrate, do NOT overwrite selectedEmail/attachments — that
      // would render this message's body on top of the new message's
      // metadata.
      const currentSel = selectedEmailRef.current;
      const stillSelected =
        currentSel &&
        (currentSel.id === identifier ||
          currentSel.guid === identifier ||
          currentSel.id === hydratedId);

      if (stillSelected) {
        setSelectedEmail((prev) => ({
          ...prev,
          ...hydrated.body,
          body: decryptedBody,
          subject: decryptedSubject || prev?.subject,
          isDownloaded: true,
          isPending: false,
          isRead: true,
        }));
        setEmailAttachments(incomingAttachments);
      }

      // gpt-batch1: persist read state to the backend, not just UI.
      // handleSelectEmail's pending branch returns early before the
      // normal markEmailRead path; do it here once the local email_id
      // is known.
      if (hydratedId) {
        markEmailRead(hydratedId, true).catch((e) =>
          console.warn("markEmailRead after hydrate failed:", e),
        );
      }

      // Refresh from server — this will replace the synchronously-inserted
      // hydratedRow with the canonical version.
      loadEmails(currentFolder);
      loadMailCounts();

      showDashboardNotification("Message decrypted successfully!", "success");
    } catch (error) {
      console.error("Download failed:", error);
      showDashboardNotification("Download failed", "error");
    } finally {
      setIsDownloadingItem(null);
    }
  };

  const performAttachmentDownload = async ({
    emailId,
    attachmentId,
    attachmentName,
  }) => {
    try {
      showDashboardNotification(
        `Downloading ${attachmentName || "attachment"}...`,
        "info",
      );
      await downloadMailAttachment(emailId, attachmentId, attachmentName);
      showDashboardNotification(
        `Download started for ${attachmentName || "attachment"}!`,
        "success",
      );
    } catch (error) {
      console.error("Attachment download failed:", error);
      showDashboardNotification("Failed to download attachment", "error");
    }
  };

  const handleDownloadAttachment = async (emailId, attachmentId, attachment) => {
    const attachmentName =
      typeof attachment === "string" ? attachment : attachment?.name;
    const downloadRequest = {
      emailId,
      attachmentId,
      attachmentName,
      warning:
        typeof attachment === "object" && attachment
          ? attachment.warning
          : "",
    };

    if (typeof attachment === "object" && attachment?.dangerous === true) {
      setPendingDangerousAttachment(downloadRequest);
      return;
    }

    await performAttachmentDownload(downloadRequest);
  };

  const handleConfirmDangerousAttachment = async () => {
    const downloadRequest = pendingDangerousAttachment;
    setPendingDangerousAttachment(null);
    if (downloadRequest) {
      await performAttachmentDownload(downloadRequest);
    }
  };

  const focusPendingMail = (guid) => {
    const pendingRow = formattedPendingMails.find((mail) => mail.guid === guid);
    if (!pendingRow) return;

    setActiveView("inbox");
    setCurrentFolder("inbox");
    setSelectedEmail(pendingRow);
    setEmailAttachments([]);
    if (currentFolder !== "inbox") {
      loadEmails("inbox");
    }
  };

  const focusInboxEmail = (emailId) => {
    if (!emailId) return;
    setActiveView("inbox");
    setCurrentFolder("inbox");
    const existing = emails.find(
      (mail) => String(mail.id).toLowerCase() === String(emailId).toLowerCase(),
    );
    if (existing) {
      setSelectedEmail(existing);
      return;
    }
    loadEmails("inbox");
  };

  return (
    <main className="qmail-dashboard">
      {pendingDangerousAttachment && (
        <div
          className="qmail-dashboard__attachment-confirm-overlay"
          role="presentation"
          onClick={() => setPendingDangerousAttachment(null)}
        >
          <section
            className="qmail-dashboard__attachment-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dangerous-attachment-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="qmail-dashboard__attachment-confirm-header">
              <ShieldAlert size={22} />
              <h3
                id="dangerous-attachment-title"
                className="qmail-dashboard__attachment-confirm-title"
              >
                Potentially Dangerous Attachment
              </h3>
            </header>
            <p className="qmail-dashboard__attachment-confirm-copy">
              This file is flagged as potentially dangerous. Save anyway?
            </p>
            {pendingDangerousAttachment.attachmentName && (
              <p className="qmail-dashboard__attachment-confirm-filename">
                {pendingDangerousAttachment.attachmentName}
              </p>
            )}
            {pendingDangerousAttachment.warning && (
              <p className="qmail-dashboard__attachment-confirm-warning">
                {pendingDangerousAttachment.warning}
              </p>
            )}
            <footer className="qmail-dashboard__attachment-confirm-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPendingDangerousAttachment(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleConfirmDangerousAttachment}
              >
                Save Anyway
              </button>
            </footer>
          </section>
        </div>
      )}

      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => {
          setIsComposeOpen(false);
          setComposeContext(null);
          if (currentFolder === "drafts") {
            loadEmails("drafts");
          }
        }}
        onSend={handleSendEmail}
        onSendFailure={(message) =>
          showDashboardNotification(message || "Failed to send email", "error")
        }
        composeContext={composeContext}
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
        walletBalance={walletBalance}
        folders={folders}
        raidaEchoSnapshot={raidaEchoSnapshot}
      />

      {(activeView === "inbox" ||
        activeView === "sent" ||
        activeView === "drafts" ||
        activeView === "trash" ||
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
            onDeleteVisibleTrash={handleDeleteVisibleTrash}
            onToggleStar={handleToggleStar}
            sortMode={sortMode}
            onSortChange={handleSortChange}
            loadingDraftId={loadingDraftId}
            searchResultCapHit={searchResultCapHit}
            pageSize={EMAILS_PER_PAGE}
          />
          {!isComposeOpen && (
            <ReadingPane
              email={selectedEmail}
              onDownload={handleDownloadMail}
              isDownloading={
                isDownloadingItem === (selectedEmail?.guid || selectedEmail?.id)
              }
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
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
          walletBalance={walletBalance}
          onSignOut={handleSignOut}
        />
      )}
    </main>
  );
};

export default QMailDashboard;
