import JSONbigFactory from 'json-bigint';
import { isOfficialRefereeMessage, REFEREE_DID } from './verify.js';
import { findByRequestId, findByDid, saveReceipt } from './store.js';

const JSONbig = JSONbigFactory({ storeAsString: true });
const BASE = 'https://technocore.chat/r';
const REGISTRATION_ROOM = 'mb-sonnet-2-registration';
const DID_RE = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const activeWatches = new Map();
const roomState = new Map();

function watchKey(room, requestId) {
  return `${room}::${requestId}`;
}

function cleanRequestId(requestId) {
  const value = String(requestId || '').trim();
  if (!value || value.length > 200) throw new Error('invalid_request_id');
  return value;
}

function cleanDid(did) {
  const value = String(did || '').trim();
  if (!DID_RE.test(value)) throw new Error('invalid_ed25519_did');
  return value;
}

function cleanRoom(room) {
  const value = String(room || '').trim();
  const allowed = value === REGISTRATION_ROOM
    || value === 'mb-sonnet-2-discovery'
    || /^d-sonnet-2-team-[a-z0-9][a-z0-9_-]{0,15}$/.test(value);
  if (!allowed) throw new Error('invalid_or_unsupported_room');
  return value;
}

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

function normalizeReceipt(room, message) {
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
  const participantDid = deepFind(payload, ['participant_did', 'sender_did', 'did']) || null;
  const role = deepFind(payload, ['role']) || null;
  const reason = deepFind(payload, ['reason', 'reason_code', 'error']) || null;
  const intakeSeq = deepFind(payload, ['intake_seq']) || null;
  const action = deepFind(payload, ['action', 'request_type', 'kind']) || null;
  const gameId = deepFind(payload, ['game_id']) || null;
  const poemRoom = deepFind(payload, ['poem_room']) || null;
  const roomGeneration = deepFind(payload, ['room_generation']) || null;
  const version = deepFind(payload, ['version', 'next_version', 'accepted_version']) || null;
  const stateHash = deepFind(payload, ['state_hash', 'next_state_hash', 'accepted_state_hash']) || null;

  return {
    room,
    requestId: String(requestId),
    participantDid: participantDid ? String(participantDid) : null,
    role: role ? String(role) : null,
    status,
    reason: reason ? String(reason) : null,
    intakeSeq: intakeSeq == null ? null : String(intakeSeq),
    action: action ? String(action) : null,
    gameId: gameId ? String(gameId) : null,
    poemRoom: poemRoom ? String(poemRoom) : null,
    roomGeneration: roomGeneration == null ? null : String(roomGeneration),
    version: version == null ? null : String(version),
    stateHash: stateHash ? String(stateHash) : null,
    roomSeq: Number(message.seq),
    roomTimestamp: message.ts || null,
    refereeDid: REFEREE_DID,
    signatureVerified: true,
    receipt: payload,
  };
}

function normalizeRegistration(message, did) {
  if (!message || message.from !== did) return null;

  let payload;
  try {
    payload = JSON.parse(message.text);
  } catch {
    return null;
  }

  if (payload?.type !== 'sonnet.register.v1' || payload?.contest_id !== 'sonnet-2') return null;
  if (!payload.request_id) return null;

  return {
    did,
    requestId: String(payload.request_id),
    role: payload.role ? String(payload.role) : null,
    xAccountUrl: payload.x_account_url ? String(payload.x_account_url) : null,
    roomSeq: Number(message.seq),
    roomTimestamp: message.ts || null,
  };
}

function preferredDidReceipt(receipts) {
  if (!receipts.length) return null;
  return receipts.find((receipt) => receipt.status === 'accepted') || receipts[0];
}

async function processMessage(room, message) {
  if (!message || message.from !== REFEREE_DID) return false;

  const candidate = normalizeReceipt(room, message);
  if (!candidate) return false;

  const key = watchKey(room, candidate.requestId);
  if (!activeWatches.has(key)) return false;
  if (!isOfficialRefereeMessage(room, message)) return false;

  await saveReceipt(candidate);
  activeWatches.delete(key);
  return true;
}

async function processMessages(room, messages) {
  const ordered = [...messages].sort((a, b) => Number(a.seq) - Number(b.seq));
  for (const message of ordered) await processMessage(room, message);
}

function getRoomState(room) {
  if (!roomState.has(room)) {
    roomState.set(room, {
      cursor: 0,
      running: false,
      loopPromise: null,
      startedAt: null,
      lastPollAt: null,
      lastError: null,
    });
  }
  return roomState.get(room);
}

function hasActiveWatchForRoom(room) {
  for (const watch of activeWatches.values()) {
    if (watch.room === room) return true;
  }
  return false;
}

async function readExport(room) {
  const response = await fetch(`${BASE}/${room}/export`, {
    headers: { 'user-agent': 'sonnet-receipt-watcher/0.4' },
  });
  if (!response.ok) throw new Error(`export HTTP ${response.status}`);

  const raw = await response.text();
  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSONbig.parse(line));
    } catch {
      // Ignore malformed retained lines rather than stopping the watch.
    }
  }
  return messages;
}

async function resyncFromExport(room) {
  const state = getRoomState(room);
  const messages = await readExport(room);
  await processMessages(room, messages);
  const maxSeq = messages.reduce((max, message) => Math.max(max, Number(message.seq) || 0), 0);
  if (maxSeq > state.cursor) state.cursor = maxSeq;
}

async function pollOnce(room) {
  const state = getRoomState(room);
  const since = state.cursor;
  const cacheBuster = Date.now();
  const url = `${BASE}/${room}?format=json&since=${since}&limit=200&wait=10&n=${cacheBuster}`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'sonnet-receipt-watcher/0.4' },
  });
  if (!response.ok) throw new Error(`room HTTP ${response.status}`);

  const raw = await response.text();
  const view = JSONbig.parse(raw);
  const messages = Array.isArray(view.messages) ? view.messages : [];
  const firstSeq = view.first_seq == null ? null : Number(view.first_seq);

  if (firstSeq != null && firstSeq > since + 1) {
    await resyncFromExport(room);
    return;
  }

  await processMessages(room, messages);
  const lastSeq = Number(view.last_seq || since);
  if (lastSeq > state.cursor) state.cursor = lastSeq;
}

async function runLoop(room) {
  const state = getRoomState(room);
  state.running = true;
  state.startedAt = new Date().toISOString();

  try {
    while (hasActiveWatchForRoom(room)) {
      try {
        state.lastPollAt = new Date().toISOString();
        await pollOnce(room);
        state.lastError = null;
      } catch (error) {
        state.lastError = String(error?.message || error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } finally {
    state.running = false;
    state.loopPromise = null;
    if (hasActiveWatchForRoom(room)) queueMicrotask(() => ensureLoop(room));
  }
}

function ensureLoop(room) {
  const state = getRoomState(room);
  if (!state.loopPromise) {
    state.loopPromise = runLoop(room).catch((error) => {
      state.lastError = String(error?.message || error);
    });
  }
}

export async function startWatch(roomInput, requestIdInput) {
  const room = cleanRoom(roomInput);
  const requestId = cleanRequestId(requestIdInput);
  const existing = findByRequestId(requestId, room);
  if (existing) return watchStatus(room, requestId);

  const key = watchKey(room, requestId);
  if (!activeWatches.has(key)) {
    activeWatches.set(key, {
      room,
      requestId,
      startedAt: new Date().toISOString(),
    });
  }

  const state = getRoomState(room);
  try {
    await resyncFromExport(room);
    state.lastError = null;
  } catch (error) {
    state.lastError = String(error?.message || error);
  }

  if (activeWatches.has(key)) ensureLoop(room);
  return watchStatus(room, requestId);
}

export async function startRegistrationWatchByDid(didInput) {
  const did = cleanDid(didInput);

  const stored = preferredDidReceipt(findByDid(did));
  if (stored) {
    return {
      room: REGISTRATION_ROOM,
      did,
      requestId: stored.requestId,
      state: 'found',
      watching: false,
      registration: null,
      receipt: stored,
      resolvedFromDid: true,
    };
  }

  const messages = await readExport(REGISTRATION_ROOM);
  const ordered = [...messages].sort((a, b) => Number(a.seq) - Number(b.seq));
  const registrations = ordered
    .map((message) => normalizeRegistration(message, did))
    .filter(Boolean);

  // A retained receipt can still identify the DID even if its original registration
  // message has already fallen out of the rolling room history.
  for (const message of ordered) {
    if (message?.from !== REFEREE_DID) continue;
    const candidate = normalizeReceipt(REGISTRATION_ROOM, message);
    if (!candidate || candidate.participantDid !== did) continue;
    if (!isOfficialRefereeMessage(REGISTRATION_ROOM, message)) continue;
    await saveReceipt(candidate);
  }

  const directReceipt = preferredDidReceipt(findByDid(did));
  if (directReceipt) {
    return {
      room: REGISTRATION_ROOM,
      did,
      requestId: directReceipt.requestId,
      state: 'found',
      watching: false,
      registration: registrations.at(-1) || null,
      receipt: directReceipt,
      resolvedFromDid: true,
    };
  }

  if (!registrations.length) {
    return {
      room: REGISTRATION_ROOM,
      did,
      requestId: null,
      state: 'not_found',
      watching: false,
      registration: null,
      receipt: null,
      resolvedFromDid: true,
    };
  }

  const registration = registrations.at(-1);

  // Some receipts do not repeat participant_did. Once the DID's registration
  // request_id is known, match and verify the receipt by that request_id.
  for (const message of ordered) {
    if (message?.from !== REFEREE_DID) continue;
    const candidate = normalizeReceipt(REGISTRATION_ROOM, message);
    if (!candidate || candidate.requestId !== registration.requestId) continue;
    if (!isOfficialRefereeMessage(REGISTRATION_ROOM, message)) continue;
    if (!candidate.participantDid) candidate.participantDid = did;
    await saveReceipt(candidate);
  }

  const existing = findByRequestId(registration.requestId, REGISTRATION_ROOM);
  if (existing) {
    return {
      room: REGISTRATION_ROOM,
      did,
      requestId: registration.requestId,
      state: 'found',
      watching: false,
      registration,
      receipt: existing,
      resolvedFromDid: true,
    };
  }

  const status = await startWatch(REGISTRATION_ROOM, registration.requestId);
  return {
    ...status,
    did,
    registration,
    resolvedFromDid: true,
  };
}

export function stopWatch(roomInput, requestIdInput) {
  const room = cleanRoom(roomInput);
  const requestId = cleanRequestId(requestIdInput);
  const key = watchKey(room, requestId);
  const wasWatching = activeWatches.delete(key);
  const receipt = findByRequestId(requestId, room);
  return {
    room,
    requestId,
    state: wasWatching ? 'stopped' : receipt ? 'found' : 'idle',
    receipt,
  };
}

export function watchStatus(roomInput, requestIdInput) {
  const room = cleanRoom(roomInput);
  const requestId = cleanRequestId(requestIdInput);
  const receipt = findByRequestId(requestId, room);
  if (receipt) {
    return { room, requestId, state: 'found', watching: false, receipt };
  }

  const watch = activeWatches.get(watchKey(room, requestId));
  if (watch) {
    return {
      room,
      requestId,
      state: 'watching',
      watching: true,
      startedAt: watch.startedAt,
      receipt: null,
    };
  }

  return { room, requestId, state: 'idle', watching: false, receipt: null };
}

export function watcherStatus() {
  return {
    activeWatchCount: activeWatches.size,
    rooms: [...roomState.entries()].map(([room, state]) => ({
      room,
      running: state.running,
      cursor: state.cursor,
      startedAt: state.startedAt,
      lastPollAt: state.lastPollAt,
      lastError: state.lastError,
    })),
  };
}
