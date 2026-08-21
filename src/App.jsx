import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, CheckCircle, Download, X, Loader2 } from "lucide-react";
import "./App.css";
import "./UpdateModal.css";
import ServiceSelectionScreen from "./screens/ServiceSelectionScreen";
import WalletSetupScreen from "./qmail/screens/WalletSetupScreen";
import Wallet from "./wallet/Wallet";
import QMail from "./qmail/QMail";
import soundService from "./api/soundService";
import { clearSkipAutoRestore } from "./qmail/skipAutoRestore";
import { NotificationProvider } from "./components/common/notifications/NotificationContext";
import NotificationContainer from "./components/common/notifications/NotificationContainer";
import {
  API_PORT,
  checkVersion,
  getIdentity,
  hasId,
  normalizeIdentityForUi,
  peekBeacon,
  shutdownCore,
} from "./api/qmailApiServices";
import { formatBuildDateForDisplay } from "./version";
import { buildWindowTitle } from "./qmail/screens/windowTitle";

// Where all QMail software downloads live. The "Download Update" button
// opens this page in the user's default browser.
const DOWNLOAD_PAGE_URL = "https://cloudcoinconsortium.com/use.php";
const DEFAULT_TITLE_BAR_COLOR = "#C9CC3F";
const DEFAULT_BACKGROUND_COLOR = "#0F1419";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const QMAIL_DISCLAIMER_TEXT = `DISCLAIMER:
This software is provided 'as-is', without any express or implied warranty.
In no event shall the authors be held liable for any damages arising from
the use of this software.

This software deals with digital currency. The value of digital currency
can fluctuate. There is no guarantee of value, and you could lose money.
Use this software at your own risk. The developers, CloudCoin Consortium,
and its affiliates are not responsible for any financial losses or damages
incurred from the use or misuse of this software.

By using this software, you acknowledge that you understand and agree to
these terms. You are solely responsible for securing your digital assets.`;
const SERVICES = {
  NONE: "none",
  PROVISIONING: "provisioning",
  WALLET: "wallet",
  QMAIL: "qmail",
};

function App() {
  const [selectedService, setSelectedService] = useState(SERVICES.NONE);
  const [provisioningData, setProvisioningData] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeExecutablePath, setUpgradeExecutablePath] = useState("");
  // In-place upgrade: whether this build can replace its own launcher
  // (Windows portable / Linux AppImage — asked once from the main process),
  // live progress of a running upgrade, and the failure text shown in the
  // manual-instructions modal when the automatic path gives up.
  const [upgradeSupport, setUpgradeSupport] = useState(null);
  const [upgradeProgress, setUpgradeProgress] = useState(null);
  const [upgradeFailureMessage, setUpgradeFailureMessage] = useState("");
  // Raw "code: error" from the failed attempt, shown as a technical detail
  // line in the manual modal (the same text lands in upgrade.log).
  const [upgradeFailureDetail, setUpgradeFailureDetail] = useState("");
  // Help > Upgrade on a current install: a small "you're up to date"
  // notice instead of instructions to overwrite a working program.
  const [upToDateInfo, setUpToDateInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Starting QMail…");
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(false);
  const [showSoundPrompt, setShowSoundPrompt] = useState(false);
  // Guards prewarmInbox() so the background beacon check fires at most once,
  // even if both the fast path and the backend identity check confirm QMAIL.
  const inboxPrewarmedRef = useRef(false);

  // Show the listen port as soon as the renderer mounts, including on
  // the loading and service-selection screens. QMailDashboard replaces
  // this with the fuller title once identity and the app folder are known.
  useEffect(() => {
    document.title = buildWindowTitle({ port: API_PORT });
  }, []);

  const openTitleBarColorPicker = useCallback(async (initial = {}) => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      !window.electronAPI?.setTitleBarColor
    ) {
      return;
    }

    let currentColor =
      typeof initial.color === "string" && HEX_COLOR_PATTERN.test(initial.color)
        ? initial.color
        : DEFAULT_TITLE_BAR_COLOR;

    if (!initial.color && window.electronAPI.getTitleBarColor) {
      try {
        const result = await window.electronAPI.getTitleBarColor();
        if (result?.color && HEX_COLOR_PATTERN.test(result.color)) {
          currentColor = result.color;
        }
      } catch {
        /* Keep the default color. */
      }
    }

    document
      .querySelectorAll("input[data-qmail-titlebar-color-picker]")
      .forEach((node) => node.remove());

    const input = document.createElement("input");
    input.type = "color";
    input.value = currentColor;
    input.setAttribute("data-qmail-titlebar-color-picker", "true");
    input.style.position = "fixed";
    input.style.left = "-1000px";
    input.style.top = "0";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";

    input.addEventListener(
      "change",
      async () => {
        try {
          await window.electronAPI.setTitleBarColor(input.value);
        } catch (error) {
          console.error("Failed to set title bar color:", error);
        } finally {
          input.remove();
        }
      },
      { once: true }
    );

    document.body.appendChild(input);
    input.click();
  }, []);

  const applyAppearanceColors = useCallback((colors = {}) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const appColor = colors.backgroundColor;
    const detailColor = colors.qmailDetailBackgroundColor;

    // --primary-bg drives the QMail dashboard and the gradient-backed entry
    // screens; --app-background covers roots that default to --secondary-bg
    // (wallet main dashboard, app shell) so View → Background Color visibly
    // applies across every service.
    if (typeof appColor === "string" && HEX_COLOR_PATTERN.test(appColor)) {
      root.style.setProperty("--primary-bg", appColor);
      root.style.setProperty("--app-background", appColor);
    } else {
      root.style.removeProperty("--primary-bg");
      root.style.removeProperty("--app-background");
    }

    if (typeof detailColor === "string" && HEX_COLOR_PATTERN.test(detailColor)) {
      root.style.setProperty("--qmail-detail-background", detailColor);
    } else {
      root.style.removeProperty("--qmail-detail-background");
    }

    // Detail-pane pattern: mirrored as a data attribute; ReadingPane.css
    // defines one background treatment per id. Unknown ids simply match
    // no CSS rule, which renders the same as "none".
    if (typeof colors.qmailDetailPattern === "string") {
      root.setAttribute("data-qmail-detail-pattern", colors.qmailDetailPattern);
    }
  }, []);

  const openAppearanceColorPicker = useCallback(async (initial = {}) => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      !window.electronAPI
    ) {
      return;
    }

    const target = initial.target === "qmail-detail" ? "qmail-detail" : "background";
    const setter =
      target === "qmail-detail"
        ? window.electronAPI.setQmailDetailBackgroundColor
        : window.electronAPI.setBackgroundColor;
    if (typeof setter !== "function") return;

    let currentColor =
      typeof initial.color === "string" && HEX_COLOR_PATTERN.test(initial.color)
        ? initial.color
        : "";

    if (!currentColor && window.electronAPI.getAppearanceColors) {
      try {
        const colors = await window.electronAPI.getAppearanceColors();
        const savedColor =
          target === "qmail-detail"
            ? colors?.qmailDetailBackgroundColor || colors?.backgroundColor
            : colors?.backgroundColor;
        if (typeof savedColor === "string" && HEX_COLOR_PATTERN.test(savedColor)) {
          currentColor = savedColor;
        }
      } catch {
        /* Fall through to the current theme's first background color. */
      }
    }

    if (!currentColor) {
      const themeBackground = getComputedStyle(document.documentElement)
        .getPropertyValue("--primary-bg");
      currentColor =
        themeBackground.match(/#[0-9a-fA-F]{6}/)?.[0] || DEFAULT_BACKGROUND_COLOR;
    }

    document
      .querySelectorAll("input[data-qmail-appearance-color-picker]")
      .forEach((node) => node.remove());

    const input = document.createElement("input");
    input.type = "color";
    input.value = currentColor;
    input.setAttribute("data-qmail-appearance-color-picker", target);
    input.style.position = "fixed";
    input.style.left = "-1000px";
    input.style.top = "0";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";

    input.addEventListener(
      "change",
      async () => {
        try {
          const result = await setter(input.value);
          applyAppearanceColors(result);
        } catch (error) {
          console.error(`Failed to set ${target} background color:`, error);
        } finally {
          input.remove();
        }
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  }, [applyAppearanceColors]);

  // Wait for the backend to be ready before kicking off identity checks. The Electron splash hides the very first window
  // of "nothing is happening", but the backend itself (core.exe) may
  // take a second or two more to bind the port. Without this probe,
  // the first identity check often fails on a cold start and the
  // app lands on ServiceSelectionScreen even when the user has a
  // valid local identity.
  const waitForBackend = async () => {
    const apiPort =
      new URLSearchParams(window.location.search).get("backendPort") ||
      import.meta.env.VITE_API_PORT ||
      "8080";
    const probeUrl = `http://localhost:${apiPort}/api/system/disclaimer`;
    const deadline = Date.now() + 15000; // 15s ceiling
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const r = await fetch(probeUrl, { method: "GET" });
        if (r.ok) return true;
      } catch {
        // expected during the cold-start window — keep trying
      }
      if (attempt === 3) {
        setLoadingMessage("Waiting for QMail backend…");
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    return false;
  };

  // Pre-warm the inbox in the BACKGROUND once we know the user has an
  // identity, so new mail is already fetched to the local DB by the time the
  // user finishes reading the disclaimer and clicks Accept. Use the quick
  // beacon PEEK, not long-poll PING; PING can legally hold the single backend
  // HTTP worker for 10 minutes. Fire-and-forget: failures are non-fatal.
  // Runs at most once (inboxPrewarmedRef).
  const prewarmInbox = () => {
    if (inboxPrewarmedRef.current) return;
    inboxPrewarmedRef.current = true;
    (async () => {
      try {
        await waitForBackend();
        await peekBeacon();
        console.log("[prewarmInbox] background beacon peek complete");
      } catch (error) {
        console.warn("[prewarmInbox] background peek failed (non-fatal):", error);
      }
    })();
  };

  useEffect(() => {
    const initializeApp = async () => {
      // The version check hits a remote URL and the local identity check
      // reads the filesystem via IPC — NEITHER depends on the backend HTTP
      // server. Kick the version check off immediately; it resolves on its
      // own schedule and the prompt is gated on backend readiness before
      // any download is attempted.
      checkForUpdates();

      // FAST PATH: the local coin-file check (hasId) does NOT wait on
      // core.exe. Run it FIRST, before waitForBackend(), so a returning
      // user lands on QMAIL immediately while the backend is still binding
      // its port. QMailDashboard's mount-time useEffect retries
      // getIdentity() to seed userAccount once the backend has indexed it.
      try {
        const idCheck = await hasId();
        console.log("[initializeApp] fast-path hasId returned:", idCheck);
        if (idCheck && idCheck.has_id) {
          clearSkipAutoRestore();
          setProvisioningData(null);
          setSelectedService(SERVICES.QMAIL);
          setIsLoading(false);
          // Start fetching mail in the background while the user reads the
          // disclaimer, so the inbox is fresh by the time they click Accept.
          prewarmInbox();
          return;
        }
      } catch (error) {
        // Fall through to the full backend-dependent flow below.
        console.error("[initializeApp] fast-path hasId failed:", error);
      }

      const ready = await waitForBackend();
      if (!ready) {
        setLoadingMessage(
          "The background of the program failed to start. There may be a conflict with ports. Try to start the program again.",
        );
        // Don't hard-block; proceed to the normal flow and let the
        // individual screens surface their own retry affordances.
      }
      // No fast-path identity — fall back to the backend identity check.
      await checkIdentity();
      // If selectedService is still SERVICES.NONE after checkIdentity(),
      // it means the identity check failed and we should stay on the service selection screen
      console.log("[initializeApp] selectedService after checks:", selectedService);
      setIsLoading(false);
    };

    initializeApp();
    // Startup should run once; checkIdentity/prewarmInbox are safe here because
    // this effect owns the initial boot sequence and must not restart mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for backend-ready signal from Electron main process.
  // When core.exe is ready to accept requests, retry identity checks
  // if they failed during the initial startup window.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;

    const handleBackendReady = async () => {
      console.log('[App] Backend ready signal received, retrying identity check...');
      // Only retry if identity check failed previously (still on ServiceSelectionScreen)
      if (selectedService === SERVICES.NONE) {
        await checkIdentity();
      }
    };

    // Listen for backend-ready event from Electron IPC
    const unsubscribe = window.electronAPI.onBackendReady(handleBackendReady);
    return unsubscribe;
    // The retry only needs to rebind when selectedService changes; checkIdentity
    // is the same identity probe used by the initial boot path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService]);

  useEffect(() => {
    const unsubscribe =
      window.electronAPI?.onTitleBarColorPick?.(openTitleBarColorPicker);
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [openTitleBarColorPicker]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return undefined;

    api.getAppearanceColors?.()
      .then(applyAppearanceColors)
      .catch((error) => console.error("Failed to load appearance colors:", error));

    const unsubscribePick =
      api.onAppearanceColorPick?.(openAppearanceColorPicker);
    const unsubscribeChanged =
      api.onAppearanceColorsChanged?.(applyAppearanceColors);

    return () => {
      if (typeof unsubscribePick === "function") unsubscribePick();
      if (typeof unsubscribeChanged === "function") unsubscribeChanged();
    };
  }, [applyAppearanceColors, openAppearanceColorPicker]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleSoundPlaybackBlocked = () => {
      setShowSoundPrompt(true);
    };

    window.addEventListener(
      "qmail-sound-playback-blocked",
      handleSoundPlaybackBlocked,
    );
    return () =>
      window.removeEventListener(
        "qmail-sound-playback-blocked",
        handleSoundPlaybackBlocked,
      );
  }, []);

  // Help > Upgrade menu item. Three-way: a known update on a build that
  // can self-replace opens the Upgrade Now modal; a known update on
  // mac/dev (or after a failed automatic attempt) opens the manual
  // copy-over modal; an up-to-date install says so instead of telling the
  // user to overwrite a working program. Support/version data is fetched
  // on demand when the click beats the startup checks.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const unsubscribe = window.electronAPI?.onUpgradeRequested?.(
      async (data) => {
        if (data?.executablePath) {
          setUpgradeExecutablePath(String(data.executablePath));
        }

        if (upgradeFailureMessage) {
          // The automatic path already failed this session — manual is the
          // honest answer, with the failure reason still shown.
          setUpToDateInfo(null);
          setShowUpdateModal(false);
          setShowUpgradeModal(true);
          return;
        }

        let support = upgradeSupport;
        if (!support) {
          support = await window.electronAPI?.upgradeSupported?.().catch(() => null);
          if (support) setUpgradeSupport(support);
        }

        let info = updateAvailable;
        if (!info) {
          const result = await checkVersion().catch(() => null);
          if (result?.success) {
            info = result.data;
            if (result.data.update_available) setUpdateAvailable(result.data);
          }
        }

        // Exactly one of the three overlays (update / manual / up-to-date)
        // may be open after a menu click — each branch closes the others,
        // or a copy-over modal left from an earlier failed check would
        // stack under the up-to-date dialog.
        if (info?.update_available) {
          setUpToDateInfo(null);
          if (support?.supported) {
            setShowUpgradeModal(false);
            setUpdateAvailable(info);
            setShowUpdateModal(true);
          } else {
            setShowUpdateModal(false);
            setShowUpgradeModal(true);
          }
        } else if (info) {
          setShowUpdateModal(false);
          setShowUpgradeModal(false);
          setUpToDateInfo(info);
        } else {
          // The version check itself failed — the manual modal at least
          // gives the user the download page and their launcher path.
          setUpToDateInfo(null);
          setShowUpdateModal(false);
          setShowUpgradeModal(true);
        }
      },
    );
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [updateAvailable, upgradeSupport, upgradeFailureMessage]);

  // Ask the main process once whether in-place upgrade is possible here.
  // Also seeds the launcher path shown by the manual modal.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let cancelled = false;
    window.electronAPI
      ?.upgradeSupported?.()
      .then((support) => {
        if (cancelled || !support) return;
        setUpgradeSupport(support);
        if (support.executablePath) {
          setUpgradeExecutablePath(String(support.executablePath));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const unsubscribe = window.electronAPI?.onUpgradeProgress?.((progress) => {
      setUpgradeProgress(progress || null);
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, []);

  const handleEnableSounds = async () => {
    const enabled = await soundService.enablePlayback();
    if (enabled) {
      setShowSoundPrompt(false);
    }
  };

  useEffect(() => {
    const dispatchAlertSoundChanged = () => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("qmail-alert-sound-changed", {
          detail: {
            soundFile: soundService.getMailSoundFile(),
            settings: soundService.getSettings(),
          },
        }),
      );
    };

    const unsubscribe = window.electronAPI?.onAlertSoundCommand?.((payload = {}) => {
      if (payload.action === "preview") {
        soundService.previewMailReceived();
        return;
      }

      if (payload.action !== "set") return;

      const soundFile = String(payload.soundFile || "");
      soundService.setMailSoundFile(soundFile);
      soundService.setEnabled(Boolean(soundFile));
      if (soundFile) {
        soundService.playMailReceived({ force: true });
      }
      dispatchAlertSoundChanged();
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, []);

  // FIX-03: returning users with a configured identity should go
  // STRAIGHT to QMAIL, not bounce through WalletSetupScreen on every
  // launch. WalletSetupScreen is now first-run-only (post-import).
  const checkIdentity = async () => {
    try {
      console.log("[checkIdentity] Starting identity check...");
      const identity = await getIdentity();
      console.log("[checkIdentity] getIdentity returned:", identity);
      console.log("[checkIdentity] identity.configured =", identity?.configured);

      if (identity && identity.configured) {
        console.log("[checkIdentity] ✓ User has configured identity, going to QMAIL");
        // Returning user — normalize and seed the dashboard directly.
        clearSkipAutoRestore();
        const normalized = normalizeIdentityForUi(identity);
        console.log("[checkIdentity] Normalized identity:", normalized);
        setProvisioningData(normalized);
        setSelectedService(SERVICES.QMAIL);
        console.log("[checkIdentity] Called setSelectedService(SERVICES.QMAIL)");
        prewarmInbox();
        return;
      }

      console.log("[checkIdentity] Identity not configured (identity:", identity, "), checking hasId...");
      // Fallback: identity endpoint may not have loaded yet, but coin files
      // may already exist in the Mail wallet. Check with has-id.
      const idCheck = await hasId();
      console.log("[checkIdentity] hasId returned:", idCheck);
      if (idCheck && idCheck.has_id) {
        console.log("[checkIdentity] ✓ Coin files exist, going to QMAIL");
        // Coin files exist — go to QMAIL. QMailDashboard's mount-time
        // useEffect will retry getIdentity() and seed userAccount once
        // the backend has indexed the identity.
        clearSkipAutoRestore();
        setProvisioningData(null);
        setSelectedService(SERVICES.QMAIL);
        console.log("[checkIdentity] Called setSelectedService(SERVICES.QMAIL)");
        prewarmInbox();
        return;
      }

      console.log("[checkIdentity] ✗ No identity found, staying on ServiceSelectionScreen");
      // No identity at all — stay on ServiceSelectionScreen
    } catch (error) {
      console.error("[checkIdentity] ✗ Exception caught:", error);
      setSelectedService(SERVICES.NONE);
    }
  };

  const checkForUpdates = async () => {
    try {
      const result = await checkVersion();
      if (result.success && result.data.update_available) {
        setUpdateAvailable(result.data);
        setShowUpdateModal(true);
      }
    } catch (error) {
      console.error("Update check failed:", error);
    }
  };

  // Open the downloads page in the user's default browser. Prefers the
  // Electron shell (proper external open); falls back to window.open in a
  // plain browser/Vite build.
  const openDownloadPage = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(DOWNLOAD_PAGE_URL);
    } else {
      window.open(DOWNLOAD_PAGE_URL, "_blank", "noopener,noreferrer");
    }
  };

  const handleDownload = () => {
    openDownloadPage();
    setShowUpdateModal(false);
  };

  // One human sentence per upgrade failure code (upgrade.cjs), each naming
  // what the user can actually DO about it. Every code must have a branch:
  // the first field test failed with an unmapped 'swap' and the generic
  // fallback told the user nothing. The raw code+error are shown as a
  // detail line and persisted to upgrade.log next to QMail.exe.
  const friendlyUpgradeError = (result) => {
    switch (result?.code) {
      case "permission":
        return "QMail is in a folder it is not allowed to write to, and the administrator prompt was declined or failed. Move QMail to a folder you own (Desktop, Documents, a USB stick), or try again and accept the administrator prompt. Otherwise update manually:";
      case "no-space":
        return "There is not enough free disk space next to QMail to download the update. Free some space (about 150 MB) and try again, or update manually:";
      case "hash":
        return "The downloaded update failed its integrity check and was discarded — nothing was changed. This can be a corrupted download or a tampered file; try again, and if it keeps failing update manually:";
      case "download":
      case "sums":
        return "The update could not be downloaded — a network problem, or the download server is unreachable. Check your connection and try again, or update manually:";
      case "swap":
        return "The update was downloaded and verified, but QMail could not swap it into place because another program was holding the file — usually an antivirus scanning the fresh download, or a sync tool like OneDrive or Dropbox. Wait a minute and press Try Again, or update manually:";
      case "busy":
        return "An upgrade is already running. Let it finish before starting another.";
      case "unsupported":
        return "This copy of QMail is not running as the packaged program, so it cannot replace itself. Please update manually:";
      case "not-newer":
      case "bad-version":
        return "The update server did not offer a version newer than this one. If you believe a newer build exists, update manually:";
      default:
        return `The automatic upgrade could not complete (${
          result?.code || "unknown error"
        }). Please update manually:`;
    }
  };

  // "ready" counts as busy: it fires between the swap finishing and the
  // start-upgrade IPC promise resolving into the restart, and the buttons
  // must not flash back during that gap.
  const upgradeBusy =
    upgradeProgress != null &&
    [
      "checking",
      "downloading",
      "verifying",
      "installing",
      "ready",
      "restarting",
    ].includes(upgradeProgress.phase);

  const handleUpgradeNow = async () => {
    if (!updateAvailable || upgradeBusy) return;
    setUpgradeFailureMessage("");
    setUpgradeFailureDetail("");
    setUpgradeProgress({ phase: "checking" });

    const result = await window.electronAPI
      ?.startUpgrade?.(updateAvailable.latest_version)
      .catch((error) => ({ ok: false, code: "ipc", error: error?.message }));

    if (result?.ok) {
      // Ask before restarting (D7's fallback clause, invoked per Opus
      // review F1): compose drafts are EXPLICIT-only — there is no
      // autosave — so an automatic restart would silently destroy a
      // half-written message, an in-flight send, or a running coin
      // operation, none of which this component can see. The swap is
      // already done either way; "Later" just means the next launch runs
      // the new build.
      setUpgradeProgress({ phase: "installed-prompt" });
      return;
    }

    setUpgradeProgress(null);
    if (result?.code === "cancelled") return; // user aborted; stay quiet

    // Every other failure lands on the manual path with the reason named.
    console.error("In-place upgrade failed:", result);
    setUpgradeFailureMessage(friendlyUpgradeError(result));
    setUpgradeFailureDetail(
      `${result?.code || "unknown"}: ${result?.error || "no detail"}`,
    );
    setShowUpdateModal(false);
    setShowUpgradeModal(true);
  };

  // A transient failure (antivirus lock, network blip) should not dead-end
  // in manual mode: reopen the Upgrade Now modal for another attempt.
  const handleRetryUpgrade = () => {
    setUpgradeFailureMessage("");
    setUpgradeFailureDetail("");
    setShowUpgradeModal(false);
    setShowUpdateModal(true);
  };

  const handleCancelUpgrade = () => {
    window.electronAPI?.cancelUpgrade?.();
  };

  const handleRestartNow = async () => {
    setUpgradeProgress({ phase: "restarting" });
    const restarted = await window.electronAPI
      ?.restartAfterUpgrade?.()
      .catch(() => false);
    if (restarted !== true) {
      // The swap DID happen; only the relaunch failed. Tell the user to
      // finish by hand instead of leaving the modal stuck on
      // "Restarting…" with every button hidden.
      setUpgradeProgress({ phase: "installed" });
    }
  };

  const handleRestartLater = () => {
    // The swapped file stays on disk; the next launch runs the new build.
    setUpgradeProgress(null);
    setShowUpdateModal(false);
  };

  const upgradePhaseLabel = () => {
    const phase = upgradeProgress?.phase;
    if (phase === "downloading") {
      const { received = 0, total = 0 } = upgradeProgress;
      const percent = total > 0 ? Math.floor((received / total) * 100) : null;
      const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
      return percent === null
        ? `Downloading… ${mb(received)} MB`
        : `Downloading… ${percent}% (${mb(received)} of ${mb(total)} MB)`;
    }
    if (phase === "verifying") return "Verifying the download…";
    if (phase === "installing") return "Installing…";
    if (phase === "ready" || phase === "restarting") return "Restarting QMail…";
    return "Checking for the latest version…";
  };

  const renderUpToDateModal = () =>
    upToDateInfo ? (
      <div className="update-modal__overlay" role="presentation">
        <section
          className="update-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qmail-uptodate-title"
        >
          <header className="update-modal__header">
            <CheckCircle size={48} className="update-modal__icon" />
            <h2 id="qmail-uptodate-title">QMail Is Up to Date</h2>
            <button
              type="button"
              className="update-modal__close"
              onClick={() => setUpToDateInfo(null)}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </header>
          <div className="update-modal__content">
            <p className="update-modal__description">
              You are running the latest version for this platform (
              {formatBuildDateForDisplay(upToDateInfo.current_version)}).
            </p>
          </div>
          <div className="update-modal__actions">
            <button
              type="button"
              className="update-modal__later-button"
              onClick={() => setUpToDateInfo(null)}
            >
              Close
            </button>
          </div>
        </section>
      </div>
    ) : null;

  const renderUpgradeModal = () =>
    showUpgradeModal ? (
      <div className="update-modal__overlay" role="presentation">
        <section
          className="update-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qmail-upgrade-title"
        >
          <header className="update-modal__header">
            <Download size={48} className="update-modal__icon" />
            <h2 id="qmail-upgrade-title">Upgrade QMail</h2>
            <button
              type="button"
              className="update-modal__close"
              onClick={() => setShowUpgradeModal(false)}
              aria-label="Close upgrade instructions"
            >
              <X size={20} />
            </button>
          </header>

          <div className="update-modal__content">
            {upgradeFailureMessage && (
              <p className="update-modal__upgrade-failure">
                {upgradeFailureMessage}
              </p>
            )}
            {upgradeFailureDetail && (
              <code className="update-modal__failure-detail">
                {upgradeFailureDetail}
                {" — also saved to upgrade.log next to QMail"}
              </code>
            )}
            <p className="update-modal__upgrade-instructions">
              Download the executable for your operating system{" "}
              <button
                type="button"
                className="update-modal__inline-link"
                onClick={openDownloadPage}
              >
                here
              </button>
              , close QMail, and then copy the executable over your current one
              located here:
            </p>
            <code className="update-modal__executable-path">
              {upgradeExecutablePath || "QMail executable path unavailable"}
            </code>
          </div>

          <div className="update-modal__actions">
            {upgradeFailureMessage &&
              upgradeSupport?.supported &&
              updateAvailable?.update_available && (
                <button
                  type="button"
                  className="update-modal__download-button"
                  onClick={handleRetryUpgrade}
                >
                  Try Again
                </button>
              )}
            <button
              type="button"
              className="update-modal__download-button"
              onClick={openDownloadPage}
            >
              <Download size={20} />
              Open Download Page
            </button>
            <button
              type="button"
              className="update-modal__later-button"
              onClick={() => setShowUpgradeModal(false)}
            >
              Close
            </button>
          </div>
        </section>
      </div>
    ) : null;

  // FIX-03: After a successful first-run locker import,
  // ServiceSelectionScreen calls onSelectService('provisioning',
  // identity-or-null). We always route post-import to PROVISIONING
  // (WalletSetupScreen) so the user sees the friendly welcome and
  // Heal/Make Change affordances. From there they click
  // "Go to Dashboard" to land on QMAIL.
  //
  // gpt-batch2 #2: the post-import data may be null when identity
  // hasn't registered yet — that's still a valid post-import flow.
  // The previous "if (data)" check conflated "we have data" with
  // "we're in the post-import flow"; using the service argument is
  // the correct signal.
  //
  // Returning users (auto-restore via App.checkIdentity) skip
  // PROVISIONING entirely and go straight to QMAIL.
  const handleSelectService = (service, data = null) => {
    setProvisioningData(data);
    switch (service) {
      case 'provisioning':
      case SERVICES.PROVISIONING:
        setSelectedService(SERVICES.PROVISIONING);
        break;
      case 'qmail':
      case SERVICES.QMAIL:
        setSelectedService(SERVICES.QMAIL);
        break;
      case 'wallet':
      case SERVICES.WALLET:
        setSelectedService(SERVICES.WALLET);
        break;
      default:
        setSelectedService(service);
    }
  };

  const handleSignOut = async () => {
    await shutdownCore();
    if (window.electronAPI?.quitApp) {
      await window.electronAPI.quitApp();
      return;
    }
    setProvisioningData(null);
    setSelectedService(SERVICES.NONE);
  };

  const renderService = () => {
    switch (selectedService) {
      case SERVICES.PROVISIONING:
        // This is the "Wallet Screen" with Heal/Make Change buttons
        return (
          <WalletSetupScreen
            accountData={provisioningData}
            onProceed={() => setSelectedService(SERVICES.QMAIL)}
          />
        );
      case SERVICES.WALLET:
        return <Wallet />;
      case SERVICES.QMAIL:
        // FIX-03: Thread the normalized identity through so the dashboard
        // can seed userAccount synchronously. The `has_id` fallback path
        // sets provisioningData = null; in that case QMailDashboard will
        // fetch on mount.
        return (
          <QMail
            initialIdentity={provisioningData}
            onSignOut={handleSignOut}
          />
        );
      case SERVICES.NONE:
      default:
        return <ServiceSelectionScreen onSelectService={handleSelectService} />;
    }
  };

  if (!hasAcceptedDisclaimer) {
    return (
      <div className="app-shell">
        {renderUpgradeModal()}
        {renderUpToDateModal()}
        <section
          className="app-shell__disclaimer"
          aria-labelledby="qmail-disclaimer-title"
        >
          <header className="app-shell__disclaimer-header">
            <AlertTriangle size={28} className="app-shell__disclaimer-icon" />
            <h1 id="qmail-disclaimer-title">Disclaimer</h1>
          </header>
          <div className="app-shell__disclaimer-copy">
            {QMAIL_DISCLAIMER_TEXT.split("\n").map((line, index) =>
              line ? <p key={index}>{line}</p> : <br key={index} />,
            )}
          </div>
          <button
            className="app-shell__disclaimer-accept"
            type="button"
            onClick={() => setHasAcceptedDisclaimer(true)}
          >
            <CheckCircle size={18} />
            <span>Accept</span>
          </button>
        </section>
      </div>
    );
  }
  // Show loading spinner while checking identity / waiting for backend
  if (isLoading) {
    return (
      <div className="app-shell">
        {renderUpgradeModal()}
        {renderUpToDateModal()}
        <div className="app-shell__loading">
          <Loader2 className="app-shell__loading-icon spinning" size={64} />
          <div className="app-shell__loading-message">
            {loadingMessage}
          </div>
        </div>
      </div>
    );
  }

  return (
    <NotificationProvider>
      <div className="app-shell">
        {renderUpgradeModal()}
        {renderUpToDateModal()}
        {/* Update Modal */}
        {showUpdateModal && updateAvailable && (
          <div className="update-modal__overlay">
            <div className="update-modal">
              <div className="update-modal__header">
                <AlertTriangle size={48} className="update-modal__icon" />
                <h2>Update Available</h2>
                {!upgradeBusy && (
                  <button
                    className="update-modal__close"
                    onClick={() => setShowUpdateModal(false)}
                  >
                    <X size={20} />
                  </button>
                )}
              </div>

              <div className="update-modal__content">
                <p className="update-modal__message">{updateAvailable.message}</p>

                <div className="update-modal__version-info">
                  <div className="update-modal__version-row">
                    <span className="update-modal__version-label">Current Version:</span>
                    <span className="update-modal__version-value">
                      {formatBuildDateForDisplay(updateAvailable.current_version)}
                    </span>
                  </div>
                  <div className="update-modal__version-row">
                    <span className="update-modal__version-label">Latest Version:</span>
                    <span className="update-modal__version-value update-modal__version-value--highlight">
                      {formatBuildDateForDisplay(updateAvailable.latest_version)}
                    </span>
                  </div>
                </div>

                {upgradeProgress?.phase === "installed-prompt" ? (
                  <p className="update-modal__description">
                    The new version is installed. Restart QMail now to start
                    using it? If you are writing a message or a transfer is
                    still running, choose Later and restart when you are
                    done — the update is already in place.
                  </p>
                ) : upgradeProgress?.phase === "installed" ? (
                  <p className="update-modal__description">
                    The new version is installed, but QMail could not restart
                    itself. Close QMail and start it again to finish the
                    upgrade.
                  </p>
                ) : upgradeBusy ? (
                  <div className="update-modal__progress">
                    <p className="update-modal__description">
                      {upgradePhaseLabel()}
                    </p>
                    {upgradeProgress?.phase === "downloading" &&
                      upgradeProgress.total > 0 && (
                        <div
                          className="update-modal__progress-track"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.floor(
                            (upgradeProgress.received / upgradeProgress.total) *
                              100,
                          )}
                        >
                          <div
                            className="update-modal__progress-fill"
                            style={{
                              width: `${Math.floor(
                                (upgradeProgress.received /
                                  upgradeProgress.total) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                      )}
                  </div>
                ) : (
                  <p className="update-modal__description">
                    {upgradeSupport?.supported
                      ? "Click Upgrade Now and QMail will download the new version, verify it, install it over the current program, and restart. Your wallets and mail are not touched."
                      : "A new version of QMail is available. Click below to open the downloads page in your browser, then download and install the latest version."}
                  </p>
                )}
              </div>

              <div className="update-modal__actions">
                {upgradeProgress?.phase === "installed-prompt" ? (
                  <>
                    <button
                      className="update-modal__download-button"
                      onClick={handleRestartNow}
                    >
                      Restart Now
                    </button>
                    <button
                      className="update-modal__later-button"
                      onClick={handleRestartLater}
                    >
                      Later
                    </button>
                  </>
                ) : upgradeProgress?.phase === "installed" ? (
                  <button
                    className="update-modal__download-button"
                    onClick={() => window.electronAPI?.quitApp?.()}
                  >
                    Close QMail
                  </button>
                ) : upgradeBusy ? (
                  upgradeProgress?.phase === "downloading" && (
                    <button
                      className="update-modal__later-button"
                      onClick={handleCancelUpgrade}
                    >
                      Cancel
                    </button>
                  )
                ) : (
                  <>
                    {upgradeSupport?.supported ? (
                      <button
                        className="update-modal__download-button"
                        onClick={handleUpgradeNow}
                      >
                        <Download size={20} />
                        Upgrade Now
                      </button>
                    ) : (
                      <button
                        className="update-modal__download-button"
                        onClick={handleDownload}
                      >
                        <Download size={20} />
                        Download Update
                      </button>
                    )}
                    {upgradeSupport?.supported && (
                      <button
                        className="update-modal__later-button"
                        onClick={openDownloadPage}
                      >
                        Open Download Page
                      </button>
                    )}
                    <button
                      className="update-modal__later-button"
                      onClick={() => setShowUpdateModal(false)}
                    >
                      Remind Me Later
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {renderService()}
        {showSoundPrompt && (
          <div className="app-shell__sound-prompt-overlay" role="presentation">
            <section
              className="app-shell__sound-prompt"
              role="dialog"
              aria-modal="true"
              aria-labelledby="qmail-sound-prompt-title"
            >
              <header className="app-shell__sound-prompt-header">
                <AlertTriangle size={22} className="app-shell__sound-prompt-icon" />
                <h2 id="qmail-sound-prompt-title">Enable QMail Sounds</h2>
                <button
                  type="button"
                  className="app-shell__sound-prompt-close"
                  onClick={() => setShowSoundPrompt(false)}
                  aria-label="Close sound prompt"
                >
                  <X size={18} />
                </button>
              </header>
              <p>
                QMail tried to play an alert sound, but audio playback is
                currently blocked. Click Enable Sounds to allow message alerts
                and preview sounds in this window.
              </p>
              <div className="app-shell__sound-prompt-actions">
                <button
                  type="button"
                  className="app-shell__sound-prompt-enable"
                  onClick={handleEnableSounds}
                >
                  Enable Sounds
                </button>
                <button
                  type="button"
                  className="app-shell__sound-prompt-dismiss"
                  onClick={() => setShowSoundPrompt(false)}
                >
                  Not Now
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
      <NotificationContainer />
    </NotificationProvider>
  );
}

export default App;
