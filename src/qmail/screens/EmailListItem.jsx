/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Copy,
  Loader2,
  Mail,
  MailOpen,
  Menu,
  Paperclip,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Star,
  Trash2,
  UserPlus,
} from "lucide-react";
import SenderAvatar from "./SenderAvatar";

const EmailListItem = ({
  email,
  onSelect,
  isSelected,
  onMarkAsRead,
  onToggleStar,
  onDeleteEmail,
  onRowAction,
  onAttachmentClick,
  isLoadingDraft = false,
  currentFolder = "inbox",
}) => {
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const actionMenuRef = useRef(null);
  const copyResetRef = useRef(null);
  const isTrashItem = email.isTrashed || email.folder === "trash";

  // Prefer the resolved contact name as the primary label; fall back to the
  // address when the party is not a saved contact. The address is always what
  // the copy button and hover tooltip surface.
  const senderAddress =
    email.senderDisplayAddress || email.senderEmail || email.sender || "";
  const senderLabel = email.senderDisplayName || senderAddress;
  const hasDistinctAddress =
    Boolean(senderAddress) && senderAddress !== senderLabel;

  const handleCopyAddress = (event) => {
    event.stopPropagation();
    if (!senderAddress) return;

    const markCopied = () => {
      setAddressCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setAddressCopied(false), 1500);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(senderAddress).then(markCopied, () => {});
    }
  };
  const deleteTitle = email.isPending
    ? "Delete pending encrypted message"
    : isTrashItem
      ? "Delete permanently"
      : "Move to trash";
  const itemClassName = [
    "email-list-pane__item",
    isSelected ? "email-list-pane__item--selected" : "",
    !email.isRead ? "email-list-pane__item--unread" : "",
    email.isPending ? "email-list-pane__item--pending" : "",
    isLoadingDraft ? "email-list-pane__item--loading" : "",
    isActionMenuOpen ? "email-list-pane__item--menu-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleSelect = () => {
    if (isLoadingDraft) return;
    onSelect(email);
  };

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!isActionMenuOpen) return undefined;

    const handleDocumentClick = (event) => {
      if (
        actionMenuRef.current &&
        !actionMenuRef.current.contains(event.target)
      ) {
        setIsActionMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") setIsActionMenuOpen(false);
    };

    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isActionMenuOpen]);

  const canUseRowActions =
    Boolean(onRowAction) && !email.isPending && Boolean(email.id) && !isLoadingDraft;
  const canUseSenderActions = Boolean(
    email.senderSn ||
      email.sender_sn ||
      email.senderEmail ||
      email.from ||
      email.sender,
  );
  const canUseRefundActions =
    currentFolder !== "sent" &&
    currentFolder !== "drafts" &&
    currentFolder !== "trash" &&
    !email.isDraft;
  // Mark-all-read from sender is meaningful for folders that track unread
  // inbound mail (inbox/archive); not for sent/drafts/trash.
  const canMarkAllReadFromSender =
    currentFolder !== "sent" &&
    currentFolder !== "drafts" &&
    currentFolder !== "trash" &&
    !email.isDraft;
  const canArchiveSender =
    currentFolder !== "archive" &&
    currentFolder !== "trash" &&
    currentFolder !== "drafts";
  // Single-message archive: same folder gate as bulk archive-from-sender.
  const canArchiveMessage = canArchiveSender && !email.isDraft;
  const rowActionItems = [
    {
      action: "add-contact",
      label: "Add this person to contacts",
      icon: UserPlus,
      disabled: !canUseSenderActions,
    },
    {
      action: "edit-contact",
      label: "Edit this person's contact",
      icon: Pencil,
      disabled: !canUseSenderActions,
    },
    {
      action: "add-favorite",
      label: "Add this person to favorites",
      icon: Star,
      disabled: !canUseSenderActions,
    },
    {
      action: "mark-all-read-from-sender",
      label: "Mark all as read from this user",
      icon: MailOpen,
      disabled: !canUseSenderActions || !canMarkAllReadFromSender,
    },
    ...(canArchiveMessage
      ? [
          {
            action: "archive-message",
            label: "Archive this Qmail",
            icon: Archive,
          },
        ]
      : []),
    {
      action: "blacklist-sender",
      // Leading 💀 is rendered in the icon slot; full phrase for a11y/title.
      label: "💀 Black list this person",
      emoji: "💀",
      labelText: "Black list this person",
      disabled: !canUseSenderActions,
    },
    {
      action: "whitelist-sender",
      label: "💋 White list this person",
      emoji: "💋",
      labelText: "White list this person",
      disabled: !canUseSenderActions,
    },
    {
      action: "refund",
      label: "Refund",
      icon: RotateCcw,
      disabled: !canUseRefundActions,
    },
    {
      action: "refund-delete",
      label: "Refund and Delete",
      icon: RotateCcw,
      disabled: !canUseRefundActions,
      danger: true,
    },
    {
      action: "delete-from-sender",
      label: "Delete All Qmails From this user",
      icon: Trash2,
      disabled: !canUseSenderActions,
      danger: true,
    },
    {
      action: "archive-from-sender",
      label: "Archive all QMails from this user",
      icon: Archive,
      disabled: !canUseSenderActions || !canArchiveSender,
    },
  ];

  const actionMenu = canUseRowActions ? (
    <div className="email-list-pane__row-menu" ref={actionMenuRef}>
      <button
        type="button"
        className="email-list-pane__row-menu-button"
        title="Message actions"
        aria-label="Message actions"
        aria-expanded={isActionMenuOpen}
        onClick={(event) => {
          event.stopPropagation();
          setIsActionMenuOpen((open) => !open);
        }}
      >
        <Menu size={16} />
      </button>
      {isActionMenuOpen && (
        <div
          className="email-list-pane__row-menu-popover"
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          {rowActionItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                className={`email-list-pane__row-menu-item ${
                  item.danger ? "email-list-pane__row-menu-item--danger" : ""
                }`}
                disabled={item.disabled}
                onClick={() => {
                  setIsActionMenuOpen(false);
                  onRowAction(email, item.action);
                }}
              >
                {item.emoji ? (
                  <span
                    className="email-list-pane__row-menu-emoji"
                    aria-hidden="true"
                  >
                    {item.emoji}
                  </span>
                ) : (
                  Icon && <Icon size={14} />
                )}
                <span>{item.labelText || item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const attachmentIndicator = email.hasAttachments && onAttachmentClick && currentFolder === "sent" ? (
    <button
      type="button"
      className="email-list-pane__attachment-button"
      aria-label={
        email.attachmentCount > 1
          ? `Show first of ${email.attachmentCount} sent attachments in folder`
          : "Show sent attachment in folder"
      }
      title={
        email.attachmentCount > 1
          ? `Show first of ${email.attachmentCount} sent attachments in folder`
          : "Show sent attachment in folder"
      }
      onClick={(event) => {
        event.stopPropagation();
        onAttachmentClick(email);
      }}
    >
      <Paperclip size={13} />
    </button>
  ) : email.hasAttachments ? (
    <Paperclip
      size={13}
      className="email-list-pane__attachment-icon"
      aria-label={
        email.attachmentCount > 1
          ? `${email.attachmentCount} attachments`
          : "Has attachment"
      }
      title={
        email.attachmentCount > 1
          ? `${email.attachmentCount} attachments`
          : "Has attachment"
      }
    />
  ) : null;

  return (
    <article
      className={itemClassName}
      role="button"
      tabIndex={isLoadingDraft ? -1 : 0}
      aria-busy={isLoadingDraft || undefined}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        handleSelect();
      }}
    >
      <div className="email-list-pane__item-header">
        <div
          className={`email-list-pane__subject ${
            email.isPlaceholderSubject ? "email-list-pane__subject--placeholder" : ""
          }`}
          title={email.subject}
        >
          {email.subject}
        </div>
        <div className="email-list-pane__header-trailing">
          {isLoadingDraft ? (
            <Loader2 size={16} className="spinning" title="Loading draft..." />
          ) : (
            actionMenu
          )}
        </div>
      </div>

      <div className="email-list-pane__item-body">
        <SenderAvatar
          sender={email.sender}
          email={email.senderEmail || email.from}
          status={email.senderStatus}
          senderSn={email.senderSn ?? email.sender_sn}
          senderDenominationCode={email.senderDenominationCode ?? email.sender_denomination_code}
        />

        <div className="email-list-pane__details">
          {/* Meta line: time · sender address · action icons */}
          <div className="email-list-pane__meta-row">
            <span className="email-list-pane__timestamp">{email.timestamp}</span>
            <span
              className="email-list-pane__sender"
              title={hasDistinctAddress ? senderAddress : undefined}
            >
              {senderLabel}
            </span>
            {senderAddress && (
              <button
                type="button"
                className={`email-list-pane__address-copy ${
                  addressCopied ? "email-list-pane__address-copy--copied" : ""
                }`}
                onClick={handleCopyAddress}
                title={addressCopied ? "Address copied" : `Copy ${senderAddress}`}
                aria-label={
                  addressCopied
                    ? "Address copied"
                    : `Copy address ${senderAddress}`
                }
              >
                {addressCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
            {email.annoyanceReported && (
              <ShieldAlert
                size={14}
                className="email-list-pane__annoyance-icon"
                title="Reported as annoying"
              />
            )}
            <div className="email-list-pane__meta-actions">
              {email.isPending ? (
                <>
                  {attachmentIndicator}
                  <div
                    className="email-list-pane__list-trash-indicator"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteEmail && onDeleteEmail(email, false);
                    }}
                    title={deleteTitle}
                  >
                    <Trash2 size={14} className="email-list-pane__list-trash-icon" />
                  </div>
                  {email.isDecrypting ? (
                    <Loader2
                      size={16}
                      className="email-list-pane__pending-icon email-list-pane__pending-icon--decrypting spinning"
                      title="Decrypting message"
                    />
                  ) : (
                    <Mail
                      size={16}
                      className="email-list-pane__envelope-icon email-list-pane__envelope-icon--unread"
                      title="Unread message queued for background decryption"
                    />
                  )}
                </>
              ) : (
                <>
                  {attachmentIndicator}
                  <div
                    className="email-list-pane__list-trash-indicator"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteEmail && onDeleteEmail(email.id, isTrashItem);
                    }}
                    title={deleteTitle}
                  >
                    <Trash2 size={14} className="email-list-pane__list-trash-icon" />
                  </div>
                  {!email.isDraft && (
                    <div
                      className="email-list-pane__read-indicator"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkAsRead && onMarkAsRead(email.id, !email.isRead);
                      }}
                      title={email.isRead ? "Mark as unread" : "Mark as read"}
                    >
                      {email.isRead ? (
                        <MailOpen
                          size={16}
                          className="email-list-pane__envelope-icon email-list-pane__envelope-icon--read"
                        />
                      ) : (
                        <Mail
                          size={16}
                          className="email-list-pane__envelope-icon email-list-pane__envelope-icon--unread"
                        />
                      )}
                    </div>
                  )}
                  <Star
                    size={16}
                    className={`email-list-pane__star-icon ${
                      email.starred ? "email-list-pane__star-icon--starred" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar && onToggleStar(email.id);
                    }}
                  />
                </>
              )}
            </div>
          </div>
          <div
            className={`email-list-pane__preview ${
              email.isEmptyBodyPreview ? "email-list-pane__preview--empty" : ""
            }`}
          >
            {email.preview}
          </div>
          {email.tags && email.tags.length > 0 && (
            <div className="email-list-pane__tags">
              {email.tags.map((tag) => (
                <span
                  key={tag}
                  className={`email-list-pane__tag email-list-pane__tag--${tag}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

export default EmailListItem;
