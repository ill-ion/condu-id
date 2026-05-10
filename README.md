# condu.id — frontend

Astro + Cloudflare Pages + Anthropic Claude. The consumer-facing site for
[Condu.ID](https://condu.id) — neutral resolver for AI agent identity.

This is the sister project to [`condu-id-api`](../condu-id-api). The API
is the resolver; this is the directory and verifier.

---

## What's in here

```
src/
├─ pages/                  # Astro pages (most are SSR via Cloudflare adapter)
│  ├─ index.astro          # homepage with featured servers + recent receipts
│  ├─ about.astro          # technical brief
│  ├─ servers/             # MCP server directory + detail
│  ├─ agents/              # AI agent directory + detail (with chat)
│  ├─ receipts/            # receipt directory + detail (with verifier)
│  ├─ anchors/             # Solana merkle anchor batches
│  ├─ api/chat/            # POST /api/chat — grounded Claude streaming
│  └─ [slug]/.well-known/  # /<slug>/.well-known/did.json — DID doc proxy
│
├─ components/
│  ├─ AgentChat.tsx        # Preact island: streaming agent Q&A
│  ├─ Verifier.tsx         # Preact island: client-side receipt verifier
│  └─ *.astro              # static UI primitives (cards, pills, def-lists)
│
├─ layouts/Base.astro      # site chrome (header, footer, meta)
│
├─ lib/
│  ├─ api/                 # typed client for api.condu.id
│  ├─ verify/              # client-side RCPT verifier
│  │  ├─ jcs.ts            # RFC 8785 (matches Go reference byte-for-byte)
│  │  ├─ didkey.ts         # base58btc + did:key parser
│  │  ├─ encoding.ts       # signature/hex helpers
│  │  └─ index.ts          # full 5-step verify pipeline
│  └─ config/
│
└─ styles/global.css       # Tailwind base + editorial component classes
```

## Architecture

The architectural commitment from the build handoff:

> **The browser is authoritative. The server is convenience.**

The verifier widget on `/receipts/:id` re-runs all five checks locally:

1. JCS canonicalization (RFC 8785)
2. Ed25519 signature (RFC 8032 — no SHA-256 pre-hash)
3. Delegation chain (structural in v1)
4. Merkle inclusion proof
5. Solana confirmation — **direct browser → Solana RPC**, no server in the loop

The server's `/v1/receipts/:id/verify` endpoint always returns
`authoritative: false` and `notice: client-must-verify`. The widget on
the page surfaces the same disclaimer.

## Environment variables

| Name | Required | Where | Description |
|---|---|---|---|
| `PUBLIC_API_BASE` | yes | build + runtime | Origin of api.condu.id (e.g. `https://api.condu.id`). Embedded in client bundles. |
| `PUBLIC_SOLANA_CLUSTER` | yes | build + runtime | `devnet` / `testnet` / `mainnet-beta`. Used for explorer URLs. |
| `PUBLIC_SOLANA_RPC` | optional | build + runtime | Override Solana RPC endpoint. Defaults to public clusterApiUrl. |
| `ANTHROPIC_API_KEY` | yes | runtime (server-only) | For `/api/chat`. **Never** exposed to clients. Set as a Cloudflare Pages secret. |

## Local dev

```bash
npm install
cp .env.example .env   # edit values
npm run dev            # serves at http://localhost:4321
```

## Build

```bash
npm run build          # outputs to dist/
npm run preview        # preview the Cloudflare Pages worker locally
```

## Deploy to Cloudflare Pages

1. Push the repo to GitHub (`ill-ion/condu-id`).
2. In the Cloudflare dashboard: Workers & Pages → Create → Connect to Git.
3. Select the repo. Configuration:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** (leave empty)
4. Environment variables (Production):
   - `PUBLIC_API_BASE` = `https://api.condu.id`
   - `PUBLIC_SOLANA_CLUSTER` = `devnet`
   - `ANTHROPIC_API_KEY` = (paste; mark as encrypted)
5. Custom domain: bind `condu.id` and `www.condu.id` to the Pages project.
6. Note: `api.condu.id` is the Go service deployed separately on EC2; do
   NOT point it at Pages.

## DNS

```
condu.id            A     <Cloudflare Pages anycast IP>
www.condu.id        CNAME condu-id.pages.dev
api.condu.id        CNAME <ec2-instance-host>            # API service, separate
```

## Tests

A round-trip self-test of the verifier core is at `test/verify-roundtrip.mjs`:

```bash
node test/verify-roundtrip.mjs
```

It generates an Ed25519 keypair, signs a sample receipt body, and confirms
sign → verify and strip-and-verify both work, including HTML-escape
edge cases (`<`, `>`, `&`).

For cross-implementation verification (TS verifier vs the Go reference
in `condu-id-api`), pull a receipt from the live API and feed both the
TS verifier (open the receipt page in the browser) and the API's
`/v1/receipts/:id/verify` endpoint. Step results should match.

## What's NOT here

- A registry / write API for new identities — that's intentional. Condu.ID
  is a resolver. Identities register by publishing their own DID document
  and getting indexed via the upstream API's sync job.
- A wallet / signing UI — RCPT signing happens in the agent SDK, not in
  this frontend.
- The commercial layer (Conduid marketplace, RCPT Pro chain). Those are
  separate codebases per the architectural separation principle.

## Related

- [`condu-id-api`](../condu-id-api) — the Go resolver this site talks to
- [`rcpt-protocol`](https://github.com/ill-ion/rcpt-protocol) — receipt format spec + SDKs
- [rcptprotocol.com](https://rcptprotocol.com) — protocol home / NIST submission target
