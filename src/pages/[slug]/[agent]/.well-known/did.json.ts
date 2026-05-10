/**
 * Agent DID document — `/<slug>/<agent>/.well-known/did.json`.
 *
 * Resolves `did:web:condu.id:<slug>:<agent>` for any agent registered
 * under a server. The API stores agents by a flat slug; we look up via
 * the well-known compound slug `<server_slug>.<agent_localid>` if the
 * upstream uses that scheme, but fall back to the agent slug as-is.
 */

import type { APIContext } from "astro";
import { api, ApiClientError } from "@lib/api/client";

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const { slug, agent } = ctx.params as { slug: string; agent: string };
  if (!slug || !agent) return notFound("missing slug or agent");

  // Try the most-specific shape first: full agent slug as stored.
  // Compound shape on the API: <server-slug>.<agent-local-id>
  const candidates = [`${slug}.${agent}`, agent];

  let lastErr: ApiClientError | null = null;
  for (const candidate of candidates) {
    try {
      const doc = await api.getAgentDID(candidate);
      if ((doc as { deactivated?: boolean }).deactivated === true) {
        return new Response(JSON.stringify(doc, null, 2), {
          status: 410,
          headers: didHeaders(),
        });
      }
      return new Response(JSON.stringify(doc, null, 2), {
        status: 200,
        headers: didHeaders(),
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 404) {
        lastErr = e;
        continue; // try next candidate
      }
      if (e instanceof ApiClientError) {
        return new Response(
          JSON.stringify({ error: { code: e.code, message: e.message } }),
          { status: e.status, headers: didHeaders() }
        );
      }
      return new Response(
        JSON.stringify({
          error: { code: "internal", message: "resolver unavailable" },
        }),
        { status: 502, headers: didHeaders() }
      );
    }
  }
  return notFound(
    lastErr?.message ?? `agent ${slug}/${agent} not found`
  );
}

function didHeaders(): HeadersInit {
  return {
    "Content-Type": "application/did+ld+json; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    "Access-Control-Allow-Origin": "*",
  };
}

function notFound(message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: "not_found", message } }),
    { status: 404, headers: didHeaders() }
  );
}
