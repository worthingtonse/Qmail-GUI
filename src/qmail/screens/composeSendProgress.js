// Send-progress presentation helpers, split out of ComposeModal so the
// component file exports only the component (react-refresh) and so the
// banding rules are unit-testable on their own.

// Core reuses the SAME 0-100 band for both phases of a send, so the bar
// climbs to ~90% while staging stripes to disk, resets to ~5% when the
// network upload begins, then climbs again. That is expected, not a bug.
// The only way to tell the phases apart is the task `message`, so map it to
// a short label and show it beside the bar - otherwise a reset looks like
// the send restarted. Unrecognized messages pass through verbatim.
const SEND_PHASE_LABELS = [
  { match: "staging attachment stripes", label: "Staging…" },
  { match: "uploading object-transfer stripes", label: "Uploading…" },
];

export const describeSendPhase = (message) => {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "Processing...";
  const lowered = text.toLowerCase();
  const phase = SEND_PHASE_LABELS.find((entry) => lowered.includes(entry.match));
  return phase ? phase.label : text;
};

// Because both phases reuse the same 0-100 band, showing the raw percentage
// makes the bar jump backwards at the staging->network handoff. Map each
// phase into its own half instead - staging fills 0-50, uploading fills
// 50-100 - so one send reads as a single sweep left to right.
//
// An unrecognized message means we cannot tell which phase we are in, so the
// raw value is passed through untouched rather than guessed at; the caller's
// monotonic clamp still prevents any visible regression.
const SEND_PHASE_BANDS = {
  "Staging…": { start: 0, span: 50 },
  "Uploading…": { start: 50, span: 50 },
};

export const scaleSendProgress = (rawProgress, phaseLabel) => {
  const raw = Number(rawProgress);
  const safe = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  const band = SEND_PHASE_BANDS[phaseLabel];
  if (!band) return safe;
  return Math.round(band.start + (safe * band.span) / 100);
};


// --- Per-phase / per-server progress -------------------------------------
// Core emits a structured `data` payload on the send task:
//   { phase: "staging"|"uploading", stage_percent, upload_percent,
//     servers: [{ raida_id, percent, completed_bytes, total_bytes,
//                 retries, state, ok }] }
// Byte counts arrive as decimal STRINGS so they survive
// Number.MAX_SAFE_INTEGER at 160 GB scale - they are kept as strings here
// and only converted for display.

const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
};

/**
 * Read the structured phase payload from a task-status result.
 * Returns null when the backend does not supply it (older core), which
 * lets the UI fall back to the single combined bar.
 */
export const readPhaseProgress = (taskData) => {
  const data = taskData?.result;
  if (!data || typeof data !== "object") return null;
  if (typeof data.phase !== "string") return null;

  const servers = Array.isArray(data.servers)
    ? data.servers.map((entry) => ({
        raidaId: Number(entry?.raida_id),
        percent: clampPercent(entry?.percent),
        // strings, deliberately - see note above
        completedBytes: String(entry?.completed_bytes ?? "0"),
        totalBytes: String(entry?.total_bytes ?? "0"),
        retries: Number(entry?.retries) || 0,
        state: typeof entry?.state === "string" ? entry.state : "",
        ok: entry?.ok === true,
      }))
    : [];

  return {
    phase: data.phase,
    stagePercent: clampPercent(data.stage_percent),
    uploadPercent: clampPercent(data.upload_percent),
    fileIndex: Number(data.file_index) || 0,
    fileCount: Number(data.file_count) || 0,
    servers,
  };
};
