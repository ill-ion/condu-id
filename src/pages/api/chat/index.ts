/**
 * /api/chat — grounded chat about a specific agent.
 *
 * Request:
 *   POST /api/chat
 *   { "agent_slug": "horizon.agent-7f3a",
 *     "messages": [{"role":"user","content":"..."}, ...] }
 *
 * Response: SSE stream of JSON events:
 *   data: {"type":"delta","text":"..."}      // streamed token
 *   data: {"type":"refusal","reason":"..."}  // model declined
 *   data: {"type":"error","message":"..."}   // server-side error
 *   data: [DONE]
 *
 * Why grounded: we fetch the agent's identity record from the API at
 * request time, format it as the system prompt's evidence block, and
 * instruct Claude to refuse anything not derivable from that block. No
 * RAG, no vector store — the agent record is small and definitive.
 */

import type { APIContext } from "astro";
import Anthropic from "@anthropic-ai/sdk";
import { api, ApiClientError } from "@lib/api/client";

export const prerender = false;

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 600;

// System prompt template. Kept short and direct — the agent record
// itself does the heavy lifting.
const SYSTEM_TMPL = (record: string) => `
You are the assistant on Condu.ID's agent profile page. Your job is to
answer questions about THIS SPECIFIC AGENT, using only the facts in the
EVIDENCE block below.

EVIDENCE
${record}
END EVIDENCE

Rules:
1. If the answer is in the evidence, answer directly and cite the relevant
   field (e.g. "according to the parent_did field…"). Be brief.
2. If the answer requires information not in the evidence — including
   anything about the agent's *behavior*, *intent*, *quality*, *trustworthiness*,
   what tools it uses, who built it, or how it compares to other agents —
   reply with EXACTLY this format and nothing else:
   REFUSAL: <one-sentence reason>
3. Do not speculate. Do not guess. Do not make up timestamps, slugs, DIDs,
   or counts. Numbers are exactly what the evidence says.
4. Do not make claims about the agent's safety, alignment, or capabilities.
   Those questions are out of scope; refuse.
5. Be conversational but factual. The reader is a developer or researcher
   inspecting an identity record.
`.trim();

type ChatBody = {
  agent_slug?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
};

export async function POST(ctx: APIContext): Promise<Response> {
  // Anthropic key from Cloudflare runtime env (preferred) or import.meta.env.
  const apiKey =
    ctx.locals.runtime?.env?.ANTHROPIC_API_KEY ??
    import.meta.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return errResp(503, "internal", "ANTHROPIC_API_KEY not configured");
  }

  let body: ChatBody;
  try {
    body = (await ctx.request.json()) as ChatBody;
  } catch {
    return errResp(400, "bad_request", "request body must be JSON");
  }

  if (!body.agent_slug || typeof body.agent_slug !== "string") {
    return errResp(400, "bad_request", "agent_slug is required");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return errResp(400, "bad_request", "messages must be a non-empty array");
  }

  // Cap conversation length to keep prompts cheap.
  const messages = body.messages.slice(-12).map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content.slice(0, 2000) : "",
  }));

  // Fetch the agent record fresh — never cache; we want refusals to be
  // accurate when the underlying record changes.
  let evidenceBlock: string;
  try {
    const agent = await api.getAgent(body.agent_slug);
    evidenceBlock = formatAgentEvidence(agent);
  } catch (e) {
    if (e instanceof ApiClientError && e.notFound) {
      return errResp(404, "not_found", `agent ${body.agent_slug} not found`);
    }
    return errResp(502, "upstream_unavailable", "could not fetch agent record");
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = SYSTEM_TMPL(evidenceBlock);

  // Stream from Anthropic, transcode to our SSE event shape.
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        const sseStream = await client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages,
        });

        let assembled = "";
        for await (const event of sseStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            assembled += event.delta.text;
            // If a refusal token has been emitted, swallow further deltas
            // and emit a single refusal event at end.
            if (!assembled.startsWith("REFUSAL:")) {
              send({ type: "delta", text: event.delta.text });
            }
          }
        }
        // Final disposition.
        if (assembled.startsWith("REFUSAL:")) {
          const reason = assembled.replace(/^REFUSAL:\s*/, "").trim();
          send({ type: "refusal", reason });
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── helpers ────────────────────────────────────────────────────────

function formatAgentEvidence(agent: {
  slug: string;
  did: string;
  parent_did: string;
  server_slug: string;
  local_id?: string;
  name?: string;
  description?: string;
  receipt_count: number;
  first_seen_at: string;
  last_active_at: string | null;
  deactivated: boolean;
  deactivated_at: string | null;
  did_document_url: string;
  created_at: string;
}): string {
  // Plain key=value lines, deterministic order. The model has been told
  // to cite field names, so the structure here is part of the contract.
  const lines: string[] = [];
  lines.push(`field name = ${agent.name ?? "(none)"}`);
  lines.push(`field slug = ${agent.slug}`);
  lines.push(`field did = ${agent.did}`);
  lines.push(`field parent_did = ${agent.parent_did}`);
  lines.push(`field server_slug = ${agent.server_slug}`);
  lines.push(`field local_id = ${agent.local_id ?? "(unset)"}`);
  lines.push(
    `field description = ${agent.description ? agent.description : "(none provided)"}`
  );
  lines.push(`field receipt_count = ${agent.receipt_count}`);
  lines.push(`field first_seen_at = ${agent.first_seen_at}`);
  lines.push(`field last_active_at = ${agent.last_active_at ?? "(never)"}`);
  lines.push(`field deactivated = ${agent.deactivated}`);
  lines.push(
    `field deactivated_at = ${agent.deactivated_at ?? "(not deactivated)"}`
  );
  lines.push(`field did_document_url = ${agent.did_document_url}`);
  lines.push(`field created_at = ${agent.created_at}`);
  return lines.join("\n");
}

function errResp(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}
