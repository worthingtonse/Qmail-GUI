/* eslint-disable react/prop-types */
import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { postDrdUserProfile } from "../../../api/qmailApiServices";
import { getQmailAvatarAssetHref } from "../../avatar/qmailAvatar";
import { RAIDA_COUNT } from "../serverStatusUi";
import {
  formatProfileSaveMessage,
  randomSymbolIndex,
} from "./profileHelpers";
import { symbolColorForIndex } from "./symbolColor";
import { serialSymbolColors } from "../../avatar/serialColor";

const SYMBOL_COUNT = 256;

/**
 * Two-slot symbol picker with a 16×16 grid of all 256 symbols.
 */
const SymbolPickerScreen = ({
  profileForm,
  registered,
  serialNumber,
  onProfileSaved,
}) => {
  const [firstSymbol, setFirstSymbol] = useState(
    () => (profileForm?.firstSymbol ?? null),
  );
  const [secondSymbol, setSecondSymbol] = useState(
    () => (profileForm?.secondSymbol ?? null),
  );
  const [armed, setArmed] = useState("first");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const symbols = useMemo(
    () => Array.from({ length: SYMBOL_COUNT }, (_, index) => index),
    [],
  );

  const applyToArmed = (index) => {
    setStatus(null);
    if (armed === "first") {
      setFirstSymbol(index);
      setArmed("second");
      return;
    }
    setSecondSymbol(index);
  };

  const randomizeSlot = (slot) => {
    setStatus(null);
    const value = randomSymbolIndex();
    if (slot === "first") {
      setFirstSymbol(value);
      return;
    }
    setSecondSymbol(value);
  };

  const handleSave = async () => {
    const resolvedFirst =
      firstSymbol === null || firstSymbol === undefined
        ? randomSymbolIndex()
        : firstSymbol;
    const resolvedSecond =
      secondSymbol === null || secondSymbol === undefined
        ? randomSymbolIndex()
        : secondSymbol;

    setFirstSymbol(resolvedFirst);
    setSecondSymbol(resolvedSecond);
    setSaving(true);
    setStatus(null);

    try {
      const payload = {
        ...profileForm,
        firstSymbol: resolvedFirst,
        secondSymbol: resolvedSecond,
      };
      const result = await postDrdUserProfile(payload);
      if (!result?.success) {
        setStatus({
          kind: "error",
          message: result?.error || "Failed to save symbols.",
        });
        return;
      }

      if (typeof onProfileSaved === "function") {
        onProfileSaved(payload);
      }
      setStatus({
        kind: "success",
        message: formatProfileSaveMessage(result, RAIDA_COUNT),
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err?.message || "Failed to save symbols.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Slot borders preview YOUR identity colors — the top symbol renders in
  // the big-endian read of your serial's last two bytes, the bottom in the
  // little-endian read (avatar/serialColor.js). Falls back to the symbol's
  // baked color when no identity serial is available.
  const serialColors = serialSymbolColors(serialNumber);

  const renderSlot = (slot, value, label) => {
    const isArmed = armed === slot;
    const serialColor = serialColors
      ? (slot === "first" ? serialColors.top : serialColors.bottom)
      : null;
    const color =
      value === null || value === undefined
        ? null
        : serialColor || symbolColorForIndex(value);

    return (
      <div className="qmail-profile-symbols__slot">
        <span className="qmail-profile-symbols__slot-label">{label}</span>
        <button
          type="button"
          className={[
            "qmail-profile-symbols__frame",
            value === null || value === undefined
              ? "qmail-profile-symbols__frame--empty"
              : "",
            isArmed ? "qmail-profile-symbols__frame--armed" : "",
          ].filter(Boolean).join(" ")}
          style={color ? { borderColor: color } : undefined}
          onClick={() => setArmed(slot)}
          aria-pressed={isArmed}
          aria-label={`${label}${value === null || value === undefined ? ", empty" : `, symbol ${value}`}. Click to arm for selection.`}
        >
          {value === null || value === undefined ? (
            "None"
          ) : (
            <img
              src={getQmailAvatarAssetHref("symbol", value)}
              alt=""
              draggable={false}
            />
          )}
        </button>
        <div className="qmail-profile-symbols__slot-meta">
          {/* Show the chosen symbol itself, never its id number. */}
          {value === null || value === undefined ? (
            <span>None selected</span>
          ) : (
            <img
              className="qmail-profile-symbols__slot-mini"
              src={getQmailAvatarAssetHref("symbol", value)}
              alt={`Chosen symbol for ${label}`}
              draggable={false}
            />
          )}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={saving}
            onClick={() => randomizeSlot(slot)}
          >
            Randomize
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="qmail-profile-form">
      {!registered ? (
        <p className="qmail-profile-modal__note">
          You are not in the directory yet — saving will create your entry.
        </p>
      ) : null}

      <div className="qmail-profile-symbols__slots">
        {renderSlot("first", firstSymbol, "Top symbol")}
        {renderSlot("second", secondSymbol, "Bottom symbol")}
      </div>

      <p className="qmail-profile-modal__note">
        Click a slot to arm it, then pick a symbol from the grid.
        Empty slots are randomized on save.
      </p>

      <div className="qmail-profile-symbols__grid-wrap">
        <div
          className="qmail-profile-symbols__grid"
          role="listbox"
          aria-label="Symbol grid"
          aria-multiselectable="true"
        >
          {symbols.map((index) => {
            const selected =
              firstSymbol === index || secondSymbol === index;
            const color = symbolColorForIndex(index);
            return (
              <button
                key={index}
                type="button"
                role="option"
                aria-selected={selected}
                className={[
                  "qmail-profile-symbols__cell",
                  selected ? "qmail-profile-symbols__cell--selected" : "",
                ].filter(Boolean).join(" ")}
                style={selected ? { color } : undefined}
                onClick={() => applyToArmed(index)}
                title={`Symbol ${index}`}
              >
                <img
                  src={getQmailAvatarAssetHref("symbol", index)}
                  alt={String(index)}
                  draggable={false}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="qmail-profile-modal__footer" style={{ borderTop: 0, padding: 0 }}>
        {status ? (
          <p
            className={
              status.kind === "success"
                ? "qmail-profile-modal__status qmail-profile-modal__status--success"
                : "qmail-profile-modal__status qmail-profile-modal__status--error"
            }
            role={status.kind === "error" ? "alert" : "status"}
          >
            {status.kind === "success" ? (
              <CheckCircle size={16} aria-hidden="true" />
            ) : (
              <AlertCircle size={16} aria-hidden="true" />
            )}
            <span>{status.message}</span>
          </p>
        ) : (
          <span />
        )}
        <div className="qmail-profile-modal__footer-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? (
              <>
                <Loader2 className="spinning" size={16} aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SymbolPickerScreen;
