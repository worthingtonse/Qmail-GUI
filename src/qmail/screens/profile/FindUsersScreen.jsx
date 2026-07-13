/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Shield,
  ShieldOff,
} from "lucide-react";
import {
  getDrdLocalStatus,
  getTaskStatus,
  kickDrdLocalSync,
  searchDrdLocal,
  setDrdListEntries,
} from "../../../api/qmailApiServices";
import { denominationCodeToName } from "../../address/qmailAddress";
import { getQmailAvatarAssetHref, getQmailAvatarTierName } from "../../avatar/qmailAvatar";
import { addressDerivedSymbols } from "../../avatar/drdSymbols";
import QmailCartoucheAvatar from "../QmailCartoucheAvatar";

const PAGE_SIZE = 50;
const SYMBOL_COUNT = 256;
const SYNC_POLL_MS = 1500;
const SYNC_MAX_MS = 120000;

const CLASS_FILTER_OPTIONS = [
  { value: "", label: "Any" },
  { value: "0", label: "bit" },
  { value: "1", label: "byte" },
  { value: "2", label: "kilo" },
  { value: "3", label: "mega" },
  { value: "4", label: "giga" },
  { value: "5", label: "epic" },
];

const DATE_RANGE_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "created_at", label: "Newest members" },
  { value: "updated_at", label: "Recently updated" },
  { value: "fee", label: "Fee" },
  { value: "class", label: "Class" },
];

const EMPTY_FILTERS = {
  firstName: "",
  lastName: "",
  classExact: "",
  description: "",
  symbols: [],
  dateAdded: "any",
  dateUpdated: "any",
  includeDeleted: false,
  sort: "name",
  order: "asc",
};

/**
 * Apply the DRD (0,0)→null convention for cartouche rendering.
 * A single 0 paired with a nonzero is a real choice and renders.
 */
function symbolsForCartouche(firstSymbol, secondSymbol) {
  if (firstSymbol == null || secondSymbol == null) return null;
  const f = Number(firstSymbol);
  const s = Number(secondSymbol);
  if (!Number.isInteger(f) || !Number.isInteger(s)) return null;
  if (f < 0 || f > 255 || s < 0 || s > 255) return null;
  if (f === 0 && s === 0) return null;
  return { firstSymbol: f, secondSymbol: s };
}

function initialFromUser(user) {
  const first = String(user?.firstName || "").trim();
  const last = String(user?.lastName || "").trim();
  if (first) return first.charAt(0).toUpperCase();
  if (last) return last.charAt(0).toUpperCase();
  const addr = String(user?.address || "");
  if (addr) return addr.charAt(0).toUpperCase();
  return "?";
}

function displayName(user) {
  const first = String(user?.firstName || "").trim();
  const last = String(user?.lastName || "").trim();
  const full = [first, last].filter(Boolean).join(" ");
  return full || "—";
}

function displayAddress(user) {
  if (user?.address) return user.address;
  const den = user?.denomination;
  const sn = user?.serialNumber;
  if (den != null && sn != null) return `${den}:${sn}`;
  return "—";
}

function classWord(denomination) {
  const name = denominationCodeToName(Number(denomination));
  return name || (denomination == null ? "—" : String(denomination));
}

/** Humanize account_age_seconds for the anti-scam "Member for" column. */
function humanizeMemberFor(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return "—";
  const years = Math.floor(s / (365.25 * 24 * 3600));
  if (years >= 1) return years === 1 ? "1 year" : `${years} years`;
  const months = Math.floor(s / (30 * 24 * 3600));
  if (months >= 1) return months === 1 ? "1 month" : `${months} months`;
  const days = Math.floor(s / (24 * 3600));
  if (days >= 1) return days === 1 ? "1 day" : `${days} days`;
  const hours = Math.floor(s / 3600);
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;
  if (s >= 60) {
    const mins = Math.floor(s / 60);
    return mins === 1 ? "1 minute" : `${mins} minutes`;
  }
  return "just now";
}

/** Relative time from a unix-seconds timestamp (or "never" when 0/absent). */
function humanizeUnixAgo(unixSeconds) {
  const t = Number(unixSeconds);
  if (!Number.isFinite(t) || t <= 0) return "never";
  const ago = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(t));
  if (ago < 60) return "just now";
  if (ago < 3600) {
    const m = Math.floor(ago / 60);
    return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  }
  if (ago < 86400) {
    const h = Math.floor(ago / 3600);
    return h === 1 ? "1 hour ago" : `${h} hours ago`;
  }
  if (ago < 86400 * 30) {
    const d = Math.floor(ago / 86400);
    return d === 1 ? "1 day ago" : `${d} days ago`;
  }
  if (ago < 86400 * 365) {
    const mo = Math.floor(ago / (30 * 86400));
    return mo === 1 ? "1 month ago" : `${mo} months ago`;
  }
  const y = Math.floor(ago / (365.25 * 86400));
  return y === 1 ? "1 year ago" : `${y} years ago`;
}

function dateRangeToAfterUnix(rangeKey) {
  const nowMs = Date.now();
  if (rangeKey === "24h") return Math.floor((nowMs - 24 * 3600 * 1000) / 1000);
  if (rangeKey === "7d") return Math.floor((nowMs - 7 * 24 * 3600 * 1000) / 1000);
  if (rangeKey === "30d") return Math.floor((nowMs - 30 * 24 * 3600 * 1000) / 1000);
  return null;
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
}

function isReplicaUninitialized(result) {
  if (!result) return false;
  if (result.httpStatus === 503) return true;
  const msg = String(result.error || "");
  return /not initialized|replica not initialized/i.test(msg);
}

function rowKey(user) {
  return `${user?.denomination ?? "?"}:${user?.serialNumber ?? "?"}`;
}

/**
 * Local DRD directory search screen (Find Users).
 * Does not require a QMail identity coin — search is open.
 */
// qmailAddress is accepted for API symmetry with other profile screens;
// directory search itself does not require an identity coin.
const FindUsersScreen = ({ qmailAddress: _unusedQmailAddress }) => {
  void _unusedQmailAddress;
  const [draft, setDraft] = useState(() => ({ ...EMPTY_FILTERS }));
  const [moreOpen, setMoreOpen] = useState(false);

  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  // Snapshot of filters used for the current result set (stable for pager).
  const [activeFilters, setActiveFilters] = useState(null);

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [statusLoading, setStatusLoading] = useState(true);

  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");

  const [rowBusy, setRowBusy] = useState(null);
  const [rowToast, setRowToast] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);

  const mountedRef = useRef(true);
  const pollTimerRef = useRef(null);
  const toastTimersRef = useRef({});
  // Incremented to drop in-flight search results after unmount / newer search.
  const searchGenRef = useRef(0);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current != null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPollTimer();
      searchGenRef.current += 1;
      Object.values(toastTimersRef.current).forEach((id) => clearTimeout(id));
      toastTimersRef.current = {};
    };
  }, [clearPollTimer]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError("");
    try {
      const result = await getDrdLocalStatus();
      if (!mountedRef.current) return null;
      if (!result?.success) {
        if (isReplicaUninitialized(result)) {
          setStatus({
            recordCount: 0,
            tombstoneCount: 0,
            lastSyncAt: 0,
            syncRunning: false,
            shardCount: 0,
            shards: [],
          });
          setStatusError("");
          return {
            recordCount: 0,
            lastSyncAt: 0,
          };
        }
        setStatusError(result?.error || "Failed to load directory status.");
        return null;
      }
      setStatus(result.data);
      return result.data;
    } catch (err) {
      if (mountedRef.current) {
        setStatusError(err?.message || "Failed to load directory status.");
      }
      return null;
    } finally {
      if (mountedRef.current) setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const buildSearchFilters = useCallback((filterState, pageOffset) => {
    const payload = {
      limit: PAGE_SIZE,
      offset: pageOffset,
    };

    const first = String(filterState.firstName || "").trim();
    const last = String(filterState.lastName || "").trim();
    if (first) payload.firstName = first;
    if (last) payload.lastName = last;

    if (filterState.classExact !== "" && filterState.classExact != null) {
      payload.classExact = Number(filterState.classExact);
    }

    const desc = String(filterState.description || "").trim();
    if (desc) payload.description = desc;

    if (Array.isArray(filterState.symbols) && filterState.symbols.length > 0) {
      payload.symbols = filterState.symbols.slice(0, 2);
    }

    const createdAfter = dateRangeToAfterUnix(filterState.dateAdded);
    if (createdAfter != null) payload.createdAfter = createdAfter;

    const updatedAfter = dateRangeToAfterUnix(filterState.dateUpdated);
    if (updatedAfter != null) payload.updatedAfter = updatedAfter;

    if (filterState.includeDeleted) {
      payload.includeDeleted = true;
    }

    if (filterState.sort) payload.sort = filterState.sort;
    if (filterState.order) payload.order = filterState.order;

    return payload;
  }, []);

  const runSearch = useCallback(
    async (filterState, pageOffset = 0) => {
      const gen = ++searchGenRef.current;
      setSearching(true);
      setSearchError("");
      setHasSearched(true);
      setOffset(pageOffset);
      setActiveFilters(filterState);

      try {
        const payload = buildSearchFilters(filterState, pageOffset);
        const result = await searchDrdLocal(payload);
        if (!mountedRef.current || gen !== searchGenRef.current) return;

        if (!result?.success) {
          if (isReplicaUninitialized(result)) {
            setUsers([]);
            setTotal(0);
            setSearchError("");
            // Surface as empty directory, not a raw 503.
            return;
          }
          setUsers([]);
          setTotal(0);
          setSearchError(result?.error || "Search failed.");
          return;
        }

        setUsers(Array.isArray(result.data?.users) ? result.data.users : []);
        setTotal(Number(result.data?.total) || 0);
      } catch (err) {
        if (!mountedRef.current || gen !== searchGenRef.current) return;
        setUsers([]);
        setTotal(0);
        setSearchError(err?.message || "Search failed.");
      } finally {
        if (mountedRef.current && gen === searchGenRef.current) {
          setSearching(false);
        }
      }
    },
    [buildSearchFilters],
  );

  const handleSearchSubmit = (event) => {
    event?.preventDefault?.();
    runSearch(draft, 0);
  };

  const handlePage = (direction) => {
    if (!activeFilters || searching) return;
    const next =
      direction === "prev"
        ? Math.max(0, offset - PAGE_SIZE)
        : offset + PAGE_SIZE;
    if (next === offset) return;
    if (direction === "next" && next >= total) return;
    runSearch(activeFilters, next);
  };

  const pollSyncTask = useCallback(
    async (taskId) => {
      const started = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!mountedRef.current) return { stopped: true };

        if (Date.now() - started >= SYNC_MAX_MS) {
          return {
            timedOut: true,
            message: "Directory update is still running — check back shortly.",
          };
        }

        await new Promise((resolve) => {
          pollTimerRef.current = setTimeout(resolve, SYNC_POLL_MS);
        });
        pollTimerRef.current = null;
        if (!mountedRef.current) return { stopped: true };

        const result = await getTaskStatus(taskId);
        if (!mountedRef.current) return { stopped: true };

        if (!result?.success) {
          return {
            failed: true,
            message: result?.error || "Could not check update status.",
          };
        }

        const data = result.data || {};
        if (data.isFinished || data.isSuccessful) {
          if (data.isSuccessful) {
            return { success: true, message: data.message || "" };
          }
          return {
            failed: true,
            message:
              data.error ||
              data.message ||
              "Directory update did not complete.",
          };
        }
      }
    },
    [],
  );

  const handleSync = async ({ full = false } = {}) => {
    if (syncing) return;

    if (full) {
      const ok = window.confirm(
        "Full re-download will re-fetch the entire directory from RAIDA. Continue?",
      );
      if (!ok) return;
    }

    setSyncing(true);
    setSyncNote("");
    clearPollTimer();

    try {
      const kick = await kickDrdLocalSync({ full });
      if (!mountedRef.current) return;

      if (!kick?.success || !kick.data?.taskId) {
        setSyncNote(
          `Directory update did not complete: ${kick?.error || "No task id returned."}`,
        );
        return;
      }

      const outcome = await pollSyncTask(kick.data.taskId);
      if (!mountedRef.current || outcome?.stopped) return;

      if (outcome?.timedOut) {
        setSyncNote(outcome.message);
      } else if (outcome?.failed) {
        setSyncNote(
          `Directory update did not complete: ${outcome.message || "unknown error"}`,
        );
      } else {
        setSyncNote(
          full ? "Full re-download finished." : "Local directory updated.",
        );
      }

      await loadStatus();
      if (activeFilters && mountedRef.current) {
        await runSearch(activeFilters, offset);
      }
    } catch (err) {
      if (mountedRef.current) {
        setSyncNote(
          `Directory update did not complete: ${err?.message || "unknown error"}`,
        );
      }
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  };

  const showRowToast = (key, kind, message) => {
    setRowToast((prev) => ({ ...prev, [key]: { kind, message } }));
    if (toastTimersRef.current[key]) {
      clearTimeout(toastTimersRef.current[key]);
    }
    toastTimersRef.current[key] = setTimeout(() => {
      if (!mountedRef.current) return;
      setRowToast((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      delete toastTimersRef.current[key];
    }, 2500);
  };

  const handleCopyAddress = async (user) => {
    const address = displayAddress(user);
    if (!address || address === "—") return;
    const key = rowKey(user);
    const ok = await copyTextToClipboard(address);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => {
        if (mountedRef.current) setCopiedKey(null);
      }, 2000);
      showRowToast(key, "success", "Address copied");
    } else {
      showRowToast(key, "error", "Copy failed");
    }
  };

  const handleListAdd = async (user, listType) => {
    const key = rowKey(user);
    if (rowBusy === key) return;
    if (user?.denomination == null || user?.serialNumber == null) {
      showRowToast(key, "error", "Missing coin identity");
      return;
    }

    setRowBusy(key);
    try {
      const result = await setDrdListEntries([
        {
          denomination: user.denomination,
          serialNumber: user.serialNumber,
          listType,
        },
      ]);
      if (!mountedRef.current) return;
      if (!result?.success) {
        showRowToast(
          key,
          "error",
          result?.error || `Failed to add to ${listType} list`,
        );
        return;
      }
      showRowToast(
        key,
        "success",
        listType === "white" ? "Added to White List" : "Added to Black List",
      );
    } catch (err) {
      if (mountedRef.current) {
        showRowToast(key, "error", err?.message || "List update failed");
      }
    } finally {
      if (mountedRef.current) setRowBusy(null);
    }
  };

  const toggleSymbol = (index) => {
    setDraft((prev) => {
      const current = Array.isArray(prev.symbols) ? [...prev.symbols] : [];
      const at = current.indexOf(index);
      if (at >= 0) {
        current.splice(at, 1);
        return { ...prev, symbols: current };
      }
      if (current.length >= 2) {
        // Replace the second slot when already full.
        return { ...prev, symbols: [current[0], index] };
      }
      return { ...prev, symbols: [...current, index] };
    });
  };

  const clearSymbols = () => {
    setDraft((prev) => ({ ...prev, symbols: [] }));
  };

  const recordCount = status?.recordCount ?? 0;
  const lastSyncLabel = humanizeUnixAgo(status?.lastSyncAt);

  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = total === 0 ? 0 : Math.min(offset + users.length, total);
  const canPrev = offset > 0 && !searching;
  const canNext = offset + PAGE_SIZE < total && !searching;

  const symbolIndices = useMemo(
    () => Array.from({ length: SYMBOL_COUNT }, (_, i) => i),
    [],
  );

  const renderAvatar = (user) => {
    // Chosen DRD symbols win; a user without chosen symbols still gets a
    // cartouche via the address-derived defaults (serial high byte top,
    // low byte bottom). Letter avatar only for unusable addresses.
    const pair =
      symbolsForCartouche(user.firstSymbol, user.secondSymbol) ??
      addressDerivedSymbols(user.serialNumber);
    if (pair && getQmailAvatarTierName(user.denomination) !== null) {
      return (
        <QmailCartoucheAvatar
          firstSymbol={pair.firstSymbol}
          secondSymbol={pair.secondSymbol}
          denominationCode={user.denomination}
          serialNumber={user.serialNumber}
          className="qmail-profile-find__cartouche"
        />
      );
    }
    return (
      <div className="qmail-profile-find__letter-avatar" aria-hidden="true">
        <span>{initialFromUser(user)}</span>
      </div>
    );
  };

  const emptyDirectoryHint =
    !statusLoading && recordCount === 0
      ? " The local directory is empty — press Update local DRD."
      : "";

  return (
    <div className="qmail-profile-find">
      <form className="qmail-profile-find__filters" onSubmit={handleSearchSubmit}>
        <div className="qmail-profile-find__filters-primary">
          <label className="qmail-profile-form__field">
            <span className="qmail-profile-form__label">First name</span>
            <input
              type="text"
              className="qmail-profile-form__input"
              value={draft.firstName}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, firstName: e.target.value }))
              }
              placeholder="Prefix"
              autoComplete="off"
            />
          </label>
          <label className="qmail-profile-form__field">
            <span className="qmail-profile-form__label">Last name</span>
            <input
              type="text"
              className="qmail-profile-form__input"
              value={draft.lastName}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, lastName: e.target.value }))
              }
              placeholder="Prefix"
              autoComplete="off"
            />
          </label>
          <label className="qmail-profile-form__field">
            <span className="qmail-profile-form__label">Class</span>
            <select
              className="qmail-profile-form__input"
              value={draft.classExact}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, classExact: e.target.value }))
              }
            >
              {CLASS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || "any"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <div className="qmail-profile-find__search-actions">
            <button type="submit" className="btn btn--primary" disabled={searching}>
              {searching ? (
                <>
                  <Loader2 className="spinning" size={16} aria-hidden="true" />
                  Searching…
                </>
              ) : (
                "Search"
              )}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="qmail-profile-find__more-toggle"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          <ChevronDown
            size={16}
            className={
              moreOpen
                ? "qmail-profile-find__more-chevron qmail-profile-find__more-chevron--open"
                : "qmail-profile-find__more-chevron"
            }
            aria-hidden="true"
          />
          More filters
        </button>

        {moreOpen ? (
          <div className="qmail-profile-find__filters-more">
            <label className="qmail-profile-form__field qmail-profile-find__field-wide">
              <span className="qmail-profile-form__label">Description contains</span>
              <input
                type="text"
                className="qmail-profile-form__input"
                value={draft.description}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, description: e.target.value }))
                }
                autoComplete="off"
              />
            </label>

            <div className="qmail-profile-find__symbols">
              <div className="qmail-profile-find__symbols-header">
                <span className="qmail-profile-form__label">Symbols (up to 2)</span>
                {draft.symbols.length > 0 ? (
                  <button
                    type="button"
                    className="qmail-profile-find__link-btn"
                    onClick={clearSymbols}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <p className="qmail-profile-form__hint">
                Selected:{" "}
                {draft.symbols.length === 0
                  ? "none"
                  : draft.symbols.map((s) => `#${s}`).join(", ")}
              </p>
              <div
                className="qmail-profile-find__symbol-grid"
                role="listbox"
                aria-label="Symbol filter"
                aria-multiselectable="true"
              >
                {symbolIndices.map((index) => {
                  const selected = draft.symbols.includes(index);
                  return (
                    <button
                      key={index}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={
                        selected
                          ? "qmail-profile-find__symbol-cell qmail-profile-find__symbol-cell--selected"
                          : "qmail-profile-find__symbol-cell"
                      }
                      title={`Symbol ${index}`}
                      onClick={() => toggleSymbol(index)}
                    >
                      <img
                        src={getQmailAvatarAssetHref("symbol", index)}
                        alt=""
                        draggable={false}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="qmail-profile-find__filters-row">
              <label className="qmail-profile-form__field">
                <span className="qmail-profile-form__label">Date added</span>
                <select
                  className="qmail-profile-form__input"
                  value={draft.dateAdded}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, dateAdded: e.target.value }))
                  }
                >
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="qmail-profile-form__field">
                <span className="qmail-profile-form__label">Date updated</span>
                <select
                  className="qmail-profile-form__input"
                  value={draft.dateUpdated}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      dateUpdated: e.target.value,
                    }))
                  }
                >
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="qmail-profile-form__field">
                <span className="qmail-profile-form__label">Sort</span>
                <select
                  className="qmail-profile-form__input"
                  value={draft.sort}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, sort: e.target.value }))
                  }
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="qmail-profile-form__field">
                <span className="qmail-profile-form__label">Order</span>
                <select
                  className="qmail-profile-form__input"
                  value={draft.order}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, order: e.target.value }))
                  }
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            </div>

            <label className="qmail-profile-find__checkbox">
              <input
                type="checkbox"
                checked={draft.includeDeleted}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    includeDeleted: e.target.checked,
                  }))
                }
              />
              <span>Include deleted</span>
            </label>
          </div>
        ) : null}
      </form>

      <div className="qmail-profile-find__status-row">
        <div className="qmail-profile-find__status-text" role="status">
          {statusLoading ? (
            <span className="qmail-profile-find__muted">
              <Loader2 className="spinning" size={14} aria-hidden="true" />
              Loading directory status…
            </span>
          ) : statusError ? (
            <span className="qmail-profile-find__status-error">
              {statusError}{" "}
              <button
                type="button"
                className="qmail-profile-find__link-btn"
                onClick={loadStatus}
              >
                Retry
              </button>
            </span>
          ) : (
            <span>
              Directory:{" "}
              <strong>
                {recordCount.toLocaleString()} user
                {recordCount === 1 ? "" : "s"}
              </strong>
              {" · "}
              Last updated {lastSyncLabel}
            </span>
          )}
        </div>
        <div className="qmail-profile-find__status-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={syncing}
            onClick={() => handleSync({ full: false })}
          >
            {syncing ? (
              <>
                <Loader2 className="spinning" size={16} aria-hidden="true" />
                Updating…
              </>
            ) : (
              "Update local DRD"
            )}
          </button>
          <button
            type="button"
            className="qmail-profile-find__link-btn"
            disabled={syncing}
            onClick={() => handleSync({ full: true })}
          >
            Full re-download
          </button>
        </div>
      </div>

      {syncNote ? (
        <p className="qmail-profile-find__sync-note" role="status">
          {syncNote}
        </p>
      ) : null}

      <div className="qmail-profile-find__results">
        {!hasSearched && !searching ? (
          <div className="qmail-profile-modal__state qmail-profile-find__hint">
            <p>
              Search the directory, or update the local copy first.
              {emptyDirectoryHint}
            </p>
          </div>
        ) : null}

        {searching ? (
          <div className="qmail-profile-modal__state" role="status">
            <Loader2 className="spinning" size={22} aria-hidden="true" />
            <p>Searching…</p>
          </div>
        ) : null}

        {!searching && searchError ? (
          <div className="qmail-profile-modal__state" role="alert">
            <AlertCircle size={22} aria-hidden="true" />
            <h3>Search failed</h3>
            <p>{searchError}</p>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() =>
                runSearch(activeFilters || draft, activeFilters ? offset : 0)
              }
            >
              Retry
            </button>
          </div>
        ) : null}

        {!searching &&
        !searchError &&
        hasSearched &&
        users.length === 0 ? (
          <div className="qmail-profile-modal__state qmail-profile-find__hint">
            <p>
              No users match.
              {emptyDirectoryHint}
            </p>
          </div>
        ) : null}

        {!searching && !searchError && users.length > 0 ? (
          <>
            <div className="qmail-profile-find__table-wrap">
              <table className="qmail-profile-find__table">
                <thead>
                  <tr>
                    <th scope="col"> </th>
                    <th scope="col">Name</th>
                    <th scope="col">Address</th>
                    <th scope="col">Class</th>
                    <th scope="col">Member for</th>
                    <th scope="col">Inbox fee</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const key = rowKey(user);
                    const toast = rowToast[key];
                    const busy = rowBusy === key;
                    return (
                      <tr
                        key={key}
                        className={
                          user.deleted
                            ? "qmail-profile-find__row qmail-profile-find__row--deleted"
                            : "qmail-profile-find__row"
                        }
                      >
                        <td className="qmail-profile-find__td-avatar">
                          {renderAvatar(user)}
                        </td>
                        <td>{displayName(user)}</td>
                        <td className="qmail-profile-find__mono">
                          {displayAddress(user)}
                        </td>
                        <td>{classWord(user.denomination)}</td>
                        <td className="qmail-profile-find__member-for">
                          {humanizeMemberFor(user.accountAgeSeconds)}
                        </td>
                        <td className="qmail-profile-find__mono">
                          {user.inboxFee != null ? String(user.inboxFee) : "0"}
                        </td>
                        <td>{humanizeUnixAgo(user.updatedAt)}</td>
                        <td>
                          <div className="qmail-profile-find__row-actions">
                            <button
                              type="button"
                              className="qmail-profile-find__icon-btn"
                              title="Copy address"
                              aria-label="Copy address"
                              onClick={() => handleCopyAddress(user)}
                              disabled={busy}
                            >
                              {copiedKey === key ? (
                                <Check size={14} aria-hidden="true" />
                              ) : (
                                <Copy size={14} aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="qmail-profile-find__icon-btn"
                              title="Add to White List"
                              aria-label="Add to White List"
                              onClick={() => handleListAdd(user, "white")}
                              disabled={busy}
                            >
                              {busy ? (
                                <Loader2
                                  className="spinning"
                                  size={14}
                                  aria-hidden="true"
                                />
                              ) : (
                                <Shield size={14} aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="qmail-profile-find__icon-btn"
                              title="Add to Black List"
                              aria-label="Add to Black List"
                              onClick={() => handleListAdd(user, "black")}
                              disabled={busy}
                            >
                              <ShieldOff size={14} aria-hidden="true" />
                            </button>
                            {/* FUTURE: compose-prefill (open Compose with To=address) needs plumbing outside this modal */}
                          </div>
                          {toast ? (
                            <span
                              className={
                                toast.kind === "error"
                                  ? "qmail-profile-find__row-toast qmail-profile-find__row-toast--error"
                                  : "qmail-profile-find__row-toast qmail-profile-find__row-toast--success"
                              }
                              role="status"
                            >
                              {toast.message}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="qmail-profile-find__pager">
              <span className="qmail-profile-find__pager-label">
                Showing {showingFrom}–{showingTo} of {total.toLocaleString()}
              </span>
              <div className="qmail-profile-find__pager-btns">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={!canPrev}
                  onClick={() => handlePage("prev")}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  Prev
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={!canNext}
                  onClick={() => handlePage("next")}
                >
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default FindUsersScreen;
