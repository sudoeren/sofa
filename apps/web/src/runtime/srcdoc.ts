import type { Theme } from "@sofa/shared";
import tokensCss from "../styles/tokens.css?raw";
import sdkSource from "./sdk.js?raw";

/**
 * Policy of every tool document. No network at all: scripts and styles only inline,
 * images, media and fonts only from data/blob URLs, no connections, forms or <base>.
 * `webrtc 'block'` closes peer connections where the browser knows the directive and is
 * ignored elsewhere. Navigation of the frame itself is not something a document's own CSP
 * can forbid; see docs/tool-sandbox.md.
 */
export const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; " +
  "form-action 'none'; base-uri 'none'; webrtc 'block'";

export const NONCE_PLACEHOLDER = "__SOFA_NONCE__";

const RESET_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light;background:var(--surface);overflow-x:auto;overflow-y:hidden}
html[data-theme="dark"]{color-scheme:dark}
html[data-sofa-scroll]{overflow-y:auto}
body{margin:0;font-family:var(--font);font-size:14px;line-height:1.45;color:var(--text);-webkit-text-size-adjust:100%}
button,input,select,textarea{font:inherit;color:inherit}
img,svg,canvas,video{max-width:100%}
`;

/** Tokens for both themes (the text of styles/tokens.css, not a copy) plus a small reset. */
export const FRAME_BASE_CSS = `${tokensCss}\n${RESET_CSS}`.replace(/<\/style/gi, "");

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Text that is safe inside a script element: it cannot close it or open a comment. */
function inlineScript(source: string): string {
  return source.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type SrcdocOptions = {
  theme: Theme;
  /** per-load secret the SDK presents on the private channel; see session.ts */
  nonce?: string;
};

/**
 * Build the document for a tool frame. Pure: same input, same output.
 *
 * The generated HTML is never spliced into: it is parsed (inert, with DOMParser) and the
 * output is written from scratch as
 *
 *   <!doctype html><html ...><head>
 *     [CSP meta] [referrer meta] [base stylesheet] [SDK script]
 *     [the tool's own head content]
 *   </head>[the tool's body]</html>
 *
 * so the CSP is the first element of the document whatever the input starts with, and
 * the SDK runs before any tool script. From the tool's HTML this removes every <base>
 * and every <meta http-equiv> (refresh, a CSP of its own, anything else: none of them has
 * a use in a tool, and matching on the attribute name avoids guessing at encoded values).
 * Removal covers what is in the markup; script can still create such elements later,
 * where base-uri stops <base> and a refresh counts as a navigation, which the host
 * detects (ToolFrame).
 */
export function buildSrcdoc(html: string, options: SrcdocOptions): string {
  const theme: Theme = options.theme === "dark" ? "dark" : "light";
  const nonce = /^[A-Za-z0-9]{1,128}$/.test(options.nonce ?? "") ? (options.nonce as string) : "";
  const sdk = inlineScript(sdkSource.split(NONCE_PLACEHOLDER).join(nonce));

  let htmlAttrs = "";
  let head = "";
  let body = "";
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
    for (const el of Array.from(parsed.querySelectorAll("base, meta[http-equiv]"))) el.remove();
    for (const attr of Array.from(parsed.documentElement.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "data-theme" || name === "data-sofa-scroll") continue;
      if (!/^[a-z_][a-z0-9_.:-]*$/.test(name)) continue;
      htmlAttrs += ` ${name}="${escapeAttr(attr.value)}"`;
    }
    head = parsed.head?.innerHTML ?? "";
    body = parsed.body?.outerHTML ?? "";
  } else {
    // No parser (not a browser): best effort on the text. The HTML parser merges a second
    // doctype, <html> and <head> into the ones written below.
    body = String(html ?? "")
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "");
  }

  return (
    `<!doctype html><html data-theme="${theme}"${htmlAttrs}><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` +
    `<meta charset="utf-8"><meta name="referrer" content="no-referrer">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${FRAME_BASE_CSS}</style>` +
    `<script>${sdk}</script>` +
    `${head}</head>${body}</html>`
  );
}
