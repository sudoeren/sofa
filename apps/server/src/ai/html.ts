/** Validation of generated tool HTML before it is written into a space document. */

export const MAX_HTML_BYTES = 200 * 1024;

export type HtmlCheck = { ok: boolean; errors: string[]; warnings: string[] };

const EXTERNAL = String.raw`(?:https?:|wss?:|ftp:)?\/\/`;

/** src="https://...", href='//cdn...', el.src = "https://...", also unquoted values. */
const EXTERNAL_ATTR = new RegExp(
  String.raw`(?:^|[\s"'<:.])(src|href|srcset|action|formaction|poster)\s*=\s*(?:"\s*${EXTERNAL}|'\s*${EXTERNAL}|${EXTERNAL})`,
  "i",
);
const SCRIPT_SRC = /<script\b[^>]*\ssrc\s*=/i;
const CSS_URL = new RegExp(String.raw`url\(\s*["']?\s*${EXTERNAL}`, "i");
const CSS_IMPORT = /@import\b/i;
const JS_IMPORT = new RegExp(
  String.raw`(?:\bimport\s*\(\s*|\bimport\s+(?:[^"'()]{0,200}?\sfrom\s*)?|\bimportScripts\s*\(\s*)["'\x60]\s*${EXTERNAL}`,
  "i",
);
const FORBIDDEN_TAGS = /<(iframe|object|embed|base|frame|frameset)\b/i;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i;

const SOFT: Array<[RegExp, string]> = [
  [/\bfetch\s*\(/, "fetch() is blocked in the frame; remove network calls"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest is blocked in the frame; remove network calls"],
  [/\bWebSocket\b/, "WebSocket is blocked in the frame; remove network calls"],
  [/\bEventSource\b/, "EventSource is blocked in the frame; remove network calls"],
  [/\bsendBeacon\b/, "sendBeacon is blocked in the frame; remove network calls"],
  [
    /\b(?:localStorage|sessionStorage)\b/,
    "browser storage is not available; keep shared data in sofa.state",
  ],
  [/\bdocument\.cookie\b/, "cookies are not available in the frame"],
  [
    /(?:^|[^\w.])(?:alert|confirm|prompt)\s*\(/,
    "alert/confirm/prompt are blocked; show messages inside the page",
  ],
  [/\p{Extended_Pictographic}️?/u, "emoji found; use plain text instead"],
];

export function validateToolHtml(html: string): HtmlCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = typeof html === "string" ? html : "";

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_HTML_BYTES) {
    errors.push(
      `The document is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_HTML_BYTES / 1024} KB. Make it smaller.`,
    );
  }
  if (
    !/<html[\s>]/i.test(text) ||
    !/<\/html\s*>/i.test(text) ||
    !/<body[\s>]/i.test(text) ||
    !/<\/body\s*>/i.test(text)
  ) {
    errors.push(
      "The html must be one complete document: <!doctype html>, <html>, <head>, <body> and the closing tags. It looks cut off or partial.",
    );
  }
  if (SCRIPT_SRC.test(text)) {
    errors.push("<script src> is not allowed. Put all JavaScript inline in the document.");
  }
  if (EXTERNAL_ATTR.test(text)) {
    errors.push(
      "External URLs in src/href attributes are not allowed (no CDN scripts, fonts, images, styles or links). Inline everything; draw graphics with CSS, inline SVG or canvas.",
    );
  }
  if (CSS_URL.test(text)) {
    errors.push(
      "External URLs in CSS url() are not allowed. Use data: URIs, gradients or inline SVG.",
    );
  }
  if (CSS_IMPORT.test(text)) {
    errors.push("CSS @import is not allowed. Put all styles inline in the document.");
  }
  if (JS_IMPORT.test(text)) {
    errors.push(
      "Importing JavaScript from a URL is not allowed. Put all code inline in the document.",
    );
  }
  const tag = FORBIDDEN_TAGS.exec(text);
  if (tag) errors.push(`<${tag[1]?.toLowerCase()}> is not allowed inside a tool.`);
  if (META_REFRESH.test(text)) errors.push("<meta http-equiv=refresh> is not allowed.");

  for (const [pattern, message] of SOFT) {
    if (pattern.test(text)) warnings.push(message);
  }
  if (!/\bsofa\s*\./.test(text)) {
    warnings.push("the document never uses the sofa SDK, so nothing is shared between members");
  }

  return { ok: errors.length === 0, errors, warnings };
}
