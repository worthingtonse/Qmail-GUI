import React, { useState } from "react";
import { Search, Mail, RefreshCw } from "lucide-react";
import EmailListItem from "./EmailListItem";
import "./EmailListPane.css";

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
  onDeleteEmail 
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
              onMarkAsRead={onMarkAsRead}      
              onDeleteEmail={onDeleteEmail} 
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