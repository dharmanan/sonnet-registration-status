import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'receipts.json');
const REGISTRATION_ROOM = 'mb-sonnet-2-registration';

let state = {
  updatedAt: null,
  receipts: {},
};

function receiptKey(room, requestId) {
  return `${String(room || '').trim()}::${String(requestId || '').trim()}`;
}

export async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') state = { ...state, ...parsed };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // Migrate the original registration-only format without losing receipts.
  const migrated = {};
  for (const [oldKey, receipt] of Object.entries(state.receipts || {})) {
    if (!receipt || typeof receipt !== 'object') continue;
    const room = receipt.room || REGISTRATION_ROOM;
    const requestId = receipt.requestId || oldKey;
    migrated[receiptKey(room, requestId)] = { ...receipt, room, requestId };
  }
  state.receipts = migrated;

  return state;
}

async function persist() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, DATA_FILE);
}

export async function saveReceipt(record) {
  if (!record?.room || !record?.requestId) return false;

  const key = receiptKey(record.room, record.requestId);
  const previous = state.receipts[key];
  state.receipts[key] = {
    ...(previous || {}),
    ...record,
    firstSeenAt: previous?.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  await persist();
  return true;
}

export function findByRequestId(requestId, room = REGISTRATION_ROOM) {
  return state.receipts[receiptKey(room, requestId)] || null;
}

export function findByDid(did) {
  const target = String(did || '').trim();
  if (!target) return [];
  return Object.values(state.receipts)
    .filter((receipt) => receipt.participantDid === target)
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

export function publicStats() {
  const receipts = Object.values(state.receipts);
  return {
    receiptsStored: receipts.length,
    accepted: receipts.filter((r) => r.status === 'accepted').length,
    rejected: receipts.filter((r) => r.status === 'rejected').length,
    rooms: [...new Set(receipts.map((r) => r.room).filter(Boolean))],
    updatedAt: state.updatedAt,
  };
}
