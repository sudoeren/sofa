import type { MemberInfo, ServerConfig, SpaceInfo } from "@sofa/shared";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { type SpaceContextValue, StaticSpaceProvider } from "../lib/space";
import { loadOnboarding, saveOnboarding } from "../lib/storage";
import { addTool } from "../runtime/testing";
import { DONE_DELAY_MS } from "./GettingStarted";
import { SpaceScreen } from "./SpaceScreen";

const SPACE = "abcdefghijklmnopqrstu";
const OTHER = "zyxwvutsrqponmlkjihgf";
const me: MemberInfo = { id: "u1", name: "Deniz", color: "#111" };
const info: SpaceInfo = { id: SPACE, title: "Trip", createdAt: 1, locked: false };
const config: ServerConfig = {
  aiEnabled: true,
  provider: null,
  model: null,
  templates: [],
  examples: [],
  demo: false,
  spaceTtlHours: 0,
};
const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function screenFor(doc: Y.Doc, members: MemberInfo[] = [me], spaceId = SPACE) {
  const value: SpaceContextValue = {
    spaceId,
    doc,
    status: "connected",
    synced: true,
    me,
    members,
  };
  return (
    <MemoryRouter>
      <StaticSpaceProvider value={value}>
        <SpaceScreen info={{ ...info, id: spaceId }} onRename={() => {}} />
      </StaticSpaceProvider>
    </MemoryRouter>
  );
}

function checklist() {
  return within(screen.getByRole("region", { name: "Getting started" }));
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/config")) return json(config);
    if (url.endsWith("/generate")) return json({ messageId: "m1" }, 202);
    return json({ error: "nope" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Getting started checklist", () => {
  it("ticks asking and changing a tool, and keeps progress per space", async () => {
    const user = userEvent.setup();
    const doc = new Y.Doc();
    addTool(doc, { id: "t1", title: "Dinner poll" });
    render(screenFor(doc));

    expect(checklist().getByText("0 of 3")).toBeTruthy();
    const input = screen.getByLabelText("Ask for a tool");
    await user.type(input, "A poll{Enter}");
    await waitFor(() => expect(checklist().getByText("1 of 3")).toBeTruthy());
    expect(loadOnboarding(SPACE)).toMatchObject({ ask: true, change: false, invite: false });

    await user.click(screen.getByRole("button", { name: "Actions for Dinner poll" }));
    await user.click(screen.getByRole("menuitem", { name: "Change with AI" }));
    await user.type(screen.getByLabelText("Describe the change"), "Add a fourth option{Enter}");
    await waitFor(() => expect(loadOnboarding(SPACE).change).toBe(true));
    expect(checklist().getByText("2 of 3")).toBeTruthy();

    // another space starts fresh
    expect(loadOnboarding(OTHER)).toEqual({
      invite: false,
      ask: false,
      change: false,
      dismissed: false,
    });
  });

  it("ticks the invite step when the link is copied or someone else is here", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { unmount } = render(screenFor(new Y.Doc()));
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(loadOnboarding(SPACE).invite).toBe(true));
    unmount();

    render(screenFor(new Y.Doc(), [me, { id: "u2", name: "Bo", color: "#222" }], OTHER));
    await waitFor(() => expect(loadOnboarding(OTHER).invite).toBe(true));
  });

  it("can be dismissed and goes away by itself once everything is done", async () => {
    const user = userEvent.setup();
    const { unmount } = render(screenFor(new Y.Doc()));
    await user.click(checklist().getByRole("button", { name: "Dismiss getting started" }));
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
    expect(loadOnboarding(SPACE).dismissed).toBe(true);
    // the empty state still shows
    expect(screen.getByText("The table is set. What do you need on it?")).toBeTruthy();
    unmount();

    saveOnboarding(OTHER, { invite: true, ask: true, change: true, dismissed: false });
    vi.useFakeTimers();
    render(screenFor(new Y.Doc(), [me], OTHER));
    expect(checklist().getByText("All done")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(DONE_DELAY_MS + 50);
    });
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
    expect(loadOnboarding(OTHER).dismissed).toBe(true);
  });
});
