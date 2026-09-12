import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'receipts.json');

let state = {
  updatedAt: null,
  lastRoomSeq: 0,
  receipts: {},
};

export async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') state = { ...state, ...parsed };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return state;
}

async function persist() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, DATA_FILE);
}

export function getLastRoomSeq() {
  return Number(state.lastRoomSeq || 0);
}

export async function setLastRoomSeq(seq) {
  if (Number.isInteger(seq) && seq > getLastRoomSeq()) {
    state.lastRoomSeq = seq;
    state.updatedAt = new Date().toISOString();
    await persist();
  }
}

export async function saveReceipt(record) {
  if (!record?.requestId) return false;

  const previous = state.receipts[record.requestId];
  state.receipts[record.requestId] = {
    ...(previous || {}),
    ...record,
    firstSeenAt: previous?.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  await persist();
  return true;
}

export function findByRequestId(requestId) {
  return state.receipts[String(requestId || '').trim()] || null;
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
    lastRoomSeq: getLastRoomSeq(),
    updatedAt: state.updatedAt,
  };
}
