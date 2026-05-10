/** @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; refusal?: boolean; pending?: boolean };

interface Props {
  agentSlug: string;
  agentName: string;
  agentDID: string;
}

export default function AgentChat({ agentSlug, agentName, agentDID }: Props) {
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [history]);

  async function send(e: Event) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);

    const userMsg: Msg = { role: "user", text };
    const pendingAssistant: Msg = { role: "assistant", text: "", pending: true };
    setHistory((h) => [...h, userMsg, pendingAssistant]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_slug: agentSlug,
          messages: [...history, userMsg].map((m) => ({
            role: m.role,
            content: m.text,
          })),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const code = errBody?.error?.code ?? "internal";
        const message = errBody?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(`${code}: ${message}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("response has no body");

      const decoder = new TextDecoder();
      let buf = "";
      let assembled = "";
      let refusal = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Parse server-sent events (one event per blank-line-separated chunk).
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const msg = JSON.parse(payload) as
              | { type: "delta"; text: string }
              | { type: "refusal"; reason: string }
              | { type: "error"; message: string };
            if (msg.type === "delta") {
              assembled += msg.text;
              setHistory((h) => {
                const next = [...h];
                next[next.length - 1] = {
                  role: "assistant",
                  text: assembled,
                  pending: true,
                };
                return next;
              });
            } else if (msg.type === "refusal") {
              refusal = true;
              assembled = msg.reason;
            } else if (msg.type === "error") {
              throw new Error(msg.message);
            }
          } catch (parseErr) {
            console.warn("[chat] bad SSE payload:", parseErr);
          }
        }
      }

      setHistory((h) => {
        const next = [...h];
        next[next.length - 1] = {
          role: "assistant",
          text: assembled || "(no answer)",
          refusal,
          pending: false,
        };
        return next;
      });
    } catch (err) {
      setHistory((h) => h.slice(0, -1)); // drop the pending assistant slot
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="border border-rule bg-paper">
      <div
        ref={transcriptRef}
        class="px-4 py-4 max-h-72 overflow-y-auto space-y-4 text-sm"
      >
        {history.length === 0 && (
          <div class="text-ink-muted leading-relaxed">
            <div class="font-mono text-xs mb-2">{agentDID}</div>
            <p>
              Ask about <span class="font-serif text-ink">{agentName}</span> —
              what kind of agent it is, what server hosts it, how many
              receipts it's emitted, whether it's still active.
            </p>
            <p class="mt-2">
              The model is constrained to the facts visible on this page. If
              you ask something it can't ground in the record, it will refuse.
            </p>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} class={m.role === "user" ? "text-ink" : "text-ink-soft"}>
            <div class="label mb-1">
              {m.role === "user"
                ? "You"
                : m.refusal
                ? "Refused"
                : "Assistant"}
            </div>
            <div
              class={
                m.role === "assistant" && m.refusal
                  ? "italic text-warn leading-relaxed"
                  : "leading-relaxed whitespace-pre-wrap"
              }
            >
              {m.text}
              {m.role === "assistant" && m.pending && (
                <span class="inline-block w-1 h-3 ml-1 bg-ink-muted animate-pulse align-text-bottom" />
              )}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div class="border-t border-rule px-4 py-2 text-xs text-fail font-sans bg-fail-soft">
          {error}
        </div>
      )}

      <form class="border-t border-rule flex" onSubmit={send}>
        <input
          type="text"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          disabled={busy}
          placeholder="Ask about this agent…"
          class="flex-1 bg-transparent px-4 py-3 text-sm font-sans focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          class="px-4 py-3 bg-ink text-paper text-sm font-sans tracking-wide disabled:opacity-50"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
