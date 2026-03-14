import React, { useState } from "react";
import { Search, Mail, RefreshCw, Trash2 } from "lucide-react";
import EmailListItem from "./EmailListItem";
import "./EmailListPane.css";

const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "unread", label: "Unread" },
  { key: "fee", label: "Highest Paying" },
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
  onToggleStar,
  sortMode = "newest",
  onSortChange,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [checkedIds, setCheckedIds] = useState(new Set());

  const handleCheck = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTrashChecked = async () => {
    for (const id of checkedIds) {
      await onDeleteEmail(id, false);
    }
    setCheckedIds(new Set());
  };

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    onSearch(value);
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
      <div className="search-bar-container-el">
        <div className="search-bar-el">
          <Search size={18} className="search-icon-el" />
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
        <div className="email-list-header-top">
          <h3 className="email-list-title">{getFolderTitle(currentFolder)}</h3>
          <span className="email-count-total">
            {emails.length} {emails.length === 1 ? "message" : "messages"}
          </span>
        </div>
        {onSortChange && (
          <div className="sort-bar">
            <span className="sort-label">Sort:</span>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={`sort-btn ${sortMode === opt.key ? "sort-active" : ""}`}
                onClick={() => onSortChange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {currentFolder === "drafts" && checkedIds.size > 0 && (
        <div className="draft-trash-bar">
          <span>{checkedIds.size} selected</span>
          <button className="draft-trash-btn" onClick={handleTrashChecked}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

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
              onToggleStar={onToggleStar}
              isChecked={checkedIds.has(email.id)}
              onCheck={handleCheck}
            />
          ))
        )}

        {/* Pagination Controls */}
        {totalCount > 50 && (
          <div className="pagination-controls">
            <button
              className="secondary"
              disabled={currentPage === 0}
              onClick={() => onPageChange(currentPage - 1)}
            >
              Previous
            </button>
            <span className="page-info">
              Page {currentPage + 1} of {Math.ceil(totalCount / 50)}
            </span>
            <button
              className="secondary"
              disabled={(currentPage + 1) * 50 >= totalCount}
              onClick={() => onPageChange(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default EmailListPane;
