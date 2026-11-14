import { afterEach, describe, expect, it, vi } from "vitest";
import { setSpaceToken } from "./storage";
import { downloadSpace, exportFileName } from "./transfer";

const SPACE = "abcdefghijklmnopqrstu";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("transfer", () => {
  it("names the file after the space", () => {
    expect(exportFileName("Lisbon in May!")).toBe("lisbon-in-may.sofa.json");
    expect(exportFileName("Çay saati")).toBe("cay-saati.sofa.json");
    expect(exportFileName("***")).toBe("space.sofa.json");
  });

  it("downloads the export with the token of a locked space", async () => {
    setSpaceToken(SPACE, "tok");
    const body = { format: "sofa-space", version: 1, title: "Trip", exportedAt: 1, doc: "AA==" };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadSpace(SPACE, "Trip");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/spaces/${SPACE}/export`);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(click).toHaveBeenCalled();
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("trip.sofa.json");
  });
});
