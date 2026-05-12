/** @jsxImportSource preact */
import { useState } from "preact/hooks";
import type { Receipt } from "@lib/api/types";
import Verifier from "@components/Verifier";

interface Props {
  /** Solana cluster passed through to the underlying Verifier. */
  cluster?: "devnet" | "testnet" | "mainnet" | "mainnet-beta";
  /** Optional Solana RPC override passed through to the Verifier. */
  rpcEndpoint?: string;
}

/**
 * Paste-mode entry into the Verifier. Used when the resolver API is
 * unreachable: the page can't fetch a receipt by id, but the Verifier
 * itself is pure client-side crypto and works fine on any receipt the
 * user pastes in. That is in fact the architectural commitment â€”
 * browser is authoritative, server is convenience.
 */
export default function VerifierPaste(props: Props) {
  const [raw, setRaw] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleVerify() {
    setErr(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setErr("Paste a receipt JSON object first.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      setErr(
        "That doesn't parse as JSON. Paste the full receipt object â€” " +
          "the same shape returned by GET /v1/receipts/{id}."
      );
      return;
    }
    // Minimal shape check. The Verifier itself will fail loudly on
    // anything malformed; this is just to catch the obvious case of
    // someone pasting just the signed body rather than the full
    // resolver envelope.
    const r = parsed as Partial<Receipt>;
    if (
      !r ||
      typeof r !== "object" ||
      typeof (r as Receipt).id !== "string" ||
      !(r as Receipt).receipt ||
      !(r as Receipt).identity
    ) {
      setErr(
        "JSON parsed but doesn't look like a receipt envelope. " +
          "Expected fields: id, receipt, identity. If you only have " +
          "the signed body, wrap it: { id, receipt: <body>, identity: {} }."
      );
      return;
    }
    setReceipt(parsed as Receipt);
  }

  function handleReset() {
    setReceipt(null);
    setErr(null);
  }

  if (receipt) {
    return (
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3 text-xs font-sans">
          <span class="text-ink-muted">
            Verifying pasted receipt{" "}
            <span class="font-mono text-ink-soft">{receipt.id}</span>
          </span>
          <button class="btn-ghost text-xs" onClick={handleReset}>
            Paste another
          </button>
        </div>
        <Verifier
          receipt={receipt}
          cluster={props.cluster ?? receipt.anchor?.cluster}
          rpcEndpoint={props.rpcEndpoint}
        />
      </div>
    );
  }

  return (
    <div class="border border-rule">
      <header class="px-5 py-4 border-b border-rule">
        <div class="label mb-1">Local verification</div>
        <h3 class="font-serif text-lg leading-tight">
          Paste a receipt to verify it in your browser
        </h3>
        <p class="text-sm text-ink-muted mt-2 leading-relaxed">
          The resolver is unreachable right now, so we can't look this
          receipt up by id â€” but the Verifier doesn't need our server.
          Paste any RCPT receipt JSON below and the same five checks will
          run locally: JCS canonicalization, Ed25519, delegation chain,
          Merkle inclusion, Solana confirmation.
        </p>
      </header>

      <div class="px-5 py-4 space-y-3">
        <textarea
          class="w-full h-64 font-mono text-xs bg-paper-dark border border-rule px-3 py-2 leading-relaxed focus:outline-none focus:border-ink-soft"
          placeholder='{ "id": "01K...", "receipt": { "rcpt_version": "0.7", "action_type": "...", "signed_by": "did:key:...", ... }, "identity": { ... }, "anchor": { ... } }'
          value={raw}
          onInput={(e) => setRaw((e.target as HTMLTextAreaElement).value)}
          spellcheck={false}
        />
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-ink-muted font-sans">
            <span class="font-mono">authoritative=false</span>
            <span class="px-2">Â·</span>
            <span class="italic">runs entirely in this tab</span>
          </div>
          <button class="btn text-sm" onClick={handleVerify}>
            Verify locally
          </button>
        </div>
        {err && (
          <div class="text-sm text-fail bg-fail-soft px-3 py-2 font-sans">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
