/* eslint-disable react/prop-types */
import { useState } from "react";
import { Search, Mail, RefreshCw, Trash2, AlertTriangle, Loader2, Copy, Check } from "lucide-react";
import EmailListItem from "./EmailListItem";
import "./EmailListPane.css";

const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "unread", label: "Unread" },
  { key: "fee", label: "Income" },
  { key: "starred", label: "Starred" },
];

const EmailListPane = ({
  emails,
  onSelectEmail,
  selectedEmail,
  onSearch,
  isLoading,
  currentFolder,
  currentPage,
  totalCount,
  onPageChange,
  onMarkAsRead,
  onDeleteEmail,
  onDeleteVisibleTrash,
  onRowAction,
  onToggleStar,
  sortMode = "newest",
  onSortChange,
  loadingDraftId = null,
  searchResultCapHit = false,
  pageSize = 50,
  qmailAddress = "",
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showTrashConfirm, setShowTrashConfirm] = useState(false);
  const [isDeletingTrashPage, setIsDeletingTrashPage] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const visibleTrashMessages =
    currentFolder === "trash" ? emails.filter((email) => !email.isPending) : [];
  const visibleTrashCount = visibleTrashMessages.length;
  const showQmailAddress = currentFolder === "inbox" && qmailAddress.trim();
  const deleteTrashButtonLabel =
    visibleTrashCount === 1
      ? "Delete this message permanently"
      : `Delete these ${visibleTrashCount} messages permanently`;

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    onSearch(value);
  };

  const handleCopyAddress = async () => {
    const address = qmailAddress.trim();
    if (!address) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        // Fallback for environments without the async clipboard API.
        const textarea = document.createElement("textarea");
        textarea.value = address;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy QMail address:", error);
    }
  };

  const handleConfirmDeleteVisibleTrash = async () => {
    setIsDeletingTrashPage(true);
    try {
      await onDeleteVisibleTrash(visibleTrashMessages);
      setShowTrashConfirm(false);
    } finally {
      setIsDeletingTrashPage(false);
    }
  };

  const getFolderTitle = (folder) => {
    switch (folder) {
      case "inbox":
        return "Inbox";
      case "sent":
        return "Sent Messages";
      case "drafts":
        return "Draft Messages";
      case "trash":
        return "Trash";
      default:
        return folder.charAt(0).toUpperCase() + folder.slice(1);
    }
  };

  return (
    <section className="email-list-pane">
      <div className="email-list-pane__search-container" role="search">
        <div className="email-list-pane__search">
          <Search size={18} className="email-list-pane__search-icon" />
          <input
            type="text"
            placeholder="Search all mail..."
            value={searchQuery}
            onChange={handleSearch}
            className="email-list-pane__search-input"
          />
        </div>
      </div>

      <header className="email-list-pane__header">
        <div className="email-list-pane__header-top">
          <div className="email-list-pane__title-group">
            <h3 className="email-list-pane__title">{getFolderTitle(currentFolder)}</h3>
            {showQmailAddress && (
              <span className="email-list-pane__qmail-address" title={qmailAddress}>
                {qmailAddress}
              </span>
            )}
            {showQmailAddress && (
              <button
                type="button"
                className="email-list-pane__copy-address"
                onClick={handleCopyAddress}
                title={addressCopied ? "Copied!" : "Copy address"}
                aria-label={addressCopied ? "Address copied" : "Copy QMail address"}
              >
                {addressCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
          </div>
          <span className="email-list-pane__count">
            {emails.length} {emails.length === 1 ? "message" : "messages"}
          </span>
        </div>
        {onSortChange && (
          <div className="email-list-pane__sort-bar" role="toolbar" aria-label="Sort messages">
            <span className="email-list-pane__sort-label">Sort:</span>
            {SORT_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.key}
                className={`email-list-pane__sort-button ${
                  sortMode === opt.key ? "email-list-pane__sort-button--active" : ""
                }`}
                onClick={() => onSortChange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {currentFolder === "trash" &&
          visibleTrashCount > 0 &&
          onDeleteVisibleTrash && (
            <div className="email-list-pane__trash-action-bar">
              <span className="email-list-pane__trash-action-copy">
                Deletes only the messages shown on this page.
              </span>
              <button
                type="button"
                className="btn btn--danger email-list-pane__trash-delete-button"
                onClick={() => setShowTrashConfirm(true)}
              >
                <Trash2 size={14} />
                {deleteTrashButtonLabel}
              </button>
            </div>
          )}
      </header>

      {searchQuery.trim() && searchResultCapHit && !isLoading && (
        <div className="email-list-pane__search-cap-notice" role="status">
          Showing top 50 results. Refine your search to see more.
        </div>
      )}

      <div className="email-list-pane__list">
        {isLoading ? (
          <div className="email-list-pane__loading-state">
            <RefreshCw size={24} className="spinning" />
            <p>Loading {getFolderTitle(currentFolder).toLowerCase()}...</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="email-list-pane__empty-state">
            <Mail size={48} />
            <h3>No qmails found</h3>
            <p>
              {searchQuery
                ? `No qmails matching "${searchQuery}" in ${getFolderTitle(currentFolder).toLowerCase()}`
                : `Your ${getFolderTitle(currentFolder).toLowerCase()} is empty`}
            </p>
          </div>
        ) : (
          emails.map((email) => (
            <EmailListItem
              key={email.id}
              email={email}
              onSelect={onSelectEmail}
              isSelected={
                selectedEmail &&
                String(selectedEmail.id).toLowerCase() ===
                  String(email.id).toLowerCase()
              }
              onMarkAsRead={onMarkAsRead}
              onDeleteEmail={onDeleteEmail}
              onRowAction={onRowAction}
              onToggleStar={onToggleStar}
              isLoadingDraft={loadingDraftId === email.id}
              currentFolder={currentFolder}
            />
          ))
        )}

        {totalCount > pageSize && (
          <div className="email-list-pane__pagination">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={currentPage === 0}
              onClick={() => onPageChange(currentPage - 1)}
            >
              Previous
            </button>
            <span className="email-list-pane__page-info">
              Page {currentPage + 1} of {Math.ceil(totalCount / pageSize)}
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={(currentPage + 1) * pageSize >= totalCount}
              onClick={() => onPageChange(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {showTrashConfirm && (
        <div
          className="email-list-pane__trash-confirm-overlay"
          role="presentation"
          onClick={() => !isDeletingTrashPage && setShowTrashConfirm(false)}
        >
          <section
            className="email-list-pane__trash-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-trash-page-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="email-list-pane__trash-confirm-header">
              <AlertTriangle size={22} />
              <h3
                id="delete-trash-page-title"
                className="email-list-pane__trash-confirm-title"
              >
                Delete these messages permanently?
              </h3>
            </header>
            <p className="email-list-pane__trash-confirm-copy">
              This will permanently delete the {visibleTrashCount} message
              {visibleTrashCount === 1 ? "" : "s"} currently
              shown in Trash.
            </p>
            {totalCount > visibleTrashCount && (
              <p className="email-list-pane__trash-confirm-note">
                {totalCount - visibleTrashCount} more message
                {totalCount - visibleTrashCount === 1 ? "" : "s"}{" "}
                will remain in Trash after this page is deleted.
              </p>
            )}
            <footer className="email-list-pane__trash-confirm-actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={isDeletingTrashPage}
                onClick={() => setShowTrashConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={isDeletingTrashPage}
                onClick={handleConfirmDeleteVisibleTrash}
              >
                {isDeletingTrashPage ? (
                  <>
                    <Loader2 size={16} className="spinning" />
                    Deleting...
                  </>
                ) : (
                  "Delete Permanently"
                )}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
};

export default EmailListPane;