# web-primitives

Small, dependency-free building blocks for web back ends, written in plain JavaScript (ES modules) for Node.js. Every module is hand-written, commented line by line, and covered by tests that run on Node's built-in test runner. There is no `node_modules` folder and no build step.

These modules were extracted from a larger production web application. The application itself (routes, data layer, administration area, deployment) is not part of this repository.

## Modules

| Module | What it does |
| --- | --- |
| `src/html.js` | Tagged-template HTML rendering that escapes every value by default (`html`), plus guards for URLs (`safeUrl`) and redirect targets (`safeBack`). |
| `src/markdown.js` | Markdown to HTML for untrusted input. Raw HTML is never passed through, only `http` and `https` links are emitted, and every regular expression is bounded so hostile input cannot cause catastrophic backtracking. |
| `src/csv.js` | RFC 4180 reader and writer with delimiter detection, row limits and readable error messages. The writer defuses cells that a spreadsheet would run as formulas. |
| `src/zip.js` | Minimal ZIP writer (deflate, CRC-32). Entry names are restricted to plain file names so an archive cannot write outside its folder. |
| `src/atom.js` | Atom 1.0 (RFC 4287) feed builder from plain data. Every value is XML-escaped and characters XML 1.0 forbids are removed, so a hostile title cannot break the feed or inject markup. |
| `src/prompt-template.js` | Helpers for sharing text prompts: pick the prompt out of a Markdown post (first code block, else the whole text), list its `{{NAME}}` and `[placeholder]` variables (deduplicated, capped, links and checkboxes ignored), fill them in, and build length-checked "open in a chat site" links. |
| `src/validate.js` | Username, password and numeric-id rules. |
| `src/netutil.js` | Public-address test for IPv4 and IPv6 (a building block for server-side request forgery protection) and IP parsing into numbers. |
| `src/crypto.js` | AES-256-GCM encryption with authenticated data, Argon2id password hashing through Node's built-in `crypto.argon2` with a cap on parallel hashes, HKDF-derived purpose keys, recovery codes, constant-time comparison, CSRF tokens and signed form tokens. |
| `src/session.js` | Server-side sessions. The cookie holds a random 256-bit token and the store holds only its SHA-256. Sessions have a sliding idle limit and an absolute lifetime, and all of one user's sessions can be revoked together. |
| `src/kv.js` | A Redis-protocol (RESP2) client written from scratch: TCP and TLS, `AUTH`, `SELECT`, `MULTI`/`EXEC`, automatic reconnection and fail-fast behaviour while disconnected. It includes an in-process drop-in replacement for development and tests. |
| `src/ratelimit.js` | A fixed-window counter shared through the key-value store (one atomic script, and it fails closed when the store is unreachable) and an in-process per-address token bucket. |
| `src/config.js` | The few environment settings the modules above read. In production a missing or development-grade secret stops startup. |

## Running the tests

Requires Node.js 24.7 or newer (`crypto.argon2` is built in from that version).

```
npm test
```

The tests need no database or server: they use the in-process key-value store, and the network client is tested against a small fake Redis server defined inside the test file. Expiry behaviour is tested with a controlled clock, so the run takes a few seconds.

## License

No license is granted. All rights reserved.
