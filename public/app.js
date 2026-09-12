const form = document.querySelector('#watch-form');
const input = document.querySelector('#request-id');
const result = document.querySelector('#result');
const controls = document.querySelector('#controls');
const stopButton = document.querySelector('#stop-button');
const startButton = document.querySelector('#start-button');

let currentRequestId = null;
let pollTimer = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortDid(did) {
  if (!did || did.length < 16) return did || '—';
  return `${did.slice(0, 12)}…${did.slice(-6)}`;
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  stopPolling();
  pollTimer = setTimeout(checkWatch, 2000);
}

function renderWatching(status) {
  result.className = 'result neutral';
  result.innerHTML = `
    <div class="status-line">
      <span class="dot pulse"></span>
      <strong>WATCHING</strong>
    </div>
    <p>Waiting for the official referee receipt for <code>${esc(status.requestId)}</code>.</p>
    <p class="muted">This keeps running in the background while this server is running. No timeout is imposed.</p>`;
  controls.classList.remove('hidden');
}

function renderStopped() {
  result.className = 'result neutral';
  result.innerHTML = `
    <div class="status-line">
      <span class="dot"></span>
      <strong>STOPPED</strong>
    </div>
    <p>The watcher was stopped manually.</p>`;
  controls.classList.add('hidden');
}

function renderReceipt(receipt) {
  const status = receipt.status || 'unknown';
  const tone = status === 'accepted' ? 'ok' : status === 'rejected' ? 'bad' : 'neutral';
  result.className = `result ${tone}`;
  result.innerHTML = `
    <div class="receipt ${tone}">
      <div class="status-line">
        <span class="dot"></span>
        <strong>${esc(status.toUpperCase())}</strong>
        <span class="verified">Verified referee receipt</span>
      </div>
      <dl>
        <div><dt>Request ID</dt><dd>${esc(receipt.requestId)}</dd></div>
        <div><dt>DID</dt><dd title="${esc(receipt.participantDid)}">${esc(shortDid(receipt.participantDid))}</dd></div>
        <div><dt>Role</dt><dd>${esc(receipt.role || '—')}</dd></div>
        <div><dt>Referee signature</dt><dd>${receipt.signatureVerified ? 'Verified' : 'Not verified'}</dd></div>
        <div><dt>Room seq</dt><dd>${esc(receipt.roomSeq ?? '—')}</dd></div>
        <div><dt>Intake seq</dt><dd>${esc(receipt.intakeSeq ?? '—')}</dd></div>
        ${receipt.reason ? `<div><dt>Reason</dt><dd>${esc(receipt.reason)}</dd></div>` : ''}
      </dl>
    </div>`;
  controls.classList.add('hidden');
}

async function checkWatch() {
  if (!currentRequestId) return;

  try {
    const response = await fetch(`/api/watch?request_id=${encodeURIComponent(currentRequestId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    if (data.state === 'found' && data.receipt) {
      stopPolling();
      renderReceipt(data.receipt);
      return;
    }

    if (data.state === 'watching') {
      renderWatching(data);
      schedulePoll();
      return;
    }

    stopPolling();
    renderStopped();
  } catch (error) {
    result.className = 'result bad';
    result.innerHTML = `<strong>Watch check failed</strong><p>${esc(error.message)}</p>`;
    schedulePoll();
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const requestId = input.value.trim();
  if (!requestId) return;

  stopPolling();
  currentRequestId = requestId;
  startButton.disabled = true;
  result.className = 'result loading';
  result.textContent = 'Starting watch…';

  try {
    const response = await fetch(`/api/watch/start?request_id=${encodeURIComponent(requestId)}`, {
      method: 'POST',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    if (data.state === 'found' && data.receipt) {
      renderReceipt(data.receipt);
      return;
    }

    renderWatching(data);
    schedulePoll();
  } catch (error) {
    result.className = 'result bad';
    result.innerHTML = `<strong>Could not start watcher</strong><p>${esc(error.message)}</p>`;
    controls.classList.add('hidden');
  } finally {
    startButton.disabled = false;
  }
});

stopButton.addEventListener('click', async () => {
  if (!currentRequestId) return;
  stopPolling();
  stopButton.disabled = true;

  try {
    const response = await fetch(`/api/watch/stop?request_id=${encodeURIComponent(currentRequestId)}`, {
      method: 'POST',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    if (data.state === 'found' && data.receipt) renderReceipt(data.receipt);
    else renderStopped();
  } catch (error) {
    result.className = 'result bad';
    result.innerHTML = `<strong>Could not stop watcher</strong><p>${esc(error.message)}</p>`;
  } finally {
    stopButton.disabled = false;
  }
});
