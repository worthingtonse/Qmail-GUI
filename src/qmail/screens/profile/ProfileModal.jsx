/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { getDrdUserProfile } from "../../../api/qmailApiServices";
import { parseQmailAddress } from "../../address/qmailAddress";
import { invalidateDrdSymbols } from "../../avatar/drdSymbols";
import {
  EMPTY_PROFILE,
  profileUserToForm,
} from "./profileHelpers";
import DrdListEditor from "./DrdListEditor";
import SymbolPickerScreen from "./SymbolPickerScreen";
import NameEditorScreen from "./NameEditorScreen";
import DescriptionEditorScreen from "./DescriptionEditorScreen";
import InboxFeeScreen from "./InboxFeeScreen";
import ClassEditorScreen from "./ClassEditorScreen";
import LinkDevicesScreen from "./LinkDevicesScreen";
import FindUsersScreen from "./FindUsersScreen";
import "./profile.css";

const EDITOR_TITLES = {
  whitelist: "Edit White List",
  blacklist: "Edit Black List",
  symbols: "Edit Your Symbols",
  name: "Edit Your Name",
  description: "Edit Your Description",
  class: "Set Lowest Accepted Class",
  "inbox-fee": "Set Inbox Fee",
  devices: "Link Devices",
  "find-users": "Find Users",
};

const PROFILE_EDITORS = new Set([
  "symbols",
  "name",
  "description",
  "class",
  "inbox-fee",
]);

// Editors that do not need a loaded QMail identity coin.
const IDENTITY_OPTIONAL_EDITORS = new Set(["find-users"]);

/**
 * Host modal for all DRD profile / list editor screens.
 *
 * Props:
 * - editor: null | "whitelist" | "blacklist" | "symbols" | "name" | "description" | "class" | "devices" | "find-users"
 * - onClose: () => void
 * - qmailAddress: string
 */
const ProfileModal = ({ editor, onClose, qmailAddress }) => {
  const identity = useMemo(() => {
    if (!qmailAddress) return null;
    const parsed = parseQmailAddress(qmailAddress);
    if (!parsed?.ok) return null;
    return {
      denomination: parsed.denominationCode,
      serialNumber: parsed.serialNumber,
      canonical: parsed.canonical || qmailAddress,
    };
  }, [qmailAddress]);

  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [profileForm, setProfileForm] = useState(() => ({ ...EMPTY_PROFILE }));
  // Remount child editors when a fresh profile load completes for this open.
  const [profileEpoch, setProfileEpoch] = useState(0);
  const [profileReloadToken, setProfileReloadToken] = useState(0);

  const needsProfile = PROFILE_EDITORS.has(editor);
  const isOpen = Boolean(editor);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !needsProfile || !identity) {
      return undefined;
    }

    let cancelled = false;

    const load = async () => {
      setProfileLoading(true);
      setProfileError("");
      try {
        const result = await getDrdUserProfile({
          denomination: identity.denomination,
          serialNumber: identity.serialNumber,
        });
        if (cancelled) return;

        if (!result?.success) {
          setProfileError(result?.error || "Failed to load profile.");
          setRegistered(false);
          setProfileForm({ ...EMPTY_PROFILE });
          return;
        }

        const data = result.data || {};
        const isRegistered = Boolean(data.registered && data.user);
        setRegistered(isRegistered);
        setProfileForm(
          isRegistered ? profileUserToForm(data.user) : { ...EMPTY_PROFILE },
        );
        setProfileEpoch((n) => n + 1);
      } catch (err) {
        if (!cancelled) {
          setProfileError(err?.message || "Failed to load profile.");
          setRegistered(false);
          setProfileForm({ ...EMPTY_PROFILE });
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, needsProfile, identity, profileReloadToken]);

  // Reset transient profile state when closing so the next open starts clean.
  useEffect(() => {
    if (isOpen) return;
    setProfileLoading(false);
    setProfileError("");
    setRegistered(false);
    setProfileForm({ ...EMPTY_PROFILE });
  }, [isOpen]);

  if (!isOpen) return null;

  const title = EDITOR_TITLES[editor] || "Edit Profile";
  const wide =
    editor === "symbols" ||
    editor === "whitelist" ||
    editor === "blacklist" ||
    editor === "find-users";

  const handleOverlayClick = () => {
    onClose?.();
  };

  const handleProfileSaved = (nextForm) => {
    setProfileForm({ ...nextForm });
    setRegistered(true);
    // Own symbols may have changed — drop the cache entry so left-pane /
    // self cartouches re-fetch instead of showing stale (0,0) or old pair.
    if (identity) {
      invalidateDrdSymbols(identity.denomination, identity.serialNumber);
    }
  };

  const renderBody = () => {
    // Directory search is open — no identity coin required.
    if (editor === "find-users") {
      return <FindUsersScreen qmailAddress={qmailAddress} />;
    }

    if (!identity && !IDENTITY_OPTIONAL_EDITORS.has(editor)) {
      return (
        <div className="qmail-profile-modal__state">
          <h3>No QMail identity available yet</h3>
          <p>
            Set up or load a QMail identity to edit your directory profile and
            lists.
          </p>
        </div>
      );
    }

    if (editor === "whitelist") {
      return <DrdListEditor listType="white" />;
    }
    if (editor === "blacklist") {
      return <DrdListEditor listType="black" />;
    }
    if (editor === "devices") {
      return <LinkDevicesScreen />;
    }

    if (needsProfile) {
      if (profileLoading) {
        return (
          <div className="qmail-profile-modal__state" role="status">
            <Loader2 className="spinning" size={22} aria-hidden="true" />
            <p>Loading profile…</p>
          </div>
        );
      }

      if (profileError) {
        return (
          <div className="qmail-profile-modal__state" role="alert">
            <h3>Could not load profile</h3>
            <p>{profileError}</p>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setProfileReloadToken((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        );
      }

      if (editor === "symbols") {
        return (
          <SymbolPickerScreen
            key={`symbols-${profileEpoch}`}
            profileForm={profileForm}
            registered={registered}
            serialNumber={identity?.serialNumber ?? null}
            onProfileSaved={handleProfileSaved}
          />
        );
      }
      if (editor === "name") {
        return (
          <NameEditorScreen
            key={`name-${profileEpoch}`}
            profileForm={profileForm}
            registered={registered}
            onProfileSaved={handleProfileSaved}
          />
        );
      }
      if (editor === "description") {
        return (
          <DescriptionEditorScreen
            key={`description-${profileEpoch}`}
            profileForm={profileForm}
            registered={registered}
            onProfileSaved={handleProfileSaved}
          />
        );
      }
      if (editor === "inbox-fee") {
        return (
          <InboxFeeScreen
            key={`inbox-fee-${profileEpoch}`}
            profileForm={profileForm}
            registered={registered}
            onProfileSaved={handleProfileSaved}
          />
        );
      }
      if (editor === "class") {
        return (
          <ClassEditorScreen
            key={`class-${profileEpoch}`}
            profileForm={profileForm}
            registered={registered}
            onProfileSaved={handleProfileSaved}
          />
        );
      }
    }

    return null;
  };

  return (
    <div
      className="qmail-profile-modal__overlay"
      role="presentation"
      onClick={handleOverlayClick}
    >
      <section
        className={
          wide
            ? "qmail-profile-modal__dialog qmail-profile-modal__dialog--wide"
            : "qmail-profile-modal__dialog"
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="qmail-profile-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="qmail-profile-modal__header">
          <h2 id="qmail-profile-modal-title" className="qmail-profile-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="qmail-profile-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>
        <div className="qmail-profile-modal__body">{renderBody()}</div>
      </section>
    </div>
  );
};

export default ProfileModal;
