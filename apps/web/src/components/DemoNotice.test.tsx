import type { ServerConfig } from "@sofa/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoNotice } from "./DemoNotice";

const base: ServerConfig = {
  aiEnabled: false,
  provider: null,
  model: null,
  templates: [],
  examples: [],
  demo: true,
  spaceTtlHours: 24,
};

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("DemoNotice", () => {
  it("renders nothing before the config arrives or when the server is not a demo", () => {
    const { container, rerender } = render(<DemoNotice config={null} />);
    expect(container.innerHTML).toBe("");
    rerender(<DemoNotice config={{ ...base, demo: false }} />);
    expect(container.innerHTML).toBe("");
  });

  it("explains the demo and links to self-hosting; download only inside a space", async () => {
    const { rerender } = render(<DemoNotice config={base} />);
    expect(
      screen.getByText("This is a demo. Spaces are deleted after 24 hours without changes."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Host your own" }).getAttribute("href")).toBe(
      "https://github.com/sudoeren/sofa",
    );
    expect(screen.queryByRole("button", { name: "Download this space" })).toBeNull();

    const onDownload = vi.fn();
    rerender(<DemoNotice config={base} onDownload={onDownload} />);
    await userEvent.click(screen.getByRole("button", { name: "Download this space" }));
    expect(onDownload).toHaveBeenCalled();
  });

  it("stays dismissed for the browser session", async () => {
    const { unmount } = render(<DemoNotice config={base} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss demo notice" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    unmount();
    render(<DemoNotice config={base} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("still works when session storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<DemoNotice config={base} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss demo notice" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
