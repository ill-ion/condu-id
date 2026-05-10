/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

import type {
  Receipt,
  VerifyResult,
  VerifyStep,
  VerifyStepStatus,
} from "@lib/api/types";
import { verifyReceiptLocal } from "@lib/verify";

interface Props {
  receipt: Receipt;
  /** Solana cluster for confirmation. Defaults to receipt.anchor.cluster. */
  cluster?: "devnet" | "testnet" | "mainnet" | "mainnet-beta";
  /** Optional Solana RPC override. */
  rpcEndpoint?: string;
}

const STEP_ORDER: Array<keyof VerifyResult["steps"]> = [
  "canonicalization_jcs",
  "signature_ed25519",
  "delegation_chain",
  "merkle_proof",
  "solana_confirmation",
];

const STEP_LABEL: Record<keyof VerifyResult["steps"], string> = {
  canonicalization_jcs: "JCS canonicalization",
  signature_ed25519: "Ed25519 signature",
  delegation_chain: "Delegation chain",
  merkle_proof: "Merkle inclusion",
  solana_confirmation: "Solana confirmation",
};

const STEP_DESC: Record<keyof VerifyResult["steps"], string> = {
  canonicalization_jcs:
    "Re-encode the receipt body via RFC 8785 and confirm it matches the bytes that were signed.",
  signature_ed25519:
    "Recover the signer's Ed25519 public key from did:key, verify the signature over the canonical bytes.",
  delegation_chain:
    "If a delegation block is present, walk the chain and verify each link's signature.",
  merkle_proof:
    "Hash the receipt, walk the proof's siblings, confirm the computed root matches the stored root.",
  solana_confirmation:
    "Query a public Solana RPC directly for the transaction signature and require a finalized confirmation.",
};

export default function Verifier(props: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [progress, setProgress] = useState<keyof VerifyResult["steps"] | null>(
    null
  );
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setErr(null);

    // Animate the step indicator while the verify runs. Total run time
    // for a sub-second receipt verification is dominated by the Solana
    // RPC call, so we step through the static checks visually first.
    for (const k of STEP_ORDER) {
      setProgress(k);
      await sleep(180);
    }

    try {
      const r = await verifyReceiptLocal(props.receipt, {
        cluster: props.cluster,
        rpcEndpoint: props.rpcEndpoint,
      });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  // Auto-run on mount — the page exists to show this.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div class="border border-rule">
      <header class="px-5 py-4 border-b border-rule flex items-center justify-between gap-4">
        <div>
          <div class="label mb-1">Local verification</div>
          <h3 class="font-serif text-lg leading-tight">
            Browser-side, recomputed from raw bytes
          </h3>
        </div>
        <div class="flex items-center gap-3">
          {result && <OverallBadge overall={result.overall} />}
          <button
            class="btn-ghost text-sm"
            onClick={run}
            disabled={running}
          >
            {running ? "Verifying…" : "Re-run"}
          </button>
        </div>
      </header>

      <div class="divide-y divide-rule">
        {STEP_ORDER.map((k) => {
          const step = result?.steps[k];
          const isCurrent = progress === k && running;
          return (
            <StepRow
              key={k}
              label={STEP_LABEL[k]}
              description={STEP_DESC[k]}
              step={step}
              running={isCurrent}
            />
          );
        })}
      </div>

      <footer class="px-5 py-3 border-t border-rule bg-paper-dark/40 text-xs text-ink-muted font-sans flex items-center justify-between gap-3">
        <div>
          <span class="font-mono text-ink-soft">authoritative=false</span>
          <span class="px-2">·</span>
          <span class="italic">notice: client-must-verify</span>
        </div>
        {result && (
          <div>checked at {new Date(result.checked_at).toLocaleTimeString()}</div>
        )}
      </footer>

      {err && (
        <div class="border-t border-rule px-5 py-3 text-sm text-fail bg-fail-soft font-sans">
          {err}
        </div>
      )}
    </div>
  );
}

function StepRow(props: {
  label: string;
  description: string;
  step?: VerifyStep;
  running: boolean;
}) {
  const status = props.step?.status;
  const dotColor = !status
    ? props.running
      ? "bg-warn animate-pulse"
      : "bg-ink-faint"
    : status === "pass"
    ? "bg-accent"
    : status === "fail"
    ? "bg-fail"
    : status === "skipped"
    ? "bg-warn"
    : "bg-ink-faint";
  const statusLabel =
    !status
      ? props.running
        ? "Computing…"
        : "Pending"
      : labelFor(status);

  return (
    <div class="px-5 py-4 flex gap-4 items-start">
      <span
        class={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full ${dotColor}`}
        aria-hidden="true"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-3">
          <div class="font-serif text-base text-ink">{props.label}</div>
          <div class="text-xs font-sans uppercase tracking-wider text-ink-muted">
            {statusLabel}
          </div>
        </div>
        <p class="text-sm text-ink-muted mt-1 leading-relaxed">
          {props.description}
        </p>
        {props.step?.reason && (
          <p
            class={`text-xs font-mono mt-2 ${
              status === "fail" ? "text-fail" : "text-ink-soft"
            }`}
          >
            {props.step.reason}
          </p>
        )}
        {props.step?.details && Object.keys(props.step.details).length > 0 && (
          <details class="mt-2 text-xs">
            <summary class="cursor-pointer text-ink-muted hover:text-ink font-sans">
              Show details
            </summary>
            <pre class="mt-2 bg-paper-dark px-3 py-2 overflow-auto font-mono text-[11px] leading-relaxed">
              {JSON.stringify(props.step.details, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function OverallBadge({ overall }: { overall: VerifyResult["overall"] }) {
  const cls =
    overall === "pass"
      ? "pill-accent"
      : overall === "fail"
      ? "pill-fail"
      : "pill-warn";
  const label =
    overall === "pass"
      ? "Verified"
      : overall === "fail"
      ? "Failed"
      : overall === "partial"
      ? "Partial"
      : labelFor(overall);
  return <span class={cls}>{label}</span>;
}

function labelFor(s: VerifyStepStatus | "partial"): string {
  return {
    pass: "Pass",
    fail: "Fail",
    skipped: "Skipped",
    not_applicable: "N/A",
    partial: "Partial",
  }[s];
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
