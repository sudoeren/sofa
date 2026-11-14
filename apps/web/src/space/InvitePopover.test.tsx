import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qrPath } from "../components/QrCode";
import { InvitePopover } from "./InvitePopover";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "share");
});

describe("InvitePopover", () => {
  it("shows the link, copies it and draws a QR code", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onInvited = vi.fn();
    render(<InvitePopover title="Trip" locked={false} onInvited={onInvited} />);

    const trigger = screen.getByRole("button", { name: "Invite" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const panel = screen.getByRole("dialog", { name: "Invite people" });
    const field = screen.getByLabelText("Link to this space") as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}${window.location.pathname}`);
    expect(field.readOnly).toBe(true);
    // focus moved into the panel
    expect(panel.contains(document.activeElement)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(field.value);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(onInvited).toHaveBeenCalledTimes(1);

    const qr = screen.getByRole("img", { name: /QR code/ });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(qrPath(field.value).d);

    // no share sheet in this browser
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<InvitePopover title="Trip" locked />);
    const trigger = screen.getByRole("button", { name: "Invite" });
    await user.click(trigger);
    expect(screen.getByText(/They also need the password/)).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("uses the share sheet when there is one", async () => {
    const user = userEvent.setup();
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const onInvited = vi.fn();
    render(<InvitePopover title="Trip" locked={false} onInvited={onInvited} />);
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ title: "Trip", url: expect.any(String) });
    await waitFor(() => expect(onInvited).toHaveBeenCalled());
  });
});

describe("qrPath", () => {
  it("encodes a link into a square of modules with a quiet zone", () => {
    const { size, d } = qrPath("https://example.org/s/abcdefghijklmnopqrstu");
    expect(size).toBeGreaterThanOrEqual(25);
    expect(d.startsWith("M2 2")).toBe(true);
  });
});
