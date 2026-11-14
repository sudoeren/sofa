import { TOOL_LIMITS } from "@sofra/shared";
import { describe, expect, it } from "vitest";
import tokensCss from "../styles/tokens.css?raw";
import sdkSource from "./sdk.js?raw";
import { buildSrcdoc, FRAME_BASE_CSS, FRAME_CSP } from "./srcdoc";

function parse(srcdoc: string): Document {
  return new DOMParser().parseFromString(srcdoc, "text/html");
}

/** The CSP meta must be the very first element of the head, with the SDK before any tool script. */
function expectHardened(srcdoc: string): Document {
  const doc = parse(srcdoc);
  const first = doc.head.firstElementChild;
  expect(first?.tagName).toBe("META");
  expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
  expect(first?.getAttribute("content")).toBe(FRAME_CSP);
  expect(doc.documentElement.firstElementChild).toBe(doc.head);
  expect(srcdoc.startsWith('<!doctype html><html data-theme="')).toBe(true);

  const scripts = Array.from(doc.querySelectorAll("script"));
  expect(scripts[0]?.textContent).toContain("window.sofra = api");
  expect(scripts[0]?.parentElement).toBe(doc.head);
  // exactly one CSP, no base, no refresh
  expect(doc.querySelectorAll("meta[http-equiv]").length).toBe(1);
  expect(doc.querySelector("base")).toBeNull();
  return doc;
}

describe("buildSrcdoc", () => {
  it("blocks the network in the policy", () => {
    for (const part of [
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      "media-src data: blob:",
      "font-src data:",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ]) {
      expect(FRAME_CSP).toContain(part);
    }
    expect(FRAME_CSP).not.toMatch(/https?:|\*|unsafe-eval|'self'/);
  });

  it("wraps a plain document: CSP first, tokens, SDK, then the tool", () => {
    const srcdoc = buildSrcdoc(
      '<!doctype html><html lang="tr"><head><title>Poll</title><style>p{color:red}</style></head>' +
        '<body class="x"><p id="p">hi</p><script>sofra.ready(function(){})</script></body></html>',
      { theme: "dark", nonce: "abc123" },
    );
    const doc = expectHardened(srcdoc);
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(doc.documentElement.getAttribute("lang")).toBe("tr");
    expect(doc.body.className).toBe("x");
    expect(doc.getElementById("p")?.textContent).toBe("hi");
    expect(doc.title).toBe("Poll");
    const styles = Array.from(doc.querySelectorAll("style"));
    expect(styles[0]?.textContent).toContain("--accent-soft");
    expect(styles[0]?.textContent).toContain(':root[data-theme="dark"]');
    expect(styles[1]?.textContent).toBe("p{color:red}");
    const scripts = Array.from(doc.querySelectorAll("script"));
    expect(scripts).toHaveLength(2);
    expect(scripts[0]?.textContent).toContain('"abc123"');
    expect(scripts[0]?.textContent).not.toContain("__SOFRA_NONCE__");
    expect(scripts[1]?.textContent).toContain("sofra.ready");
  });

  it("uses the text of tokens.css rather than a copy", () => {
    expect(FRAME_BASE_CSS).toContain(tokensCss.trim());
  });

  it("is pure and does not depend on anything but its input", () => {
    const a = buildSrcdoc("<p>x</p>", { theme: "light", nonce: "n1" });
    expect(buildSrcdoc("<p>x</p>", { theme: "light", nonce: "n1" })).toBe(a);
    expect(a).not.toContain(location.href);
  });

  it("handles fragments, empty input and odd values", () => {
    expectHardened(buildSrcdoc("", { theme: "light" }));
    expectHardened(buildSrcdoc("just text", { theme: "light" }));
    expectHardened(buildSrcdoc(undefined as unknown as string, { theme: "light" }));
    const doc = expectHardened(buildSrcdoc("<div>a</div>", { theme: "pink" as "light" }));
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
    // a nonce that is not plain alphanumeric is dropped, never written into the script
    const odd = buildSrcdoc("<p></p>", { theme: "light", nonce: '";alert(1)//' });
    expect(odd).not.toContain("alert(1)");
  });

  it("strips <base> and every http-equiv meta, wherever they are", () => {
    const doc = expectHardened(
      buildSrcdoc(
        '<html><head><base href="https://evil.example/"><BASE target="_top">' +
          '<meta http-equiv="refresh" content="0;url=https://evil.example/">' +
          '<meta name=">" HTTP-EQUIV=Refresh content="0;url=https://evil.example/2">' +
          '<meta http-equiv="re&#102;resh" content="1;url=//evil.example/3">' +
          '<meta name="description" content="kept"></head>' +
          '<body><meta http-equiv=refresh content=0;url=//evil.example/4><base href="//evil.example/">' +
          "<p>ok</p></body></html>",
        { theme: "light" },
      ),
    );
    expect(doc.querySelector('meta[name="description"]')).not.toBeNull();
    expect(doc.body.textContent).toContain("ok");
    expect(doc.documentElement.outerHTML).not.toContain("evil.example");
  });

  it("keeps its own CSP first when the document starts with a CSP of its own", () => {
    const hostile =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src *; script-src * 'unsafe-inline' 'unsafe-eval'\">" +
      '<!doctype html><html><head><meta http-equiv="content-security-policy" content="connect-src *">' +
      "</head><body><script>fetch('https://evil.example')</script></body></html>";
    const srcdoc = buildSrcdoc(hostile, { theme: "light" });
    expectHardened(srcdoc);
    expect(srcdoc).not.toContain("default-src *");
    expect(srcdoc).not.toContain("connect-src *");
  });

  it("cannot be pushed out of position by markup before or around the head", () => {
    const inputs = [
      '<script>window.early = 1</script><html><head></head><body></body></html>',
      '<!--><script>early()</script>--><head><script>early2()</script></head>',
      '</head></html><script>after()</script>',
      '<body><head><meta http-equiv="Content-Security-Policy" content="script-src *"></head>',
      '<html data-theme="x" onload="go()" "><script>x</script>="1"><body>',
      "<plaintext>never closed",
      '<svg><script>svgScript()</script></svg><math><meta http-equiv="refresh" content="0;url=//evil.example"></math>',
      "<frameset><frame src='https://evil.example'></frameset>",
      "<template><base href='//evil.example'></template><noscript><meta http-equiv='refresh' content='0'></noscript>",
    ];
    for (const input of inputs) {
      const srcdoc = buildSrcdoc(input, { theme: "light" });
      const doc = parse(srcdoc);
      const first = doc.head.firstElementChild;
      expect(first?.getAttribute("content"), input).toBe(FRAME_CSP);
      expect(doc.querySelector("script")?.textContent, input).toContain("window.sofra = api");
      // nothing but the fixed prefix precedes the policy in the text itself
      const headAt = srcdoc.indexOf("<head>");
      expect(srcdoc.slice(0, headAt), input).toMatch(
        /^<!doctype html><html data-theme="light"( [a-z_][a-z0-9_.:-]*="[^"<>]*")*>$/,
      );
      expect(
        srcdoc.slice(headAt).startsWith('<head><meta http-equiv="Content-Security-Policy"'),
        input,
      ).toBe(true);
    }
  });

  it("survives script end tags in odd places", () => {
    const doc = expectHardened(
      buildSrcdoc(
        '<html lang="</script><script>alert(1)</script>"><head><title></script><script>t()</script></title>' +
          "<style></script></style></head>" +
          '<body data-x="</script>"><script>var s = "</script><p id=leak>leaked</p>";</script>' +
          "<textarea></script></textarea></body></html>",
        { theme: "light" },
      ),
    );
    const scripts = Array.from(doc.querySelectorAll("script"));
    // the SDK is intact and still first; the attribute and title text did not become scripts
    expect(scripts[0]?.textContent).toContain("window.sofra = api");
    expect(scripts[0]?.textContent?.trimEnd().endsWith("})(window);")).toBe(true);
    expect(doc.documentElement.getAttribute("lang")).toBe("</script><script>alert(1)</script>");
    expect(scripts.some((s) => s.textContent === "alert(1)")).toBe(false);
    expect(scripts.some((s) => s.textContent === "t()")).toBe(false);
  });

  it("embeds an SDK that cannot end its own script element", () => {
    expect(sdkSource).not.toMatch(/<\/script/i);
    expect(sdkSource).not.toContain("<!--");
    expect(FRAME_BASE_CSS).not.toMatch(/<\/style/i);
  });

  it("keeps the SDK's copy of the limits equal to TOOL_LIMITS", () => {
    expect(sdkSource).toContain(`var MAX_KEY_LENGTH = ${TOOL_LIMITS.maxKeyLength};`);
    expect(sdkSource).toContain(`var MAX_VALUE_BYTES = ${TOOL_LIMITS.maxValueBytes};`);
    expect(sdkSource).toContain(`var MAX_FRAME_HEIGHT = ${TOOL_LIMITS.maxFrameHeight};`);
  });
});
