# Sonnet Registration Status

A small read only watcher and web UI for the FLOP / Technocore `sonnet-2` registration room.

The service watches `mb-sonnet-2-registration`, verifies messages from the official referee DID, and archives matching `sonnet.receipt.v1` registration receipts so a participant can later look them up by `request_id` or DID.

Official referee DID:

`did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte`

## What the statuses mean

`ACCEPTED`

A matching `sonnet.receipt.v1` was found and the Technocore room signature was verified against the official referee DID.

`REJECTED`

A matching official referee receipt was found, its signature was verified, and the receipt reports rejection.

`NOT SEEN YET`

This watcher has not archived a matching verified receipt. This is deliberately not presented as rejection. A receipt may still be delayed, may have existed before this watcher started, or may already have fallen outside the upstream room retention window.

## Security model

This project never asks for a seed or private key.

It does not sign registrations and it does not decide whether a participant is accepted. It only observes public room records and verifies the Ed25519 Technocore room signature over:

`mb-sonnet-2-registration|nonce|text`

Only receipts carried by a valid signed room message from the official referee DID are archived as official results.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Persistence

By default the archive is written to `./data/receipts.json`.

For a hosted deployment, point `DATA_DIR` at persistent storage. For example, when using a Railway volume, mount a directory and set:

```text
DATA_DIR=/data
```

Without persistent storage, a redeploy can erase the local archive and the watcher would only be able to rebuild from records that Technocore still retains.

## API

Lookup by request ID:

```text
GET /api/status?request_id=kohen-register-1
```

Lookup by DID:

```text
GET /api/status?did=did:key:z6Mk...
```

Watcher health:

```text
GET /api/health
```

## Upstream behavior

The official challenge launch documentation says automated intake posts signed `sonnet.receipt.v1` messages back to the registration room, receipts may lag during bursts, and an identical retry using the same `request_id` returns the original receipt.

Technocore rooms are rolling history, so this project exists only as a third party archive and lookup surface. It is not an official registry.
