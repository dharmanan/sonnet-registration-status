import crypto from 'node:crypto';

const REFEREE_DID = 'did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEX = new Map([...B58].map((c, i) => [c, i]));

function b58decode(raw) {
  let n = 0n;
  for (const ch of raw) {
    const digit = B58_INDEX.get(ch);
    if (digit == null) throw new Error('invalid base58btc');
    n = n * 58n + BigInt(digit);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let body = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
  const leading = raw.length - raw.replace(/^1+/, '').length;
  if (leading) body = Buffer.concat([Buffer.alloc(leading), body]);
  return body;
}

function publicKeyBytesFromDid(did) {
  if (!did.startsWith('did:key:z')) throw new Error('unsupported did');
  const decoded = b58decode(did.slice('did:key:z'.length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('not ed25519-pub did:key');
  }
  return decoded.subarray(2);
}

function ed25519Spki(raw32) {
  return Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw32,
  ]);
}

export function verifyRoomMessageSignature({ room, from, nonce, text, sig }) {
  if (!room || !from || !nonce || !text || !sig) return false;
  try {
    const key = crypto.createPublicKey({
      key: ed25519Spki(publicKeyBytesFromDid(from)),
      format: 'der',
      type: 'spki',
    });
    const signature = Buffer.from(`${sig}==`, 'base64url');
    const message = Buffer.from(`${room}|${nonce}|${text}`, 'utf8');
    return crypto.verify(null, message, key, signature);
  } catch {
    return false;
  }
}

export function isOfficialRefereeMessage(room, message) {
  return message?.from === REFEREE_DID && verifyRoomMessageSignature({
    room,
    from: message.from,
    nonce: String(message.nonce ?? ''),
    text: message.text,
    sig: message.sig,
  });
}

export { REFEREE_DID };
