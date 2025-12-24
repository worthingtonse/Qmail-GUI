import React, { useState, useEffect } from 'react';
import { RefreshCw, ArrowLeft, FileText, X, Download, Upload, ArrowRightLeft, Wallet, ArrowUpRight, Shield, Wrench, ClipboardList } from 'lucide-react';
import { getWalletTransactions, getWalletReceipt } from '../../../api/apiService.js';
import './ReceiptModal.css';

const TransactionsTab = ({ wallet, walletPath, onBack }) => {
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [transactionCount, setTransactionCount] = useState(0);
  
  // Receipt modal state
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptContent, setReceiptContent] = useState('');
  const [receiptFilename, setReceiptFilename] = useState('');
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState(null);

  // Load transactions when component mounts or wallet changes
  useEffect(() => {
    if (wallet) {
      loadTransactions();
    }
  }, [wallet]);

  const loadTransactions = async () => {
    if (!wallet) return;
    
    setIsLoading(true);
    setError(null);

    try {
    const limit = 50; 
    const result = await getWalletTransactions(limit, walletPath || wallet.path);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      setTransactions(result.data.transactions || []);
      setTransactionCount(result.data.count || 0);
      
    } catch (error) {
      console.error('Failed to load transactions:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadReceipt = async (receiptId, walletPath) => {
    if (!receiptId) {
      alert('No receipt ID available for this transaction');
      return;
    }

    setIsLoadingReceipt(true);
    setReceiptError(null);
    setShowReceiptModal(true);
    setReceiptFilename(receiptId);

    try {
      // Add .txt extension if not present
      const filename = receiptId.endsWith('.txt') ? receiptId : `${receiptId}.txt`;
      
      const result = await getWalletReceipt(filename, walletPath);
      
      if (!result.success) {
        throw new Error(result.error);
      }

      setReceiptContent(result.data.content);
      
    } catch (error) {
      console.error('Failed to load receipt:', error);
      setReceiptError(error.message);
    } finally {
      setIsLoadingReceipt(false);
    }
  };

  const closeReceiptModal = () => {
    setShowReceiptModal(false);
    setReceiptContent('');
    setReceiptFilename('');
    setReceiptError(null);
  };

  const formatDateTime = (datetime) => {
    if (!datetime) return { date: '-', time: '-' };
    
    // Parse datetime format: "11/19/2025, 05:06 PM"
    const parts = datetime.split(',');
    if (parts.length >= 2) {
      const datePart = parts[0]?.trim() || '-';
      const timePart = parts[1]?.trim() || '-';
      return { date: datePart, time: timePart };
    }
    
    // Fallback if format is different
    return { date: datetime, time: '-' };
  };

  const formatAmount = (deposit, withdraw) => {
    const depositAmount = deposit && deposit !== '' ? parseFloat(deposit) : 0;
    const withdrawAmount = withdraw && withdraw !== '' ? parseFloat(withdraw) : 0;
    
    if (depositAmount > 0) {
      return { 
        value: `+${depositAmount.toLocaleString()}`, 
        className: 'positive',
        amount: depositAmount
      };
    } else if (withdrawAmount > 0) {
      return { 
        value: `-${withdrawAmount.toLocaleString()}`, 
        className: 'negative',
        amount: -withdrawAmount
      };
    }
    return { value: '0', className: 'neutral', amount: 0 };
  };

  const getTransactionTypeDisplay = (type, symbol) => {
    // Map transaction types to appropriate displays with lucide-react icons
    const typeMap = {
      'Import': { icon: <Download size={14} />, label: 'Import' },
      'Export': { icon: <Upload size={14} />, label: 'Export' },
      'Transfer': { icon: <ArrowRightLeft size={14} />, label: 'Transfer' },
      'Deposit': { icon: <Wallet size={14} />, label: 'Deposit' },
      'Withdraw': { icon: <ArrowUpRight size={14} />, label: 'Withdraw' },
      'Authenticate': { icon: <Shield size={14} />, label: 'Auth' },
      'Fix': { icon: <Wrench size={14} />, label: 'Fix' }
    };

    const typeInfo = typeMap[type] || { 
      icon: symbol ? <span className="symbol-icon">{symbol}</span> : <ArrowRightLeft size={14} />, 
      label: type || 'Unknown' 
    };
    
    return typeInfo;
  };

  const formatTaskId = (taskId) => {
    if (!taskId) return '-';
    
    // Extract readable part from task ID like "Nov-19-25_05-06-04-PM-64ba"
    const parts = taskId.split('_');
    if (parts.length > 1) {
      // Return date part + first few chars of hash
      const datePart = parts[0];
      const hashPart = parts[parts.length - 1].substring(0, 4);
      return `${datePart}-${hashPart}`;
    }
    
    return taskId.length > 12 ? taskId.substring(0, 12) + '...' : taskId;
  };

  const getStatusColor = (remarks) => {
    if (!remarks) return 'neutral';
    
    const status = remarks.toLowerCase();
    if (status.includes('success')) return 'success';
    if (status.includes('error') || status.includes('fail')) return 'error';
    if (status.includes('pending') || status.includes('processing')) return 'warning';
    
    return 'neutral';
  };

  if (!wallet) {
    return null;
  }

  return (
    <div className="tab-content transactions-tab">
      <div className="transactions-header-container">
        <div className="back-section">
          <button 
            className="back-btn"
            onClick={onBack}
            title="Back to wallet list"
          >
            <ArrowLeft size={18} />
            Back to Wallets
          </button>
        </div>

        <div className="transactions-header">
          <div className="header-info">
            <h3>Transactions - {wallet.name}</h3>
            <p className="wallet-info">
              <strong>Balance: {wallet.balance.toLocaleString()} CC</strong>
              {transactionCount > 0 && (
                <span> • {transactionCount} transaction{transactionCount !== 1 ? 's' : ''}</span>
              )}
            </p>
            {wallet.path && (
              <p className="wallet-path">{wallet.path}</p>
            )}
          </div>
          <button 
            className="refresh-btn"
            onClick={loadTransactions}
            disabled={isLoading}
            title="Refresh transactions"
          >
            <RefreshCw size={18} className={isLoading ? 'spinning' : ''} />
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="transactions-content-container">
        {/* Error State */}
        {error && (
          <div className="transactions-error">
            <h5>Error loading transactions</h5>
            <pre>{error}</pre>
            <button className="retry-btn" onClick={loadTransactions}>
              Try Again
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && !error && transactions.length === 0 && (
          <div className="transactions-loading">
            <div className="loading-spinner"></div>
            <p>Loading transactions...</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && transactions.length === 0 && (
          <div className="transactions-empty">
            <ClipboardList size={48} className="empty-icon" />
            <h4>No Transactions Yet</h4>
            <p>Transaction history for <strong>{wallet.name}</strong> will appear here.</p>
          </div>
        )}

        {/* Transactions Table */}
        {!error && transactions.length > 0 && (
          <div className="transactions-table-container">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Type</th>
                  <th>Task ID</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction, index) => {
                  const { date, time } = formatDateTime(transaction.datetime);
                  const amount = formatAmount(transaction.deposit, transaction.withdraw);
                  const typeInfo = getTransactionTypeDisplay(transaction.type, transaction.symbol);
                  const balance = transaction.balance && transaction.balance !== '' 
                    ? parseFloat(transaction.balance).toLocaleString() 
                    : '0';
                  const statusColor = getStatusColor(transaction.remarks);
                  
                  return (
                    <tr key={index} className="transaction-row">
                      <td className="date-time">
                        <div className="date">{date}</div>
                        <div className="time">{time}</div>
                      </td>
                      <td className="type-cell">
                        <div className="type-badge">
                          <span className="type-icon">{typeInfo.icon}</span>
                          <span className="type-text">{typeInfo.label}</span>
                        </div>
                      </td>
                      <td className="task-id-cell">
                        <code className="task-id">{formatTaskId(transaction.task_id)}</code>
                      </td>
                      <td className="description-cell">
                        {transaction.description || '-'}
                      </td>
                      <td className={`amount-cell ${amount.className}`}>
                        {amount.value}
                      </td>
                      <td className="balance-cell">
                        {balance}
                      </td>
                      <td className="status-cell">
                        <span className={`status-badge ${statusColor}`}>
                          {transaction.remarks || 'Unknown'}
                        </span>
                      </td>
                      <td className="receipt-cell">
                        {transaction.task_id ? (
                          <button 
                            className="receipt-btn"
                            onClick={() => loadReceipt(transaction.task_id, wallet.path)}
                            title={`View receipt: ${transaction.task_id}`}
                          >
                            <FileText size={14} />
                            View
                          </button>
                        ) : (
                          <span className="no-receipt">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Transaction Count Footer */}
        {!error && transactions.length > 0 && (
          <div className="transactions-footer">
            <p>Showing {transactions.length} of {transactionCount} transaction{transactionCount !== 1 ? 's' : ''}</p>
            {transactions.length < transactionCount && (
              <button className="load-more-btn" onClick={() => loadTransactions(100)}>
                Load More
              </button>
            )}
          </div>
        )}
      </div>

      {/* Receipt Modal */}
      {showReceiptModal && (
        <div className="receipt-modal-overlay" onClick={closeReceiptModal}>
          <div className="receipt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-modal-header">
              <h3>Transaction Receipt</h3>
              <button 
                className="close-modal-btn" 
                onClick={closeReceiptModal}
                title="Close receipt"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="receipt-modal-body">
              {receiptFilename && (
                <div className="receipt-filename">
                  <strong>Receipt ID:</strong> {receiptFilename}
                </div>
              )}
              
              {isLoadingReceipt ? (
                <div className="receipt-loading">
                  <div className="loading-spinner"></div>
                  <p>Loading receipt...</p>
                </div>
              ) : receiptError ? (
                <div className="receipt-error">
                  <h4>Error loading receipt</h4>
                  <p>{receiptError}</p>
                </div>
              ) : receiptContent ? (
                <div className="receipt-content">
                  <pre>{receiptContent}</pre>
                </div>
              ) : (
                <div className="receipt-empty">
                  <p>No receipt content available</p>
                </div>
              )}
            </div>
            
            <div className="receipt-modal-footer">
              <button className="close-receipt-btn" onClick={closeReceiptModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionsTab;