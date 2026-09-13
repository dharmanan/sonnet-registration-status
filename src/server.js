import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findByRequestId, findByDid, loadStore, publicStats } from './store.js';
import { startRegistrationWatchByDid, startWatch, stopWatch, watchStatus, watcherStatus } from './watcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_ROOM = 'mb-sonnet-2-registration';

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function publicReceipt(receipt) {
  if (!receipt) return null;
  return {
    room: receipt.room,
    requestId: receipt.requestId,
    participantDid: receipt.participantDid,
    role: receipt.role,
    status: receipt.status,
    reason: receipt.reason,
    intakeSeq: receipt.intakeSeq,
    roomSeq: receipt.roomSeq,
    roomTimestamp: receipt.roomTimestamp,
    refereeDid: receipt.refereeDid,
    signatureVerified: receipt.signatureVerified === true,
    action: receipt.action,
    gameId: receipt.gameId,
    poemRoom: receipt.poemRoom,
    roomGeneration: receipt.roomGeneration,
    version: receipt.version,
    stateHash: receipt.stateHash,
    firstSeenAt: receipt.firstSeenAt,
    lastSeenAt: receipt.lastSeenAt,
  };
}

function roomFrom(url) {
  return url.searchParams.get('room')?.trim() || DEFAULT_ROOM;
}

async function serveStatic(res, filename, contentType) {
  try {
    const body = await fs.readFile(path.join(PUBLIC_DIR, filename));
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

await loadStore();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, contestId: 'sonnet-2', watcher: watcherStatus(), store: publicStats() });
  }

  if (req.method === 'GET' && url.pathname === '/api/watch') {
    const requestId = url.searchParams.get('request_id')?.trim();
    const room = roomFrom(url);
    if (!requestId) return json(res, 400, { error: 'request_id_required' });
    try {
      const status = watchStatus(room, requestId);
      return json(res, 200, { ...status, receipt: publicReceipt(status.receipt) });
    } catch (error) {
      return json(res, 400, { error: String(error?.message || error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/watch/start') {
    const requestId = url.searchParams.get('request_id')?.trim();
    const room = roomFrom(url);
    if (!requestId) return json(res, 400, { error: 'request_id_required' });
    try {
      const status = await startWatch(room, requestId);
      return json(res, 200, { ...status, receipt: publicReceipt(status.receipt) });
    } catch (error) {
      return json(res, 400, { error: String(error?.message || error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/watch/start-by-did') {
    const did = url.searchParams.get('did')?.trim();
    if (!did) return json(res, 400, { error: 'did_required' });
    try {
      const status = await startRegistrationWatchByDid(did);
      return json(res, 200, { ...status, receipt: publicReceipt(status.receipt) });
    } catch (error) {
      return json(res, 400, { error: String(error?.message || error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/watch/stop') {
    const requestId = url.searchParams.get('request_id')?.trim();
    const room = roomFrom(url);
    if (!requestId) return json(res, 400, { error: 'request_id_required' });
    try {
      const status = stopWatch(room, requestId);
      return json(res, 200, { ...status, receipt: publicReceipt(status.receipt) });
    } catch (error) {
      return json(res, 400, { error: String(error?.message || error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const requestId = url.searchParams.get('request_id')?.trim();
    const did = url.searchParams.get('did')?.trim();
    const room = roomFrom(url);
    if (!requestId && !did) return json(res, 400, { error: 'request_id_or_did_required' });

    if (requestId) {
      const receipt = findByRequestId(requestId, room);
      return json(res, 200, {
        query: { room, requestId },
        state: receipt ? receipt.status : 'not_seen_yet',
        officialReceiptFound: Boolean(receipt),
        receipt: publicReceipt(receipt),
        note: receipt ? 'Status comes from a cryptographically verified official referee receipt.' : 'No matching verified receipt has been archived by this watcher yet. This does not mean rejected.',
      });
    }

    const receipts = findByDid(did).map(publicReceipt);
    return json(res, 200, {
      query: { did },
      state: receipts.length ? 'receipts_found' : 'not_seen_yet',
      officialReceiptFound: receipts.length > 0,
      receipts,
      note: receipts.length ? 'Only cryptographically verified official referee receipts are shown.' : 'No matching verified receipt has been archived by this watcher yet. This does not mean rejected.',
    });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveStatic(res, 'index.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/app.js') return serveStatic(res, 'app.js', 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/styles.css') return serveStatic(res, 'styles.css', 'text/css; charset=utf-8');

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`sonnet receipt watcher listening on :${PORT}`);
});
