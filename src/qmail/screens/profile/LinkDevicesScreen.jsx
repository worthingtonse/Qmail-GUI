/* eslint-disable react/prop-types */
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { qmailAddressToDrdCoin } from "../../../api/qmailApiServices";
import { readJsonArray, writeJsonArray } from "./profileHelpers";

const STORAGE_KEY = "qmail.linkedDevices";

function loadDevices() {
  const raw = readJsonArray(STORAGE_KEY);
  return raw
    .map((entry) => ({
      address: typeof entry?.address === "string" ? entry.address : "",
      nickName: typeof entry?.nickName === "string" ? entry.nickName : "",
      enabled: entry?.enabled !== false,
    }))
    .filter((entry) => entry.address);
}

/**
 * Local-only linked devices editor (backend sync coming later).
 * Reachable in code; the menu item is disabled until the feature ships.
 */
const LinkDevicesScreen = () => {
  const [devices, setDevices] = useState(() => loadDevices());
  const [addressInput, setAddressInput] = useState("");
  const [nickInput, setNickInput] = useState("");
  const [inputError, setInputError] = useState("");

  const persist = (next) => {
    setDevices(next);
    writeJsonArray(STORAGE_KEY, next);
  };

  const existingAddresses = useMemo(
    () => new Set(devices.map((d) => d.address.toLowerCase())),
    [devices],
  );

  const handleAdd = (event) => {
    event.preventDefault();
    const trimmed = addressInput.trim();
    if (!trimmed) {
      setInputError("Enter a device QMail address.");
      return;
    }

    const parsed = qmailAddressToDrdCoin(trimmed);
    if (!parsed?.ok) {
      setInputError(parsed?.error || "Invalid QMail address.");
      return;
    }

    const canonical = parsed.canonical || trimmed;
    if (existingAddresses.has(canonical.toLowerCase())) {
      setInputError("That device is already in the list.");
      return;
    }

    const next = [
      ...devices,
      {
        address: canonical,
        nickName: nickInput.trim(),
        enabled: true,
      },
    ];
    persist(next);
    setAddressInput("");
    setNickInput("");
    setInputError("");
  };

  const handleToggle = (index, enabled) => {
    const next = devices.map((device, i) =>
      i === index ? { ...device, enabled } : device,
    );
    persist(next);
  };

  const handleDelete = (index) => {
    const next = devices.filter((_, i) => i !== index);
    persist(next);
  };

  return (
    <div className="qmail-profile-form">
      <p className="qmail-profile-modal__banner">
        Device linking is coming soon. Devices added here are saved locally
        and will sync when the feature launches.
      </p>

      <form className="qmail-profile-form__row" onSubmit={handleAdd}>
        <div className="qmail-profile-form__field">
          <label className="qmail-profile-form__label" htmlFor="linked-device-address">
            Device address
          </label>
          <input
            id="linked-device-address"
            type="text"
            className="qmail-profile-form__input qmail-profile-form__input--mono"
            value={addressInput}
            onChange={(event) => {
              setAddressInput(event.target.value);
              setInputError("");
            }}
            placeholder="e.g. 78.34@bit"
            aria-invalid={Boolean(inputError)}
          />
        </div>
        <div className="qmail-profile-form__field">
          <label className="qmail-profile-form__label" htmlFor="linked-device-nick">
            Nick name (optional)
          </label>
          <input
            id="linked-device-nick"
            type="text"
            className="qmail-profile-form__input"
            value={nickInput}
            onChange={(event) => setNickInput(event.target.value)}
            placeholder="e.g. Laptop"
          />
        </div>
        <button type="submit" className="btn btn--primary">
          Add
        </button>
      </form>

      {inputError ? (
        <span className="qmail-profile-form__error" role="alert">
          {inputError}
        </span>
      ) : null}

      {devices.length === 0 ? (
        <div className="qmail-profile-modal__state">
          <p>No linked devices yet. Add one above to keep it ready for sync.</p>
        </div>
      ) : (
        <div className="qmail-profile-table-wrap">
          <table className="qmail-profile-table">
            <thead>
              <tr>
                <th scope="col">Address</th>
                <th scope="col">Nick Name</th>
                <th scope="col">Enabled</th>
                <th scope="col">Delete</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device, index) => (
                <tr
                  key={`${device.address}-${index}`}
                  className={
                    device.enabled
                      ? undefined
                      : "qmail-profile-table__row--disabled"
                  }
                >
                  <td className="qmail-profile-table__address">
                    {device.address}
                  </td>
                  <td>{device.nickName || "—"}</td>
                  <td>
                    <label className="qmail-profile-table__check">
                      <input
                        type="checkbox"
                        checked={device.enabled}
                        onChange={(event) =>
                          handleToggle(index, event.target.checked)
                        }
                      />
                      <span>{device.enabled ? "On" : "Off"}</span>
                    </label>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => handleDelete(index)}
                      aria-label={`Delete ${device.address}`}
                    >
                      <Trash2 size={16} />
                      <span>Delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LinkDevicesScreen;
