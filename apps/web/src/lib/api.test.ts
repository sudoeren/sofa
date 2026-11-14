import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  applyTemplate,
  createSpace,
  fileUrl,
  generate,
  getConfig,
  getSpace,
  previewLink,
  unlockSpace,
  uploadFile,
} from "./api";
import { setSpaceToken } from "./storage";

const SPACE = "abcdefghijklmnopqrstu";

function respond(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

function lastCall(): { url: string; init: RequestInit; headers: Record<string, string> } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  const init = (call[1] ?? {}) as RequestInit;
  return { url: String(call[0]), init, headers: (init.headers ?? {}) as Record<string, string> };
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("reads the config", async () => {
    const config = { aiEnabled: false, provider: null, model: null, templates: [] };
    fetchMock.mockResolvedValue(respond(200, config));
    await expect(getConfig()).resolves.toEqual(config);
    expect(lastCall().url).toBe("/api/config");
    expect(lastCall().init.method).toBe("GET");
  });

  it("creates a space with a JSON body", async () => {
    fetchMock.mockResolvedValue(
      respond(201, { id: SPACE, title: "Trip", createdAt: 1, locked: true, token: "t" }),
    );
    const space = await createSpace({ title: "Trip", password: "secret" });
    expect(space.token).toBe("t");
    const { url, init, headers } = lastCall();
    expect(url).toBe("/api/spaces");
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Trip", password: "secret" });
  });

  it("does not send a token when reading or unlocking a space", async () => {
    setSpaceToken(SPACE, "stored");
    fetchMock.mockResolvedValue(
      respond(200, { id: SPACE, title: "Trip", createdAt: 1, locked: true }),
    );
    await getSpace(SPACE);
    expect(lastCall().headers.Authorization).toBeUndefined();
    fetchMock.mockResolvedValue(respond(200, { token: "fresh" }));
    await expect(unlockSpace(SPACE, "pw")).resolves.toEqual({ token: "fresh" });
    expect(lastCall().url).toBe(`/api/spaces/${SPACE}/unlock`);
    expect(lastCall().headers.Authorization).toBeUndefined();
  });

  it("adds the bearer token of a locked space to its routes", async () => {
    setSpaceToken(SPACE, "tok-123");
    fetchMock.mockImplementation(async () => respond(202, { messageId: "m1" }));
    await generate(SPACE, { prompt: "a poll", user: { id: "u1", name: "Deniz" } });
    expect(lastCall().url).toBe(`/api/spaces/${SPACE}/generate`);
    expect(lastCall().headers.Authorization).toBe("Bearer tok-123");

    fetchMock.mockImplementation(async () => respond(201, { toolId: "t1" }));
    await expect(applyTemplate(SPACE, "poll", { id: "u1", name: "Deniz" })).resolves.toEqual({
      toolId: "t1",
    });
    expect(lastCall().url).toBe(`/api/spaces/${SPACE}/templates/poll`);
    expect(lastCall().headers.Authorization).toBe("Bearer tok-123");
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ user: { id: "u1", name: "Deniz" } });

    fetchMock.mockImplementation(async () =>
      respond(200, { url: "https://a.b/", title: "A", description: "" }),
    );
    await previewLink(SPACE, "https://a.b/");
    expect(lastCall().url).toBe(`/api/spaces/${SPACE}/links`);
    expect(lastCall().headers.Authorization).toBe("Bearer tok-123");
  });

  it("sends no Authorization header for an open space", async () => {
    fetchMock.mockResolvedValue(respond(202, { messageId: "m1" }));
    await generate(SPACE, { prompt: "a poll", user: { id: "u1", name: "Deniz" } });
    expect(lastCall().headers.Authorization).toBeUndefined();
  });

  it("uploads a file as multipart without setting the content type itself", async () => {
    setSpaceToken(SPACE, "tok-123");
    fetchMock.mockResolvedValue(
      respond(201, {
        fileId: "f1",
        name: "a.txt",
        mime: "text/plain",
        size: 1,
        url: "/api/files/f1",
      }),
    );
    const info = await uploadFile(SPACE, new File(["x"], "a.txt", { type: "text/plain" }));
    expect(info.fileId).toBe("f1");
    const { url, init, headers } = lastCall();
    expect(url).toBe(`/api/spaces/${SPACE}/files`);
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer tok-123");
  });

  it("turns { error } responses into ApiError with the message and status", async () => {
    fetchMock.mockResolvedValue(respond(429, { error: "Slow down a little." }));
    const error = await generate(SPACE, { prompt: "x", user: { id: "u", name: "n" } }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Slow down a little.");
    expect((error as ApiError).status).toBe(429);
  });

  it("falls back to a readable message when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await getSpace(SPACE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toMatch(/502/);

    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    await expect(getSpace(SPACE)).rejects.toMatchObject({ status: 404, message: "Not found." });
  });

  it("maps a network failure to status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await getConfig().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toMatch(/reach the server/);
  });

  it("builds file URLs with the token only for locked spaces", () => {
    expect(fileUrl("f1", SPACE)).toBe("/api/files/f1");
    setSpaceToken(SPACE, "a b");
    expect(fileUrl("f1", SPACE)).toBe("/api/files/f1?t=a%20b");
  });
});
