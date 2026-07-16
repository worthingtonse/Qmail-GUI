/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import {
  getDrdLists,
  removeDrdListEntries,
  setDrdListEntries,
  qmailAddressToDrdCoin,
} from "../../../api/qmailApiServices";
import { formatQmailAddress } from "../../address/qmailAddress";
import { findProtectedAddress } from "../../protectedAddresses";
import { denSnKey, readJsonArray, writeJsonArray } from "./profileHelpers";

const disabledStorageKey = (listType) =>
  listType === "black" ? "qmail.drd.disabled.black" : "qmail.drd.disabled.white";

/**
 * Shared white/black list editor for the DRD directory.
 * @param {"white"|"black"} listType
 */
const DrdListEditor = ({ listType }) => {
  const storageKey = useMemo(() => disabledStorageKey(listType), [listType]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState([]);
  const [disabledKeys, setDisabledKeys] = useState(() => new Set(readJsonArray(storageKey)));
  const [addressInput, setAddressInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [busyKey, setBusyKey] = useState(null);
  const [adding, setAdding] = useState(false);

  const persistDisabled = useCallback((nextSet) => {
    setDisabledKeys(nextSet);
    writeJsonArray(storageKey, Array.from(nextSet));
  }, [storageKey]);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getDrdLists();
      if (!result?.success) {
        setError(result?.error || "Failed to load lists.");
        setEntries([]);
        return;
      }

      const raw = Array.isArray(result.data?.entries) ? result.data.entries : [];
      const ofType = raw.filter((entry) => entry?.listType === listType);

      const liveKeys = new Set(
        ofType.map((entry) => denSnKey(entry.denomination, entry.serialNumber)),
      );

      // Keep local disabled entries that are not currently on the DRD.
      const storedDisabled = new Set(readJsonArray(storageKey));
      const stillDisabled = new Set(
        Array.from(storedDisabled).filter((key) => !liveKeys.has(key)),
      );
      persistDisabled(stillDisabled);

      const liveRows = ofType.map((entry) => {
        const key = denSnKey(entry.denomination, entry.serialNumber);
        const canonical =
          entry.address ||
          formatQmailAddress(entry.serialNumber, entry.denomination) ||
          key;
        return {
          key,
          denomination: Number(entry.denomination),
          serialNumber: Number(entry.serialNumber),
          address: canonical,
          enabled: true,
        };
      });

      const disabledRows = Array.from(stillDisabled).map((key) => {
        const [den, sn] = key.split(":");
        const denomination = Number(den);
        const serialNumber = Number(sn);
        return {
          key,
          denomination,
          serialNumber,
          address: formatQmailAddress(serialNumber, denomination) || key,
          enabled: false,
        };
      });

      setEntries(
        [...liveRows, ...disabledRows].sort((a, b) =>
          String(a.address).localeCompare(String(b.address)),
        ),
      );
    } catch (err) {
      setError(err?.message || "Failed to load lists.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [listType, persistDisabled, storageKey]);

  // Initial load. loadLists is the single implementation (also used by
  // Retry and after every mutation); a stray setState after unmount is
  // harmless in React 18, so no cancelled flag is needed here.
  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const handleAdd = async (event) => {
    event.preventDefault();
    const trimmed = addressInput.trim();
    if (!trimmed) {
      setInputError("Enter a QMail address.");
      return;
    }

    const parsed = qmailAddressToDrdCoin(trimmed);
    if (!parsed?.ok) {
      setInputError(parsed?.error || "Invalid QMail address.");
      return;
    }

    if (listType === "black") {
      const protectedEntry = findProtectedAddress(
        parsed.denomination,
        parsed.serialNumber,
      );
      if (protectedEntry) {
        setInputError(protectedEntry.blacklistRefusal);
        return;
      }
    }

    setInputError("");
    setAdding(true);
    try {
      const result = await setDrdListEntries([
        {
          denomination: parsed.denomination,
          serialNumber: parsed.serialNumber,
          listType,
        },
      ]);
      if (!result?.success) {
        setInputError(result?.error || "Failed to add entry.");
        return;
      }

      const key = denSnKey(parsed.denomination, parsed.serialNumber);
      if (disabledKeys.has(key)) {
        const next = new Set(disabledKeys);
        next.delete(key);
        persistDisabled(next);
      }

      setAddressInput("");
      await loadLists();
    } catch (err) {
      setInputError(err?.message || "Failed to add entry.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (row) => {
    setBusyKey(row.key);
    setError("");
    try {
      if (row.enabled) {
        const result = await removeDrdListEntries([
          {
            denomination: row.denomination,
            serialNumber: row.serialNumber,
          },
        ]);
        if (!result?.success) {
          setError(result?.error || "Failed to delete entry.");
          return;
        }
      }

      if (disabledKeys.has(row.key)) {
        const next = new Set(disabledKeys);
        next.delete(row.key);
        persistDisabled(next);
      }

      await loadLists();
    } catch (err) {
      setError(err?.message || "Failed to delete entry.");
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleEnabled = async (row, nextEnabled) => {
    setBusyKey(row.key);
    setError("");
    try {
      if (nextEnabled) {
        if (listType === "black") {
          const protectedEntry = findProtectedAddress(
            row.denomination,
            row.serialNumber,
          );
          if (protectedEntry) {
            setError(protectedEntry.blacklistRefusal);
            return;
          }
        }

        const result = await setDrdListEntries([
          {
            denomination: row.denomination,
            serialNumber: row.serialNumber,
            listType,
          },
        ]);
        if (!result?.success) {
          setError(result?.error || "Failed to re-enable entry.");
          return;
        }
        const next = new Set(disabledKeys);
        next.delete(row.key);
        persistDisabled(next);
      } else {
        const result = await removeDrdListEntries([
          {
            denomination: row.denomination,
            serialNumber: row.serialNumber,
          },
        ]);
        if (!result?.success) {
          setError(result?.error || "Failed to disable entry.");
          return;
        }
        const next = new Set(disabledKeys);
        next.add(row.key);
        persistDisabled(next);
      }
      await loadLists();
    } catch (err) {
      setError(err?.message || "Failed to update entry.");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="qmail-profile-modal__state" role="status">
        <Loader2 className="spinning" size={22} aria-hidden="true" />
        <p>Loading list…</p>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="qmail-profile-modal__state" role="alert">
        <AlertCircle size={22} aria-hidden="true" />
        <h3>Could not load list</h3>
        <p>{error}</p>
        <button type="button" className="btn btn--secondary" onClick={loadLists}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="qmail-profile-form">
      <p className="qmail-profile-modal__note">
        {listType === "white"
          ? "Addresses on your white list can send you qmail for FREE — your inbox fee is waived for them."
          : "Addresses on your black list cannot send you qmail at all."}
      </p>

      {error ? (
        <div className="qmail-profile-form__error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <form className="qmail-profile-form__row" onSubmit={handleAdd}>
        <div className="qmail-profile-form__field">
          <label className="qmail-profile-form__label" htmlFor={`drd-list-add-${listType}`}>
            Add address
          </label>
          <input
            id={`drd-list-add-${listType}`}
            type="text"
            className="qmail-profile-form__input qmail-profile-form__input--mono"
            value={addressInput}
            onChange={(event) => {
              setAddressInput(event.target.value);
              setInputError("");
            }}
            placeholder="e.g. 78.34@bit"
            disabled={adding}
            aria-invalid={Boolean(inputError)}
          />
          {inputError ? (
            <span className="qmail-profile-form__error" role="alert">
              {inputError}
            </span>
          ) : (
            <span className="qmail-profile-form__hint">
              QMail address like 78.34@bit
            </span>
          )}
        </div>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={adding || !addressInput.trim()}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {entries.length === 0 ? (
        <div className="qmail-profile-modal__state">
          <p>
            No {listType === "black" ? "black" : "white"}-list entries yet.
            Add an address above.
          </p>
        </div>
      ) : (
        <div className="qmail-profile-table-wrap">
          <table className="qmail-profile-table">
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Enabled</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => {
                const busy = busyKey === row.key;
                return (
                  <tr
                    key={row.key}
                    className={
                      row.enabled
                        ? undefined
                        : "qmail-profile-table__row--disabled"
                    }
                  >
                    <td className="qmail-profile-table__address">{row.address}</td>
                    <td>
                      <label className="qmail-profile-table__check">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          disabled={busy}
                          onChange={(event) =>
                            handleToggleEnabled(row, event.target.checked)
                          }
                        />
                        <span>{row.enabled ? "On" : "Off"}</span>
                      </label>
                    </td>
                    <td>
                      <div className="qmail-profile-table__actions">
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={busy}
                          onClick={() => handleDelete(row)}
                          aria-label={`Delete ${row.address}`}
                        >
                          {busy ? (
                            <Loader2 className="spinning" size={16} />
                          ) : (
                            <Trash2 size={16} />
                          )}
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DrdListEditor;
