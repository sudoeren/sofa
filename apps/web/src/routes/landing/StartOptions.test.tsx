import {
  type ServerConfig,
  SPACE_EXPORT_FORMAT,
  SPACE_EXPORT_VERSION,
  type SpaceExport,
} from "@sofa/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSpaceToken, loadIdentity, saveIdentity } from "../../lib/storage";
import { Landing } from "../Landing";
import { ImportSpace } from "./StartOptions";

const NEW_ID = "abcdefghijklmnopqrstu";
const fetchMock = vi.fn<typeof fetch>();

const config: ServerConfig = {
  aiEnabled: false,
  provider: null,
  model: null,
  templates: [],
  examples: [
    { id: "trip", title: "Weekend trip", description: "A poll, a plan and shared costs." },
    { id: "games", title: "Game night", description: "A bracket and a seating chart." },
  ],
  demo: true,
  spaceTtlHours: 24,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function call(path: string): RequestInit | undefined {
  const found = fetchMock.mock.calls.find(([input]) => String(input) === `/api${path}`);
  return found?.[1] as RequestInit | undefined;
}

function app(element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={element} />
        <Route path="/s/:spaceId" element={<p>Opened space</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const exportFile: SpaceExport = {
  format: SPACE_EXPORT_FORMAT,
  version: SPACE_EXPORT_VERSION,
  title: "Trip",
  exportedAt: 1,
  doc: "AAA=",
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("examples on the landing page", () => {
  it("lists the examples from the config and opens one", async () => {
    const user = userEvent.setup();
    saveIdentity("Deniz");
    const me = loadIdentity();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") return json(config);
      if (url === "/api/examples/trip")
        return json({ id: NEW_ID, title: "Weekend trip", createdAt: 1, locked: false }, 201);
      return json({ error: "nope" }, 404);
    });
    app(<Landing />);

    const button = await screen.findByRole("button", { name: /Weekend trip/ });
    expect(screen.getByText("Or open an example")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Game night/ })).toBeTruthy();
    // the demo strip shows from the same config
    expect(screen.getByText(/This is a demo/)).toBeTruthy();

    await user.click(button);
    await screen.findByText("Opened space");
    const init = call("/examples/trip");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ user: { id: me?.id, name: "Deniz" } });
  });

  it("creates a user id when nobody has chosen a name yet, and shows errors inline", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") return json(config);
      return json({ error: "That example does not exist." }, 404);
    });
    app(<Landing />);
    await user.click(await screen.findByRole("button", { name: /Game night/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("That example does not exist.");
    const body = JSON.parse(String(call("/examples/games")?.body)) as {
      user: { id: string; name: string };
    };
    expect(body.user.id.length).toBeGreaterThan(5);
    // the name gate still asks for a name later, and keeps this id
    expect(loadIdentity()).toBeNull();
    expect(saveIdentity("Bo").id).toBe(body.user.id);
  });

  it("hides the row when there are no examples", async () => {
    fetchMock.mockImplementation(async () => json({ ...config, examples: [], demo: false }));
    app(<Landing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Or open an example")).toBeNull();
    expect(screen.queryByText(/This is a demo/)).toBeNull();
  });
});

describe("import a space", () => {
  function fileInput(): HTMLInputElement {
    return screen.getByLabelText("Sofa space file") as HTMLInputElement;
  }

  it("posts the file contents and opens the new space", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      json({ id: NEW_ID, title: "Trip", createdAt: 1, locked: true, token: "tok" }, 201),
    );
    app(<ImportSpace />);
    const file = new File([JSON.stringify(exportFile)], "trip.sofa.json", {
      type: "application/json",
    });
    await user.upload(fileInput(), file);
    await screen.findByText("Opened space");
    const init = call("/import");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(exportFile);
    expect(getSpaceToken(NEW_ID)).toBe("tok");
  });

  it("explains a file that is not a space export without calling the server", async () => {
    const user = userEvent.setup({ applyAccept: false });
    app(<ImportSpace />);
    await user.upload(fileInput(), new File(["not json"], "notes.txt", { type: "text/plain" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not a Sofa space/);

    await user.upload(
      fileInput(),
      new File([JSON.stringify({ ...exportFile, version: 99 })], "new.sofa.json"),
    );
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/different version/));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's error", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(json({ error: "That file could not be imported." }, 400));
    app(<ImportSpace />);
    await user.upload(fileInput(), new File([JSON.stringify(exportFile)], "trip.sofa.json"));
    expect((await screen.findByRole("alert")).textContent).toBe("That file could not be imported.");
  });
});
