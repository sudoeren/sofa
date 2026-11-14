import type { UserAi } from "@sofra/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptBar, type PromptTarget } from "./PromptBar";

const SPACE = "abcdefghijklmnopqrstu";
const me = { id: "u1", name: "Deniz", color: "#c2410c" };
const fetchMock = vi.fn<typeof fetch>();

function Harness({
  initialTarget = null,
  serverAi = true,
  memberAi = null,
  onSent,
  onOpenSettings = () => {},
  onOpenGallery = () => {},
}: {
  initialTarget?: PromptTarget | null;
  serverAi?: boolean | null;
  memberAi?: UserAi | null;
  onSent?: () => void;
  onOpenSettings?: () => void;
  onOpenGallery?: () => void;
}) {
  const [value, setValue] = useState("");
  const [target, setTarget] = useState<PromptTarget | null>(initialTarget);
  return (
    <PromptBar
      spaceId={SPACE}
      me={me}
      value={value}
      onChange={setValue}
      target={target}
      onClearTarget={() => setTarget(null)}
      serverAi={serverAi}
      memberAi={memberAi}
      onOpenSettings={onOpenSettings}
      onOpenGallery={onOpenGallery}
      onSent={onSent}
    />
  );
}

function sentBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

function accepted(): Response {
  return new Response(JSON.stringify({ messageId: "m1" }), { status: 202 });
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PromptBar", () => {
  it("sends on Enter, keeps Shift+Enter as a new line and clears afterwards", async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    fetchMock.mockResolvedValue(accepted());
    render(<Harness onSent={onSent} />);
    const input = screen.getByLabelText("Ask for a tool") as HTMLTextAreaElement;

    await user.type(input, "A poll{Shift>}{Enter}{/Shift}for dinner");
    expect(input.value).toBe("A poll\nfor dinner");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/spaces/${SPACE}/generate`);
    expect(sentBody()).toEqual({ prompt: "A poll\nfor dinner", user: { id: "u1", name: "Deniz" } });
    expect(input.value).toBe("");
  });

  it("does not send an empty prompt", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByLabelText("Ask for a tool"), "   {Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("targets a tool, shows the chip and lets it be dismissed", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(accepted());
    const { unmount } = render(<Harness initialTarget={{ id: "t1", title: "Dinner poll" }} />);
    expect(screen.getByText("Dinner poll")).toBeTruthy();
    await user.type(screen.getByLabelText("Describe the change"), "add a fourth option{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().toolId).toBe("t1");
    await waitFor(() => expect(screen.queryByText("Dinner poll")).toBeNull());
    unmount();

    render(<Harness initialTarget={{ id: "t1", title: "Dinner poll" }} />);
    await user.click(screen.getByRole("button", { name: "Stop changing this tool" }));
    expect(screen.queryByText("Dinner poll")).toBeNull();
    await user.type(screen.getByLabelText("Ask for a tool"), "something new{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody().toolId).toBeUndefined();
  });

  it("includes the member's own key when one is saved", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(accepted());
    const ai: UserAi = { provider: "anthropic", apiKey: "sk-ant-12345678" };
    render(<Harness memberAi={ai} serverAi={false} />);
    expect(screen.queryByText(/No AI key is set up/)).toBeNull();
    await user.type(screen.getByLabelText("Ask for a tool"), "a bracket{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().ai).toEqual(ai);
  });

  it("is disabled while sending and shows a 429 inline, keeping the text", async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    render(<Harness />);
    const input = screen.getByLabelText("Ask for a tool") as HTMLTextAreaElement;
    await user.type(input, "a poll{Enter}");
    await waitFor(() => expect(input.disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Sending" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    release(new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Too many requests/);
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("a poll");

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a network failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<Harness />);
    await user.type(screen.getByLabelText("Ask for a tool"), "a poll{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not reach the server/);
  });

  it("says plainly when nobody has an AI key and points to settings and the gallery", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const onOpenGallery = vi.fn();
    render(
      <Harness serverAi={false} onOpenSettings={onOpenSettings} onOpenGallery={onOpenGallery} />,
    );
    expect(screen.getByText(/No AI key is set up/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "starter gallery" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenGallery).toHaveBeenCalledTimes(1);
  });
});
