# Tool sandbox

HTML tools are written by a language model from requests typed by members of a space.
Sofa treats that code as untrusted. This page says what the sandbox stops, how, and what
it does not stop.

## Who is trusted

- The host (whoever runs the server) is trusted.
- Members of a space are people who hold its link (and password, if it has one). They can
  read and change everything in the space, including through the AI. The sandbox does not
  protect a space from its own members.
- Generated tool code is not trusted. It may be wrong, and a member or a pasted material
  could steer the model into writing code that misbehaves. The sandbox limits what such
  code can reach.

Built-in widgets are part of the app and run as normal React components; this page is
about `kind: "html"` tools only.

## What a tool can reach

Only its own shared state, the list of members present (id, name, color), the current
member, and the theme. Nothing else is ever sent to a frame.

## How it is enforced

1. Opaque origin. Each tool runs in `<iframe sandbox="allow-scripts">` loaded from
   `srcdoc`. Without `allow-same-origin` the document has no access to the app's DOM,
   cookies, `localStorage`, or the member's saved AI key, and it cannot use the app's
   credentials. Forms, popups, top-level navigation, modal dialogs and downloads are not
   allowed. Device and capture features are denied with the `allow` attribute.

2. No network. The host parses the generated HTML inertly and rebuilds the document so a
   Content-Security-Policy meta element is the first thing in `<head>`:
   `default-src 'none'`, inline scripts and styles only, images, media and fonts only from
   `data:`/`blob:`, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`.
   `<base>` and meta refresh elements are removed. Fetch, XHR, WebSocket, external
   scripts, images and fonts all fail.

3. A private channel. The frame's first message to the page is accepted only from that
   frame's window. The host answers by transferring one end of a `MessageChannel`; the SDK
   must then present a per-load random nonce that was written into its source. Shared state
   is sent only after that, and only over the port. A document that replaces the tool in
   the same frame has neither the port nor the nonce.

4. Checked writes. Every write from a frame is validated: key length, value size, number
   of keys, JSON-only values, and a rate budget. Rejected writes are answered with the
   authoritative value so the frame converges.

5. Recovery. Uncaught errors are shown in a strip above the tool. A frame that never
   starts, stops answering pings, or loads a second document is reset; after two such
   incidents for the same version the tool is stopped until someone reloads or changes it.

The server also rejects generated HTML that references external URLs before it is ever
stored, which removes most accidents. That check is a convenience, not the security
boundary; the browser-enforced rules above are.

## What it does not guarantee

- Self-navigation. A document's own CSP cannot forbid the frame from navigating itself
  (`location.href = "https://..."`). A hostile tool could put its own state and the member
  list into such a URL, and the browser would request it. The host notices the second
  load, resets the frame and shows a message, but the request has already left. The data
  exposed this way is limited to what the tool was given.
- Resource use. A tool can run a tight loop and slow down the tab. Browsers isolate
  sandboxed frames to different degrees; the ping watchdog resets a frame that stops
  answering, but it cannot interrupt a script that never yields.
- Misleading content. A tool can display anything inside its own card, including text
  that imitates the app. It cannot draw outside its frame.
- Browser bugs. All of this relies on the browser implementing iframe sandboxing, CSP in
  `srcdoc` documents and `MessageChannel` correctly.

## Checked how

The document builder, the message validator, the session handshake and the SDK are
covered by unit tests in `apps/web/src/runtime`. jsdom does not execute sandboxed frames,
so the browser-level behavior (CSP blocking requests, the opaque origin, the reset after
navigation) has to be checked in a real browser.
