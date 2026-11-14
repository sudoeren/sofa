import { describe, expect, it } from "vitest";
import { collabUrl, membersFromStates } from "./space";

const me = { id: "me", name: "Deniz", color: "#111" };

describe("space connection helpers", () => {
  it("derives the socket URL from the page location", () => {
    expect(collabUrl({ protocol: "https:", host: "sofa.example" })).toBe(
      "wss://sofa.example/collab",
    );
    expect(collabUrl({ protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173/collab",
    );
  });

  it("lists each member once, me first, ignoring malformed presence", () => {
    const members = membersFromStates(
      [
        { user: { id: "b", name: "Zeynep", color: "#222" } },
        { user: { id: "me", name: "Deniz (other tab)", color: "#111" } },
        { user: { id: "a", name: "Ali", color: "#333" } },
        { user: { id: "b", name: "Zeynep", color: "#222" } },
        { user: { name: "no id" } },
        {},
        null,
      ],
      me,
    );
    expect(members.map((member) => member.id)).toEqual(["me", "a", "b"]);
    expect(members[0]).toBe(me);
  });
});
