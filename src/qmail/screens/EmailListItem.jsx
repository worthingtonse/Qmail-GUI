/* eslint-disable react/prop-types */
import { ShieldAlert, Star, Mail, MailOpen, Trash2, Loader2 } from "lucide-react";
import SenderAvatar from "./SenderAvatar";

const EmailListItem = ({
  email,
  onSelect,
  isSelected,
  onMarkAsRead,
  onToggleStar,
  onDeleteEmail,
  isChecked,
  onCheck,
  isLoadingDraft = false,
}) => {
  const isTrashItem = email.isTrashed || email.folder === "trash";
  const deleteTitle = isTrashItem ? "Delete permanently" : "Move to trash";
  const itemClassName = [
    "email-list-pane__item",
    isSelected ? "email-list-pane__item--selected" : "",
    !email.isRead ? "email-list-pane__item--unread" : "",
    email.isPending ? "email-list-pane__item--pending" : "",
    isLoadingDraft ? "email-list-pane__item--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleSelect = () => {
    if (isLoadingDraft) return;
    onSelect(email);
  };

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
      {email.isDraft ? (
        <div
          className="email-list-pane__draft-checkbox-container"
          onClick={(e) => {
            e.stopPropagation();
            if (isLoadingDraft) return;
            onCheck && onCheck(email.id);
          }}
          title={isLoadingDraft ? "Loading draft..." : "Select for deletion"}
        >
          {isLoadingDraft ? (
            <Loader2 size={16} className="spinning" />
          ) : (
            <input
              type="checkbox"
              className="email-list-pane__draft-checkbox"
              checked={!!isChecked}
              readOnly
            />
          )}
        </div>
      ) : (
        <div className="email-list-pane__action-column">
          {email.isPending ? (
            <ShieldAlert
              size={16}
              className="email-list-pane__pending-icon"
              title="Encrypted message waiting to decrypt"
            />
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      <SenderAvatar sender={email.sender} email={email.senderEmail || email.from} status={email.senderStatus} />

      <div className="email-list-pane__details">
        <div className="email-list-pane__sender-row">
          <div className="email-list-pane__sender-left">
            <span className="email-list-pane__sender">{email.sender}</span>
            {email.annoyanceReported && (
              <ShieldAlert
                size={14}
                className="email-list-pane__annoyance-icon"
                title="Reported as annoying"
              />
            )}
          </div>
          <div className="email-list-pane__sender-right">
            <span className="email-list-pane__timestamp">{email.timestamp}</span>
            {!email.isPending && (
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
            )}
          </div>
        </div>
        <div
          className={`email-list-pane__subject ${
            email.isPlaceholderSubject ? "email-list-pane__subject--placeholder" : ""
          }`}
        >
          {email.subject}
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
    </article>
  );
};

export default EmailListItem;
