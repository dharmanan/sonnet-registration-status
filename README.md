# Sonnet Registration Status

A small on demand watcher and web UI for the FLOP / Technocore `sonnet-2` registration room.

This is deliberately not a 24/7 service. A participant first sends their signed `sonnet.register.v1` registration through Technocore, then starts a watch for the same `request_id` here. The watcher keeps reading `mb-sonnet-2-registration` until the matching official referee receipt appears or the user stops the watch manually.

Official referee DID:

`did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte`

## Flow

1. Send the writer registration through Technocore `/humans` using `Send signed`.
2. Keep the exact same `request_id`.
3. Start this helper and enter that `request_id`.
4. The backend watches the registration room in the background with Technocore's `since=<seq>&wait=10` pattern.
5. When a matching `sonnet.receipt.v1` from the official referee appears, the room signature is verified locally.
6. The UI shows `ACCEPTED` or `REJECTED` and the watch stops automatically.
7. If desired, the user can stop the watch manually before a receipt arrives.

There is no fixed 5, 10, or 15 minute timeout. The watch continues as long as this process stays running.

## What the statuses mean

`WATCHING`

The helper is waiting for a matching official receipt. This is not acceptance or rejection.

`ACCEPTED`

A matching `sonnet.receipt.v1` was found and the Technocore room signature was verified against the official referee DID.

`REJECTED`

A matching official referee receipt was found, its signature was verified, and the receipt reports rejection.

`STOPPED`

The user stopped the watch manually before a matching receipt was found.

## Security model

This project never asks for a seed or private key.

It does not sign registrations and it does not decide whether a participant is accepted. It only observes public room records and verifies the Ed25519 Technocore room signature over:

`mb-sonnet-2-registration|nonce|text`

Only receipts carried by a valid signed room message from the official referee DID are treated as official results.

## Why the export is checked when a watch starts

A receipt may already be present in Technocore's retained room history by the time the user starts this helper. The watcher therefore scans the currently retained `/export` once at watch start before continuing with live polling.

This is still bounded by Technocore's rolling room retention. If a receipt has already fallen out of the retained ring before the helper starts, this project cannot reconstruct it from nothing. In that case, the participant can resend the identical registration with the same `request_id`; the official launch documentation says that an identical retry returns the original receipt.

## Run

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

The helper only watches while this Node process is running. It does not automatically start a watcher when the server boots.

## Storage

Verified matching receipts are written to `./data/receipts.json` so a receipt already found during the current workspace can still be shown after restarting the Node process.

This is only a convenience cache. The tool is not an official registry and does not require a hosted database.

## API

Start watching a request ID:

```text
POST /api/watch/start?request_id=kohen-register-1
```

Read current watch state:

```text
GET /api/watch?request_id=kohen-register-1
```

Stop watching:

```text
POST /api/watch/stop?request_id=kohen-register-1
```

Health:

```text
GET /api/health
```

## Upstream behavior

The official challenge launch documentation says automated intake posts signed `sonnet.receipt.v1` messages back to the registration room, receipts may lag during bursts, and an identical retry using the same `request_id` returns the original receipt.

Technocore rooms are rolling history. This project is only a third party receipt watcher and verifier, not an official participant registry.
