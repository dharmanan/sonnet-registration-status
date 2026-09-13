const form = document.querySelector('#watch-form');
const roomSelect = document.querySelector('#room');
const teamRoomWrap = document.querySelector('#team-room-wrap');
const teamRoomInput = document.querySelector('#team-room');
const input = document.querySelector('#request-id');
const result = document.querySelector('#result');
const controls = document.querySelector('#controls');
const stopButton = document.querySelector('#stop-button');
const startButton = document.querySelector('#start-button');
const didInput = document.querySelector('#did-input');
const didButton = document.querySelector('#did-button');
const didSearchWrap = document.querySelector('#did-search-wrap');

let currentRequestId = null;
let currentRoom = null;
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

function selectedRoom() {
  if (roomSelect.value !== 'team') return roomSelect.value;
  return teamRoomInput.value.trim();
}

roomSelect.addEventListener('change', () => {
  teamRoomWrap.classList.toggle('hidden', roomSelect.value !== 'team');
  if (didSearchWrap) didSearchWrap.classList.toggle('hidden', roomSelect.value !== 'mb-sonnet-2-registration');
  if (roomSelect.value === 'team') teamRoomInput.focus();
});

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
    <p>Room: <code>${esc(status.room)}</code></p>
    <p>Request ID: <code>${esc(status.requestId)}</code></p>
    ${status.did ? `<p>DID: <code>${esc(shortDid(status.did))}</code></p>` : ''}
    <p>Waiting for the official referee receipt.</p>
    <p class="muted">No fixed timeout. A missing receipt is not rejection.</p>`;
  controls.classList.remove('hidden');
}

function renderNotFoundByDid(did) {
  result.className = 'result neutral';
  result.innerHTML = `
    <div class="status-line">
      <span class="dot"></span>
      <strong>NOT FOUND IN RETAINED HISTORY</strong>
    </div>
    <p>DID: <code>${esc(shortDid(did))}</code></p>
    <p>No retained registration or verified receipt for this DID was found.</p>
    <p class="muted">This is not proof of rejection. Older room records can fall out of Technocore's rolling history.</p>`;
  controls.classList.add('hidden');
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
        <div><dt>Room</dt><dd>${esc(receipt.room || '—')}</dd></div>
        <div><dt>Request ID</dt><dd>${esc(receipt.requestId)}</dd></div>
        <div><dt>DID</dt><dd title="${esc(receipt.participantDid)}">${esc(shortDid(receipt.participantDid))}</dd></div>
        ${receipt.role ? `<div><dt>Role</dt><dd>${esc(receipt.role)}</dd></div>` : ''}
        ${receipt.action ? `<div><dt>Action</dt><dd>${esc(receipt.action)}</dd></div>` : ''}
        ${receipt.gameId ? `<div><dt>Game ID</dt><dd>${esc(receipt.gameId)}</dd></div>` : ''}
        ${receipt.poemRoom ? `<div><dt>Poem room</dt><dd>${esc(receipt.poemRoom)}</dd></div>` : ''}
        ${receipt.roomGeneration ? `<div><dt>Room generation</dt><dd>${esc(receipt.roomGeneration)}</dd></div>` : ''}
        ${receipt.version ? `<div><dt>Version</dt><dd>${esc(receipt.version)}</dd></div>` : ''}
        ${receipt.stateHash ? `<div><dt>State hash</dt><dd>${esc(receipt.stateHash)}</dd></div>` : ''}
        <div><dt>Referee signature</dt><dd>${receipt.signatureVerified ? 'Verified' : 'Not verified'}</dd></div>
        <div><dt>Room seq</dt><dd>${esc(receipt.roomSeq ?? '—')}</dd></div>
        <div><dt>Intake seq</dt><dd>${esc(receipt.intakeSeq ?? '—')}</dd></div>
        ${receipt.reason ? `<div><dt>Reason</dt><dd>${esc(receipt.reason)}</dd></div>` : ''}
      </dl>
    </div>`;
  controls.classList.add('hidden');
}

function watchParams() {
  return `room=${encodeURIComponent(currentRoom)}&request_id=${encodeURIComponent(currentRequestId)}`;
}

async function checkWatch() {
  if (!currentRequestId || !currentRoom) return;

  try {
    const response = await fetch(`/api/watch?${watchParams()}`);
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
  const room = selectedRoom();
  if (!requestId || !room) return;

  stopPolling();
  currentRequestId = requestId;
  currentRoom = room;
  startButton.disabled = true;
  result.className = 'result loading';
  result.textContent = 'Starting watch…';

  try {
    const response = await fetch(`/api/watch/start?${watchParams()}`, { method: 'POST' });
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

if (didButton) {
  didButton.addEventListener('click', async () => {
    const did = didInput.value.trim();
    if (!did) return;

    stopPolling();
    currentRequestId = null;
    currentRoom = 'mb-sonnet-2-registration';
    didButton.disabled = true;
    result.className = 'result loading';
    result.textContent = 'Searching retained registration history…';

    try {
      const response = await fetch(`/api/watch/start-by-did?did=${encodeURIComponent(did)}`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      if (data.state === 'not_found') {
        renderNotFoundByDid(did);
        return;
      }

      currentRequestId = data.requestId;
      if (data.requestId) input.value = data.requestId;

      if (data.state === 'found' && data.receipt) {
        renderReceipt(data.receipt);
        return;
      }

      if (data.state === 'watching') {
        renderWatching({ ...data, did });
        schedulePoll();
        return;
      }

      renderNotFoundByDid(did);
    } catch (error) {
      result.className = 'result bad';
      result.innerHTML = `<strong>DID lookup failed</strong><p>${esc(error.message)}</p>`;
      controls.classList.add('hidden');
    } finally {
      didButton.disabled = false;
    }
  });
}

stopButton.addEventListener('click', async () => {
  if (!currentRequestId || !currentRoom) return;
  stopPolling();
  stopButton.disabled = true;

  try {
    const response = await fetch(`/api/watch/stop?${watchParams()}`, { method: 'POST' });
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
