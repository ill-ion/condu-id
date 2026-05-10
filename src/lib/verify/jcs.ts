/**
 * JSON Canonicalization Scheme — RFC 8785.
 *
 * Reference port of internal/verify/verify.go:jcs() in condu-id-api.
 * Both implementations must produce byte-identical output for the
 * receipt shapes that arise in practice (integer + string + boolean
 * + null + nested object/array). Float canonicalization edge cases
 * are not encountered in receipts in v1 — receipts use integer
 * counters and ISO-8601 strings, not non-trivial floats.
 *
 * Design: we walk the parsed JSON tree and emit canonical bytes
 * directly. We do NOT use JSON.stringify with a replacer, because
 * its handling of object-key ordering depends on V8 implementation
 * details that have changed across versions. Explicit walk = stable.
 */

export function jcs(input: unknown): string {
  return encode(input);
}

function encode(v: unknown): string {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return encodeNumber(v);
  if (typeof v === "string") return encodeString(v);
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (let i = 0; i < v.length; i++) parts.push(encode(v[i]));
    return "[" + parts.join(",") + "]";
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort(); // codepoint sort — matches Go's sort.Strings
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(encodeString(k) + ":" + encode(obj[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  // undefined, function, symbol — not valid JSON. Match RFC 8785 by
  // treating undefined as a structural error.
  throw new Error(`jcs: unsupported value type ${typeof v}`);
}

function encodeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error("jcs: non-finite number not allowed by RFC 8785");
  }
  if (Number.isInteger(n)) {
    // Match Go's `%d` integer formatting.
    return String(n);
  }
  // For non-integer floats RFC 8785 specifies the ECMAScript Number
  // toString form, which is what JS native String(n) produces. Receipts
  // don't use floats today; this branch is here for completeness.
  return String(n);
}

function encodeString(s: string): string {
  // Per RFC 8785 §3.2.2.2: minimal escapes, surrogate pairs preserved.
  // CRITICAL: we must match Go's `json.Marshal` default behavior, which
  // ALSO HTML-escapes `<`, `>`, `&` (and U+2028 / U+2029). The Go
  // reference verifier in condu-id-api does not call SetEscapeHTML(false),
  // so its canonical bytes contain these escapes. If we don't escape
  // them here, our canonical output diverges and signatures fail to
  // verify on receipts that contain any of these characters.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0d) out += "\\r";
    else if (c < 0x20) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else if (c === 0x3c || c === 0x3e || c === 0x26) {
      // <, >, & — match Go json.Marshal default HTML-escape.
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else if (c === 0x2028 || c === 0x2029) {
      // U+2028 (line separator), U+2029 (paragraph separator) — Go
      // json.Marshal escapes these so the output is safe to embed in
      // HTML <script> tags. Match.
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else {
      // Codepoints >= 0x20 (and not in the special set above) emit
      // literally. Surrogate pairs (high+low) emit as their JS chars
      // because TextEncoder will UTF-8 encode them correctly downstream.
      out += s[i];
    }
  }
  out += '"';
  return out;
}
