/**
 * Pure coin-encryption helpers extracted from CoinEncryptionModal so the
 * count aggregation, password/proceed gates, wallet dedupe, and completion
 * summary can be unit-tested without a React render environment.
 */

/**
 * Pull task count fields from any of the three nesting shapes the core may
 * return, coercing non-numeric values to 0 and mapping snake_case extras.
 *
 * @param {object|null|undefined} taskResult
 * @returns {{
 *   processed: number,
 *   encrypted: number,
 *   decrypted: number,
 *   skipped: number,
 *   errors: number,
 *   alreadyTarget: number,
 *   skippedMulti: number,
 *   conflict: number,
 * }|null}
 */
export const getEncryptionCounts = (taskResult) => {
  const counts =
    taskResult?.data?.result?.counts ||
    taskResult?.data?.result?.data?.counts ||
    taskResult?.data?.counts ||
    null;

  if (!counts || typeof counts !== "object") return null;
  return {
    processed: Number(counts.processed) || 0,
    encrypted: Number(counts.encrypted) || 0,
    decrypted: Number(counts.decrypted) || 0,
    skipped: Number(counts.skipped) || 0,
    errors: Number(counts.errors) || 0,
    alreadyTarget: Number(counts.already_target) || 0,
    skippedMulti: Number(counts.skipped_multi) || 0,
    conflict: Number(counts.conflict) || 0,
  };
};

/**
 * @returns {{
 *   processed: number,
 *   encrypted: number,
 *   decrypted: number,
 *   skipped: number,
 *   errors: number,
 *   alreadyTarget: number,
 *   skippedMulti: number,
 *   conflict: number,
 * }}
 */
export const emptyAggregateCounts = () => ({
  processed: 0,
  encrypted: 0,
  decrypted: 0,
  skipped: 0,
  errors: 0,
  alreadyTarget: 0,
  skippedMulti: 0,
  conflict: 0,
});

/**
 * @param {ReturnType<typeof emptyAggregateCounts>} aggregate
 * @param {ReturnType<typeof getEncryptionCounts>} counts
 * @returns {ReturnType<typeof emptyAggregateCounts>}
 */
export const addCounts = (aggregate, counts) => {
  if (!counts) return aggregate;
  return {
    processed: aggregate.processed + counts.processed,
    encrypted: aggregate.encrypted + counts.encrypted,
    decrypted: aggregate.decrypted + counts.decrypted,
    skipped: aggregate.skipped + counts.skipped,
    errors: aggregate.errors + counts.errors,
    alreadyTarget: aggregate.alreadyTarget + counts.alreadyTarget,
    skippedMulti: aggregate.skippedMulti + counts.skippedMulti,
    conflict: aggregate.conflict + counts.conflict,
  };
};

/**
 * Whether the modal must collect a password for the given action/key state.
 * Decrypt and unlock require a password for establishing_ready; encrypt does
 * not (first-time encryption may establish the key without a prior load).
 *
 * @param {"encrypt"|"decrypt"|"unlock"} action
 * @param {string} keyState
 * @returns {boolean}
 */
export const needsPasswordForAction = (action, keyState) => {
  if (keyState === "confirmed") return false;
  if (action === "encrypt" && keyState === "establishing_ready") return false;
  return true;
};

/**
 * Whether a successful load-password response is strong enough to continue.
 * Candidate is never sufficient; establishing_ready is only enough for encrypt.
 *
 * @param {"encrypt"|"decrypt"|"unlock"} action
 * @param {string} loadedKeyState
 * @returns {boolean}
 */
export const canProceedAfterLogin = (action, loadedKeyState) => {
  return (
    loadedKeyState === "confirmed" ||
    (action === "encrypt" && loadedKeyState === "establishing_ready")
  );
};

/**
 * Deduplicate wallet entries by path (trimmed + lowercased for Windows
 * case-insensitivity). Keeps the first occurrence and preserves order.
 * Entries with empty/absent path all normalize to "" so only the first
 * such entry is kept.
 *
 * @param {Array<{name?: string|null, path?: string|null}>} rawWallets
 * @returns {Array<{name?: string|null, path?: string|null}>}
 */
export const dedupeWallets = (rawWallets) => {
  const seenPaths = new Set();
  const wallets = [];
  for (const wallet of rawWallets) {
    const normalizedPath = String(wallet.path || "")
      .trim()
      .toLowerCase();
    if (seenPaths.has(normalizedPath)) continue;
    seenPaths.add(normalizedPath);
    wallets.push(wallet);
  }
  return wallets;
};

/**
 * Build the completion summary fragment used by the modal success/error text.
 * Format: "<changed> encrypted|decrypted, <skipped> skipped, <errors> errors"
 * plus optional ", N already done" / ", N conflicts" and a trailing period.
 *
 * @param {boolean} isEncrypting
 * @param {ReturnType<typeof emptyAggregateCounts>} aggregateCounts
 * @returns {string}
 */
export const buildCompletionSummary = (isEncrypting, aggregateCounts) => {
  const changedCount = isEncrypting
    ? aggregateCounts.encrypted
    : aggregateCounts.decrypted;
  let summary =
    `${changedCount.toLocaleString()} ${isEncrypting ? "encrypted" : "decrypted"}, ` +
    `${aggregateCounts.skipped.toLocaleString()} skipped, ` +
    `${aggregateCounts.errors.toLocaleString()} errors`;
  if (aggregateCounts.alreadyTarget > 0) {
    summary += `, ${aggregateCounts.alreadyTarget.toLocaleString()} already done`;
  }
  if (aggregateCounts.conflict > 0) {
    summary += `, ${aggregateCounts.conflict.toLocaleString()} conflicts`;
  }
  summary += ".";
  return summary;
};
