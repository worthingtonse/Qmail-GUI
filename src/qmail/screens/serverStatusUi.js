export const RAIDA_COUNT = 25;

export const formatServerLatency = (latencyMs) => {
  if (latencyMs === null || latencyMs === undefined || latencyMs === "") {
    return "No echo time";
  }

  const n = Number(latencyMs);
  return Number.isFinite(n) ? `${Math.round(n)} ms` : "No echo time";
};

export const serverStatusText = (isOnline) => {
  if (isOnline === true) return "Online";
  if (isOnline === false) return "Offline";
  return "Unknown";
};

export const getQmailServerId = (server, fallbackIndex = 0) =>
  server?.server_id ?? server?.raida_index ?? fallbackIndex;

export const getQmailServerAddress = (server) => {
  const address = server?.ip_address || server?.ip || "unknown address";
  const port = server?.port ? `:${server.port}` : "";
  return `${address}${port}`;
};

export const buildRaidaStatusTitle = (index, isOnline, detail) =>
  `RAIDA ${index}: ${serverStatusText(isOnline)}, ${
    detail ? formatServerLatency(detail.latency_ms) : "No echo time"
  }`;

export const buildQmailStatusTitle = (server, fallbackIndex = 0) => {
  const isOnline = server?.is_available ?? null;
  return `QMail ${getQmailServerId(server, fallbackIndex)}: ${serverStatusText(
    isOnline,
  )}, ${formatServerLatency(server?.latency_ms)}, ${getQmailServerAddress(
    server,
  )}`;
};