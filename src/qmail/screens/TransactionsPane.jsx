import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  FileText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { getWalletReceipt } from "../../api/apiService";
import "./TransactionsPane.css";

const formatNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return value || "—";
  return number.toLocaleString(undefined, { maximumFractionDigits: 8 });
};

const getAmount = (transaction) => {
  const deposit = Number(transaction.deposit) || 0;
  const withdraw = Number(transaction.withdraw) || 0;
  if (deposit > 0) return { text: `+${formatNumber(deposit)}`, tone: "positive" };
  if (withdraw > 0) return { text: `−${formatNumber(withdraw)}`, tone: "negative" };
  return { text: "0", tone: "neutral" };
};

const getTypeDisplay = (transaction) => {
  const type = String(transaction.type || "Transaction");
  const normalized = type.toLowerCase();
  if (/deposit|import|download|transfer in|join|upgrade/.test(normalized)) {
    return { label: type, Icon: ArrowDownLeft, tone: "in" };
  }
  if (/withdraw|export|upload|transfer out/.test(normalized)) {
    return { label: type, Icon: ArrowUpRight, tone: "out" };
  }
  return { label: type, Icon: ArrowRightLeft, tone: "other" };
};

const TransactionsPane = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await window.electronAPI?.getAllWalletTransactions?.();
      if (!result?.success) {
        throw new Error(result?.error || "Transaction history is unavailable.");
      }
      setTransactions(result.transactions || []);
      setWarnings(result.errors || []);
    } catch (loadError) {
      setError(loadError?.message || "Could not load transaction history.");
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const openReceipt = async (transaction) => {
    if (!transaction.receiptFilename) return;
    setReceipt({ transaction, content: null });
    setReceiptLoading(true);
    setReceiptError("");
    try {
      const result = await getWalletReceipt(
        transaction.receiptFilename,
        transaction.walletPath,
      );
      if (!result.success) throw new Error(result.error);
      setReceipt({ transaction, content: result.data.content });
    } catch (loadError) {
      setReceiptError(loadError?.message || "Could not load this receipt.");
    } finally {
      setReceiptLoading(false);
    }
  };

  const closeReceipt = () => {
    setReceipt(null);
    setReceiptError("");
  };

  return (
    <section className="transactions-pane" aria-labelledby="transactions-title">
      <header className="transactions-pane__header">
        <div>
          <h2 id="transactions-title">Transaction History</h2>
          <p>All transactions across your registered wallets.</p>
        </div>
        <button
          type="button"
          className="btn btn--secondary transactions-pane__refresh"
          onClick={loadTransactions}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "spinning" : ""} />
          Refresh
        </button>
      </header>

      {warnings.length > 0 && (
        <div className="transactions-pane__warning" role="status">
          Some wallet logs could not be read: {warnings.join("; ")}
        </div>
      )}

      {error ? (
        <div className="transactions-pane__state transactions-pane__state--error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn--secondary" onClick={loadTransactions}>
            Try Again
          </button>
        </div>
      ) : loading ? (
        <div className="transactions-pane__state" role="status">
          <RefreshCw size={28} className="spinning" />
          <p>Loading transactions…</p>
        </div>
      ) : transactions.length === 0 ? (
        <div className="transactions-pane__state">
          <FileText size={36} />
          <p>No transactions have been recorded yet.</p>
        </div>
      ) : (
        <div className="transactions-pane__table-scroll">
          <table className="transactions-pane__table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Wallet</th>
                <th>Type</th>
                <th>Description</th>
                <th className="transactions-pane__numeric">Amount</th>
                <th className="transactions-pane__numeric">Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const amount = getAmount(transaction);
                const typeDisplay = getTypeDisplay(transaction);
                return (
                  <tr key={transaction.id}>
                    <td className="transactions-pane__date-cell">
                      {transaction.receiptFilename ? (
                        <button
                          type="button"
                          className="transactions-pane__receipt-link"
                          onClick={() => openReceipt(transaction)}
                          title="View transaction receipt"
                          aria-label={`View receipt for ${transaction.datetime}`}
                        >
                          <span>{transaction.datetime || "Unknown date"}</span>
                          <Search size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <span>{transaction.datetime || "Unknown date"}</span>
                      )}
                    </td>
                    <td>{transaction.walletName || "Unknown"}</td>
                    <td>
                      <span className={`transactions-pane__type transactions-pane__type--${typeDisplay.tone}`}>
                        <typeDisplay.Icon size={15} aria-hidden="true" />
                        {typeDisplay.label}
                      </span>
                    </td>
                    <td className="transactions-pane__description">
                      {transaction.description || "—"}
                    </td>
                    <td className={`transactions-pane__numeric transactions-pane__amount--${amount.tone}`}>
                      {amount.text}
                    </td>
                    <td className="transactions-pane__numeric">
                      {formatNumber(transaction.balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {receipt && (
        <div className="transactions-pane__receipt-overlay" onClick={closeReceipt} role="presentation">
          <section
            className="transactions-pane__receipt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-receipt-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3 id="transaction-receipt-title">Transaction Receipt</h3>
                <p>{receipt.transaction.datetime} · {receipt.transaction.walletName}</p>
              </div>
              <button type="button" onClick={closeReceipt} aria-label="Close receipt">
                <X size={20} />
              </button>
            </header>
            <div className="transactions-pane__receipt-body">
              {receiptLoading ? (
                <div className="transactions-pane__state" role="status">
                  <RefreshCw size={24} className="spinning" />
                  <p>Loading receipt…</p>
                </div>
              ) : receiptError ? (
                <div className="transactions-pane__state transactions-pane__state--error" role="alert">
                  <p>{receiptError}</p>
                </div>
              ) : (
                <pre>{
                  typeof receipt.content === "string"
                    ? receipt.content
                    : JSON.stringify(receipt.content, null, 2)
                }</pre>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

export default TransactionsPane;
