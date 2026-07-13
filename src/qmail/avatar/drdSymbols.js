/**
 * drdSymbols.js — on-demand DRD symbol lookup cache for cartouche avatars.
 *
 * Users choose two symbols (0-255) stored on their public DRD directory
 * record (first_symbol, second_symbol). Until a local DRD replica exists,
 * the GUI fetches live via getDrdUserProfile, caches results (positive and
 * negative) for 24h, and de-dupes concurrent lookups so an inbox render
 * cannot stampede RAIDA (each get fans out to 25 servers).
 */

import { useState, useEffect } from "react";
import { getDrdUserProfile } from "../../api/qmailApiServices";

/** Positive and negative cache entries are valid for this long. */
export const DRD_SYMBOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Entries written after a FAILED lookup (network error, backend not ready)
 * expire quickly — a transient hiccup during an inbox render must not hide
 * cartouches for a whole day. Only a genuine "not registered" answer earns
 * the full negative TTL.
 */
export const DRD_SYMBOL_ERROR_TTL_MS = 5 * 60 * 1000;

const STORAGE_KEY = "qmail.drd.symbolCache";
const MAX_CONCURRENT_FETCHES = 3;

/** @type {Map<string, { f: number|null, s: number|null, t: number }>} */
const memoryCache = new Map();

/** @type {Map<string, Promise<{ firstSymbol: number, secondSymbol: number }|null>>} */
const inFlight = new Map();

/** Per-key generation; bumped on invalidate so in-flight writes are dropped. */
const writeGeneration = new Map();

/** FIFO of start functions waiting for a free concurrency slot. */
const fetchWaitQueue = [];
let activeFetches = 0;

/** Bumped on invalidate so useDrdSymbols re-resolves. */
let cacheEpoch = 0;
const epochListeners = new Set();

function makeKey(denominationCode, serialNumber) {
  return `${denominationCode}:${serialNumber}`;
}

function normalizeDenomination(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 5) return null;
  return n;
}

function normalizeSerial(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

/**
 * Apply the DRD (0,0) convention: the directory record has no null for
 * symbols — an unset record reads first_symbol=0, second_symbol=0. Treat
 * the pair (0,0) as "not chosen" → null → no cartouche. A single 0 paired
 * with a nonzero is a real choice and renders.
 */
function symbolsFromPair(firstSymbol, secondSymbol) {
  if (firstSymbol == null || secondSymbol == null) return null;
  const f = Number(firstSymbol);
  const s = Number(secondSymbol);
  if (!Number.isInteger(f) || !Number.isInteger(s)) return null;
  if (f < 0 || f > 255 || s < 0 || s > 255) return null;
  // (0,0) convention — see comment above.
  if (f === 0 && s === 0) return null;
  return { firstSymbol: f, secondSymbol: s };
}

function isEntryFresh(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    typeof entry.t === "number" &&
    Date.now() - entry.t <= (entry.ttl ?? DRD_SYMBOL_CACHE_TTL_MS)
  );
}

function loadStorageIntoMemory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [key, entry] of Object.entries(obj)) {
      if (!isEntryFresh(entry)) continue;
      const hydrated = {
        f: entry.f === null || entry.f === undefined ? null : entry.f,
        s: entry.s === null || entry.s === undefined ? null : entry.s,
        t: entry.t,
      };
      if (typeof entry.ttl === "number") hydrated.ttl = entry.ttl;
      memoryCache.set(key, hydrated);
    }
  } catch {
    // Corrupt or unavailable localStorage — memory cache stays empty.
  }
}

function persistMemoryToStorage() {
  try {
    const obj = {};
    for (const [key, entry] of memoryCache.entries()) {
      if (!isEntryFresh(entry)) continue;
      obj[key] = { f: entry.f, s: entry.s, t: entry.t };
      if (typeof entry.ttl === "number") obj[key].ttl = entry.ttl;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Quota / private mode — memory cache still works for this session.
  }
}

loadStorageIntoMemory();

function getCacheEntry(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (!isEntryFresh(entry)) {
    memoryCache.delete(key);
    return null;
  }
  return entry;
}

function writeCacheEntry(key, firstSymbol, secondSymbol, expectedGen, ttl) {
  if (expectedGen !== undefined && currentGen(key) !== expectedGen) {
    return false;
  }
  const entry = { f: firstSymbol, s: secondSymbol, t: Date.now() };
  if (ttl !== undefined) entry.ttl = ttl;
  memoryCache.set(key, entry);
  persistMemoryToStorage();
  return true;
}

function bumpEpoch() {
  cacheEpoch += 1;
  epochListeners.forEach((listener) => {
    try {
      listener(cacheEpoch);
    } catch {
      // Listener errors must not break the cache module.
    }
  });
}

function pumpFetchQueue() {
  while (activeFetches < MAX_CONCURRENT_FETCHES && fetchWaitQueue.length > 0) {
    const start = fetchWaitQueue.shift();
    if (typeof start === "function") start();
  }
}

function currentGen(key) {
  return writeGeneration.get(key) || 0;
}

/**
 * Default cartouche symbols for a user who has NOT chosen any: derived from
 * the address itself. The serial's last two bytes are the symbol indexes —
 * high byte on top, low byte on the bottom (e.g. 23.56@giga → symbol 023
 * over symbol 056). Deterministic, needs no network, and pairs with the
 * serial-derived colors so every valid address renders a cartouche even
 * before (or without) a DRD registration.
 *
 * @returns {{firstSymbol: number, secondSymbol: number} | null}
 */
export function addressDerivedSymbols(serialNumber) {
  const sn = Number(serialNumber);
  if (!Number.isInteger(sn) || sn <= 0 || sn > 0xffffff) return null;
  return { firstSymbol: (sn >> 8) & 0xff, secondSymbol: sn & 0xff };
}

/**
 * Synchronous cache read (memory + localStorage hydration). Applies the
 * (0,0)→null rule. Returns null on miss, expiry, invalid input, or known-null.
 */
export function getCachedDrdSymbols(denominationCode, serialNumber) {
  const den = normalizeDenomination(denominationCode);
  const sn = normalizeSerial(serialNumber);
  if (den === null || sn === null) return null;

  const entry = getCacheEntry(makeKey(den, sn));
  if (!entry) return null;
  return symbolsFromPair(entry.f, entry.s);
}

/**
 * Resolve symbols for a den/sn: cache hit (including negative) returns
 * immediately; otherwise one live getDrdUserProfile, de-duped and rate-limited.
 */
export function resolveDrdSymbols(denominationCode, serialNumber) {
  const den = normalizeDenomination(denominationCode);
  const sn = normalizeSerial(serialNumber);
  if (den === null || sn === null) {
    return Promise.resolve(null);
  }

  const key = makeKey(den, sn);
  const cached = getCacheEntry(key);
  if (cached) {
    return Promise.resolve(symbolsFromPair(cached.f, cached.s));
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const genAtStart = currentGen(key);
  let settle;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });

  const runFetch = async () => {
    activeFetches += 1;
    try {
      // Re-check cache after waiting in the concurrency queue.
      const again = getCacheEntry(key);
      if (again) {
        settle(symbolsFromPair(again.f, again.s));
        return;
      }

      let first = null;
      let second = null;
      let lookupErrored = false;
      try {
        const result = await getDrdUserProfile({
          denomination: den,
          serialNumber: sn,
        });
        if (result?.success && result.data?.registered && result.data?.user) {
          const user = result.data.user;
          first = user.firstSymbol ?? 0;
          second = user.secondSymbol ?? 0;
        } else if (!result?.success) {
          // Backend/network failure — not a real "no symbols" answer.
          lookupErrored = true;
        }
        // registered:false caches as a full-TTL negative (null pair).
      } catch {
        lookupErrored = true;
      }

      writeCacheEntry(
        key,
        first,
        second,
        genAtStart,
        lookupErrored ? DRD_SYMBOL_ERROR_TTL_MS : undefined,
      );
      settle(symbolsFromPair(first, second));
    } finally {
      activeFetches -= 1;
      // Only clear if we are still the shared promise for this key
      // (invalidate may have replaced us with a newer lookup).
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
      pumpFetchQueue();
    }
  };

  inFlight.set(key, promise);

  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    runFetch();
  } else {
    fetchWaitQueue.push(runFetch);
  }

  return promise;
}

/**
 * Drop a den/sn entry so the next resolve re-fetches. Call after the signed-in
 * user saves their DRD profile (symbols may have changed).
 */
export function invalidateDrdSymbols(denominationCode, serialNumber) {
  const den = normalizeDenomination(denominationCode);
  const sn = normalizeSerial(serialNumber);
  if (den === null || sn === null) return;

  const key = makeKey(den, sn);
  writeGeneration.set(key, currentGen(key) + 1);
  memoryCache.delete(key);
  // Drop any shared in-flight promise so the next resolve starts a fresh
  // fetch rather than awaiting a pre-invalidation lookup.
  inFlight.delete(key);
  persistMemoryToStorage();
  bumpEpoch();
}

/**
 * React hook: returns cached symbols immediately (or null), triggers resolve
 * on mount / key change / invalidation, unmount-safe.
 */
export function useDrdSymbols(denominationCode, serialNumber) {
  const [symbols, setSymbols] = useState(() =>
    getCachedDrdSymbols(denominationCode, serialNumber),
  );
  const [epoch, setEpoch] = useState(cacheEpoch);

  useEffect(() => {
    const onEpoch = (nextEpoch) => setEpoch(nextEpoch);
    epochListeners.add(onEpoch);
    return () => {
      epochListeners.delete(onEpoch);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSymbols(getCachedDrdSymbols(denominationCode, serialNumber));

    resolveDrdSymbols(denominationCode, serialNumber).then((result) => {
      if (!cancelled) setSymbols(result);
    });

    return () => {
      cancelled = true;
    };
  }, [denominationCode, serialNumber, epoch]);

  return symbols;
}
