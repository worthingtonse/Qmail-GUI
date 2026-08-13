// Shared helpers for reading deposit task results and receipts. Used by the
// Add Funds flow (WalletActionModal) and the legacy-client coin import
// (LegacyImportModal), so both surface identical totals and warnings.

export const getTaskProgressLabel = (task, verb = "Depositing") => {
  const progress = Number(task?.progress ?? task?.percent ?? task?.percentage);
  if (Number.isFinite(progress) && progress >= 0) {
    return `${verb}... ${Math.min(100, Math.round(progress))}%`;
  }
  return task?.message || task?.status || `${verb}...`;
};

// The deposit receipt's `totals` may sit on result.data directly, under
// result.data.result (the finished task payload), or under a nested receipt
// object. Pull whichever is present so we can surface deposit warnings.
export const getTotalsFromResult = (result) => {
  const data = result?.data || {};
  const nested = data.result || {};
  const receipt = data.receipt || nested.receipt || {};
  return data.totals || nested.totals || receipt.totals || {};
};

export const countFromTotals = (totals, keys) =>
  keys.reduce((acc, key) => {
    const n = Number(totals?.[key]);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);

// A deposit "added nothing" when no authentic coins landed in the wallet.
// We trust total_deposited when present, otherwise fall back to the authentic
// (bank + fracked) counts so a receipt without that field still reads right.
export const depositAddedNothing = (totals) => {
  if (totals && Object.prototype.hasOwnProperty.call(totals, "total_deposited")) {
    const deposited = Number(totals.total_deposited);
    if (Number.isFinite(deposited)) return deposited <= 0;
  }
  return countFromTotals(totals, ["bank_count", "fracked_count"]) <= 0;
};

// Deposit MOVES the files it imports — core's deposit_phase_move relocates
// them into <wallet>/Import before the RAIDA is even asked whether they are
// authentic. That is deliberate (a coin must never exist in two places at
// once), but it means importing from another program's folder takes the
// coins OUT of that program. Users have reported this as coins "disappearing"
// from CloudCoin Desktop, so say it plainly before the deposit runs.
//
// Returns "" when nothing external is selected, so callers can render the
// warning conditionally without their own emptiness check.
export const getImportMoveWarning = (method, selection) => {
  if (method === "locker") return "";

  if (method === "files") {
    const files = Array.isArray(selection) ? selection : [];
    const external = files.filter((file) => file?.external);
    if (external.length === 0) return "";
    const noun = external.length === 1 ? "file" : "files";
    return `${external.length.toLocaleString()} selected ${noun} will be MOVED into QMail, not copied. ` +
      `They will no longer be in their current location — if another wallet program uses them, they will leave it.`;
  }

  if (method === "folder") {
    if (!selection?.external) return "";
    return `Coins in "${selection.name || selection.path}" will be MOVED into QMail, not copied. ` +
      `They will no longer be in that folder — if another wallet program uses it, they will leave it.`;
  }

  return "";
};

// Where the files actually went, for a deposit that banked nothing.
//
// The source files are never destroyed: unpack moves each one to
// <wallet>/Imported for an audit trail, and rejected notes land in
// <wallet>/Counterfeit. Neither location is surfaced anywhere in the UI, so
// a user whose import failed has no way to know their coins still exist.
// This is the recovery path — name it.
export const getImportedFilesNotice = (totals, walletName = "Default") => {
  const counterfeit = countFromTotals(totals, ["counterfeit_count", "legacy_counterfeit_count"]);
  const base =
    `Your original files were moved into ${walletName}\\Imported and are still there.`;
  if (counterfeit > 0) {
    return `${base} The notes the RAIDA rejected are in ${walletName}\\Counterfeit.`;
  }
  return base;
};

// Build human-readable warnings for a completed deposit. Each condition is
// independent, so more than one may apply and they stack.
export const getDepositWarnings = (totals) => {
  const warnings = [];

  const counterfeit = countFromTotals(totals, ["counterfeit_count", "legacy_counterfeit_count"]);
  if (counterfeit > 0) {
    warnings.push(
      `${counterfeit.toLocaleString()} ${counterfeit === 1 ? "note was" : "notes were"} counterfeit`,
    );
  }

  if (countFromTotals(totals, ["limbo_count"]) > 0) {
    warnings.push("The deposit was interrupted. The program will try to recover later");
  }

  if (countFromTotals(totals, ["duplicate_count"]) > 0) {
    warnings.push("Some of the coins that were imported were already in the bank");
  }

  if (countFromTotals(totals, ["error_count"]) > 0) {
    warnings.push("Some RAIDA servers returned errors");
  }

  return warnings;
};
