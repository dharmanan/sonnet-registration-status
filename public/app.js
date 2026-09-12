const form = document.querySelector('#lookup-form');
const input = document.querySelector('#lookup');
const label = document.querySelector('#lookup-label');
const result = document.querySelector('#result');
const tabs = [...document.querySelectorAll('.tab')];

let mode = 'request';

function setMode(next) {
  mode = next;
  for (const tab of tabs) tab.classList.toggle('active', tab.dataset.mode === mode);
  if (mode === 'request') {
    label.textContent = 'Request ID';
    input.placeholder = 'kohen-register-1';
  } else {
    label.textContent = 'DID';
    input.placeholder = 'did:key:z6Mk...';
  }
  input.value = '';
  result.className = 'result hidden';
  result.innerHTML = '';
  input.focus();
}

for (const tab of tabs) tab.addEventListener('click', () => setMode(tab.dataset.mode));

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

function statusBlock(receipt) {
  const status = receipt.status || 'unknown';
  const tone = status === 'accepted' ? 'ok' : status === 'rejected' ? 'bad' : 'neutral';
  return `
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
}

function renderNotSeen() {
  result.className = 'result neutral';
  result.innerHTML = `
    <div class="status-line">
      <span class="dot"></span>
      <strong>NOT SEEN YET</strong>
    </div>
    <p>No matching verified official receipt has been archived by this service yet.</p>
    <p class="muted">This does not mean rejected. A missing receipt may simply be delayed or may have been outside this watcher's retained history.</p>`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) return;

  result.className = 'result loading';
  result.textContent = 'Checking…';

  const params = new URLSearchParams();
  if (mode === 'request') params.set('request_id', value);
  else params.set('did', value);

  try {
    const response = await fetch(`/api/status?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    if (!data.officialReceiptFound) return renderNotSeen();

    result.className = 'result';
    if (data.receipt) {
      result.innerHTML = statusBlock(data.receipt);
    } else {
      result.innerHTML = data.receipts.map(statusBlock).join('');
    }
  } catch (error) {
    result.className = 'result bad';
    result.innerHTML = `<strong>Lookup failed</strong><p>${esc(error.message)}</p>`;
  }
});
