import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientAddress } from "../app";

async function addressFor(hops: number, forwarded?: string, socket = "10.0.0.2") {
  const app = new Hono<{ Bindings: { incoming: { socket: { remoteAddress: string } } } }>();
  app.get("/", (c) => c.text(clientAddress(c as any, hops)));
  const headers: Record<string, string> = forwarded ? { "x-forwarded-for": forwarded } : {};
  const res = await app.request(
    "/",
    { headers },
    { incoming: { socket: { remoteAddress: socket } } },
  );
  return res.text();
}

describe("clientAddress", () => {
  it("uses the socket when no proxy is trusted, ignoring the header", async () => {
    expect(await addressFor(0, "1.2.3.4")).toBe("10.0.0.2");
  });
  it("takes the entry added by the trusted proxy, not a forged one further left", async () => {
    expect(await addressFor(1, "6.6.6.6, 1.2.3.4")).toBe("1.2.3.4");
    expect(await addressFor(2, "6.6.6.6, 1.2.3.4, 172.70.1.1")).toBe("1.2.3.4");
  });
  it("falls back to the socket without a header", async () => {
    expect(await addressFor(1)).toBe("10.0.0.2");
  });
});
