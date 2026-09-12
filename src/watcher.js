import JSONbigFactory from 'json-bigint';
import { isOfficialRefereeMessage, REFEREE_DID } from './verify.js';
import { getLastRoomSeq, saveReceipt, setLastRoomSeq } from './store.js';

const JSONbig = JSONbigFactory({ storeAsString: true });
const ROOM = 'mb-sonnet-2-registration';
const BASE = `https://technocore.chat/r/${ROOM}`;

let running = false;
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
  if (!message || message.from !== REFEREE_DID) return;
  if (!isOfficialRefereeMessage(message)) return;

  const receipt = normalizeReceipt(message);
  if (receipt) await saveReceipt(receipt);
}

async function processMessages(messages) {
  const ordered = [...messages].sort((a, b) => Number(a.seq) - Number(b.seq));
  for (const message of ordered) await processMessage(message);
}

async function bootstrapFromExport() {
  const response = await fetch(`${BASE}/export`, {
    headers: { 'user-agent': 'sonnet-registration-status/0.1' },
  });
  if (!response.ok) throw new Error(`export HTTP ${response.status}`);

  const raw = await response.text();
  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSONbig.parse(line));
    } catch {
      // Ignore a malformed retained line rather than failing the watcher.
    }
  }

  await processMessages(messages);
  const maxSeq = messages.reduce((max, m) => Math.max(max, Number(m.seq) || 0), 0);
  if (maxSeq) await setLastRoomSeq(maxSeq);
}

async function pollOnce() {
  const since = getLastRoomSeq();
  const nonce = Date.now();
  const url = `${BASE}?format=json&since=${since}&limit=200&wait=10&n=${nonce}`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'sonnet-registration-status/0.1' },
  });
  if (!response.ok) throw new Error(`room HTTP ${response.status}`);

  const raw = await response.text();
  const view = JSONbig.parse(raw);
  const messages = Array.isArray(view.messages) ? view.messages : [];

  const firstSeq = view.first_seq == null ? null : Number(view.first_seq);
  if (firstSeq != null && firstSeq > since + 1) {
    await bootstrapFromExport();
    return;
  }

  await processMessages(messages);
  const lastSeq = Number(view.last_seq || since);
  if (lastSeq > since) await setLastRoomSeq(lastSeq);
}

export async function startWatcher() {
  if (running) return;
  running = true;
  startedAt = new Date().toISOString();

  try {
    await bootstrapFromExport();
  } catch (error) {
    lastError = String(error?.message || error);
  }

  while (running) {
    try {
      lastPollAt = new Date().toISOString();
      await pollOnce();
      lastError = null;
    } catch (error) {
      lastError = String(error?.message || error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export function watcherStatus() {
  return { running, startedAt, lastPollAt, lastError, room: ROOM };
}
