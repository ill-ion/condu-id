/**
 * Server DID document — `/<slug>/.well-known/did.json`.
 *
 * This route is the entire point of having Condu.ID under the .id TLD:
 * it's how `did:web:condu.id:<slug>` resolves. A DID resolver constructs
 * the URL `https://condu.id/<slug>/.well-known/did.json` and expects to
 * receive the JSON-LD DID document.
 *
 * We proxy the upstream resolver. The API does the database lookup; we
 * pass through the body verbatim with the right MIME type and a short
 * edge cache.
 */

import type { APIContext } from "astro";
import { api, ApiClientError } from "@lib/api/client";

export const prerender = false;

export async function GET(ctx: APIContext): Promise<Response> {
  const { slug } = ctx.params as { slug: string };
  if (!slug) return notFound("missing slug");

  // Reserved top-level paths — never treat them as server slugs. Astro
  // route precedence usually handles this, but we belt-and-brace.
  if (RESERVED.has(slug)) return notFound("reserved path");

  try {
    const doc = await api.getServerDID(slug);
    // Surface deactivation as 410 Gone, per the DID method spec.
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
    if (e instanceof ApiClientError) {
      if (e.status === 404) return notFound(`server ${slug} not found`);
      if (e.status === 410) {
        return new Response(
          JSON.stringify({
            error: { code: "gone", message: e.message },
          }),
          { status: 410, headers: didHeaders() }
        );
      }
    }
    return new Response(
      JSON.stringify({
        error: { code: "internal", message: "resolver unavailable" },
      }),
      { status: 502, headers: didHeaders() }
    );
  }
}

const RESERVED = new Set([
  "servers",
  "agents",
  "receipts",
  "anchors",
  "about",
  "api",
  "_astro",
  "favicon.ico",
  "robots.txt",
  ".well-known",
]);

function didHeaders(): HeadersInit {
  return {
    "Content-Type": "application/did+ld+json; charset=utf-8",
    // Short edge cache: identity changes rarely, but we don't want to
    // keep a stale doc for hours. Stale-while-revalidate gives us
    // smooth refreshes when the upstream record updates.
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
