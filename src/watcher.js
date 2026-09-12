import JSONbigFactory from 'json-bigint';
import { isOfficialRefereeMessage, REFEREE_DID } from './verify.js';
import { findByRequestId, saveReceipt } from './store.js';

const JSONbig = JSONbigFactory({ storeAsString: true });
const ROOM = 'mb-sonnet-2-registration';
const BASE = `https://technocore.chat/r/${ROOM}`;

const activeWatches = new Map();
let running = false;
let loopPromise = null;
let cursor = 0;
let lastError = null;
let lastPollAt = null;
let startedAt = null;

function deepFind(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = deepFind(value, keys);
      if (found != null) return found;
    }
  }
  return null;
}

function normalizeReceipt(message) {
  let payload;
  try {
    payload = JSON.parse(message.text);
  } catch {
    return null;
  }

  if (payload?.type !== 'sonnet.receipt.v1') return null;
  if (payload?.contest_id && payload.contest_id !== 'sonnet-2') return null;

  const requestId = deepFind(payload, ['request_id']);
  if (!requestId) return null;

  const statusRaw = String(deepFind(payload, ['status']) || '').toLowerCase();
  const status = statusRaw === 'accepted' || statusRaw === 'rejected' ? statusRaw : 'unknown';
  const participantDid = deepFind(payload, ['participant_did', 'did']) || null;
  const role = deepFind(payload, ['role']) || null;
  const reason = deepFind(payload, ['reason', 'reason_code', 'error']) || null;
  const intakeSeq = deepFind(payload, ['intake_seq']) || null;

  return {
    requestId: String(requestId),
    participantDid: participantDid ? String(participantDid) : null,
    role: role ? String(role) : null,
    status,
    reason: reason ? String(reason) : null,
    intakeSeq: intakeSeq == null ? null : String(intakeSeq),
    roomSeq: Number(message.seq),
    roomTimestamp: message.ts || null,
    refereeDid: REFEREE_DID,
    signatureVerified: true,
    receipt: payload,
  };
}

async function processMessage(message) {
  if (!message || message.from !== REFEREE_DID) return false;

  const candidate = normalizeReceipt(message);
  if (!candidate || !activeWatches.has(candidate.requestId)) return false;

  if (!isOfficialRefereeMessage(message)) return false;

  await saveReceipt(candidate);
  activeWatches.delete(candidate.requestId);
  return true;
}

async function processMessages(messages) {
  const ordered = [...messages].sort((a, b) => Number(a.seq) - Number(b.seq));
  for (const message of ordered) await processMessage(message);
}

async function readExport() {
  const response = await fetch(`${BASE}/export`, {
    headers: { 'user-agent': 'sonnet-registration-status/0.2' },
  });
  if (!response.ok) throw new Error(`export HTTP ${response.status}`);

  const raw = await response.text();
  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSONbig.parse(line));
    } catch {
      // Ignore a malformed retained line instead of stopping the watch.
    }
  }
  return messages;
}

async function resyncFromExport() {
  const messages = await readExport();
  await processMessages(messages);
  const maxSeq = messages.reduce((max, message) => Math.max(max, Number(message.seq) || 0), 0);
  if (maxSeq > cursor) cursor = maxSeq;
}

async function pollOnce() {
  const since = cursor;
  const cacheBuster = Date.now();
  const url = `${BASE}?format=json&since=${since}&limit=200&wait=10&n=${cacheBuster}`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'sonnet-registration-status/0.2' },
  });
  if (!response.ok) throw new Error(`room HTTP ${response.status}`);

  const raw = await response.text();
  const view = JSONbig.parse(raw);
  const messages = Array.isArray(view.messages) ? view.messages : [];
  const firstSeq = view.first_seq == null ? null : Number(view.first_seq);

  if (firstSeq != null && firstSeq > since + 1) {
    await resyncFromExport();
    return;
  }

  await processMessages(messages);
  const lastSeq = Number(view.last_seq || since);
  if (lastSeq > cursor) cursor = lastSeq;
}

async function runLoop() {
  running = true;
  startedAt = new Date().toISOString();

  try {
    while (activeWatches.size > 0) {
      try {
        lastPollAt = new Date().toISOString();
        await pollOnce();
        lastError = null;
      } catch (error) {
        lastError = String(error?.message || error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } finally {
    running = false;
    loopPromise = null;
    if (activeWatches.size > 0) queueMicrotask(ensureLoop);
  }
}

function ensureLoop() {
  if (!loopPromise) {
    loopPromise = runLoop().catch((error) => {
      lastError = String(error?.message || error);
    });
  }
}

function cleanRequestId(requestId) {
  const value = String(requestId || '').trim();
  if (!value || value.length > 200) throw new Error('invalid_request_id');
  return value;
}

export async function startWatch(requestId) {
  const id = cleanRequestId(requestId);

  if (findByRequestId(id)) return watchStatus(id);
  if (!activeWatches.has(id)) {
    activeWatches.set(id, {
      requestId: id,
      startedAt: new Date().toISOString(),
    });
  }

  try {
    await resyncFromExport();
    lastError = null;
  } catch (error) {
    lastError = String(error?.message || error);
  }

  if (activeWatches.has(id)) ensureLoop();
  return watchStatus(id);
}

export function stopWatch(requestId) {
  const id = cleanRequestId(requestId);
  const wasWatching = activeWatches.delete(id);
  return {
    requestId: id,
    state: wasWatching ? 'stopped' : findByRequestId(id) ? 'found' : 'idle',
    receipt: findByRequestId(id),
  };
}

export function watchStatus(requestId) {
  const id = cleanRequestId(requestId);
  const receipt = findByRequestId(id);
  if (receipt) {
    return {
      requestId: id,
      state: 'found',
      watching: false,
      receipt,
    };
  }

  const watch = activeWatches.get(id);
  if (watch) {
    return {
      requestId: id,
      state: 'watching',
      watching: true,
      startedAt: watch.startedAt,
      receipt: null,
    };
  }

  return {
    requestId: id,
    state: 'idle',
    watching: false,
    receipt: null,
  };
}

export function watcherStatus() {
  return {
    running,
    activeWatchCount: activeWatches.size,
    startedAt,
    lastPollAt,
    lastError,
    room: ROOM,
  };
}
