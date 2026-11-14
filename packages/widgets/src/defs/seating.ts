import type { JsonValue, ToolState } from "@sofa/shared";
import { z } from "zod";
import type { WidgetDef } from "../types";

const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "id must be 1-40 characters of letters, digits, _ or -");

export const MAX_SEATS = 30;

const configSchema = z
  .object({
    tables: z
      .array(
        z.object({
          id: idSchema,
          name: z.string().trim().min(1).max(40),
          seats: z.number().int().min(1).max(MAX_SEATS),
        }),
      )
      .max(40)
      .default([]),
    guests: z
      .array(z.object({ id: idSchema, name: z.string().trim().min(1).max(40) }))
      .max(300)
      .default([]),
    allowAdd: z.boolean().default(true),
  })
  .superRefine((config, ctx) => {
    for (const kind of ["tables", "guests"] as const) {
      const seen = new Set<string>();
      for (const [index, item] of config[kind].entries()) {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate id in ${kind}`,
            path: [kind, index, "id"],
          });
        }
        seen.add(item.id);
      }
    }
  });

export type SeatingConfig = z.infer<typeof configSchema>;

/* ---------------------------------------------------------------- state */

/** A config list, or an empty one when the config is missing it (never trust the shape). */
function listOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanOrder(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole number of seats between 1 and MAX_SEATS, or null. */
export function cleanSeats(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_SEATS, Math.max(1, Math.round(value)));
}

export type SeatingGuest = {
  id: string;
  name: string;
  order: number;
  fromConfig: boolean;
  /** id of the table the guest sits at, or null when in the pool */
  tableId: string | null;
};

export type SeatingTable = {
  id: string;
  name: string;
  seats: number;
  order: number;
  fromConfig: boolean;
  guests: SeatingGuest[];
};

export type SeatingView = {
  tables: SeatingTable[];
  /** every guest: config order, then guests added by members */
  guests: SeatingGuest[];
  /** guests without a table (never seated, or their table is gone) */
  pool: SeatingGuest[];
};

const MAX_TABLES = 100;
const MAX_GUESTS = 1000;

/** Merge config and shared state into tables with their guests. Never throws on bad state. */
export function resolveSeating(config: SeatingConfig, data: ToolState): SeatingView {
  const tables: SeatingTable[] = [];
  const configTables = new Set<string>();
  for (const [index, table] of listOf(config?.tables).entries()) {
    configTables.add(table.id);
    if (data[`removed:table:${table.id}`] === true) continue;
    const override = data[`table:${table.id}`];
    const edited = isRecord(override) ? override : null;
    tables.push({
      id: table.id,
      name: (edited && cleanText(edited.name, 40)) || table.name,
      seats: (edited && cleanSeats(edited.seats)) || table.seats,
      order: index,
      fromConfig: true,
      guests: [],
    });
  }
  const addedTables: SeatingTable[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("table:")) continue;
    const id = key.slice("table:".length);
    if (!id || configTables.has(id) || !isRecord(value) || data[`removed:table:${id}`] === true)
      continue;
    const name = cleanText(value.name, 40);
    const seats = cleanSeats(value.seats);
    if (!name || seats === null) continue;
    addedTables.push({
      id,
      name,
      seats,
      order: cleanOrder(value.order),
      fromConfig: false,
      guests: [],
    });
  }
  addedTables.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  tables.push(...addedTables.slice(0, MAX_TABLES));
  const tableById = new Map(tables.map((table) => [table.id, table]));

  const seatOf = (guestId: string): string | null => {
    const value = data[`seat:${guestId}`];
    return typeof value === "string" && tableById.has(value) ? value : null;
  };

  const guests: SeatingGuest[] = [];
  const configGuests = new Set<string>();
  for (const [index, guest] of listOf(config?.guests).entries()) {
    configGuests.add(guest.id);
    if (data[`removed:guest:${guest.id}`] === true) continue;
    const override = data[`guest:${guest.id}`];
    const renamed = isRecord(override) ? cleanText(override.name, 40) : "";
    guests.push({
      id: guest.id,
      name: renamed || guest.name,
      order: index,
      fromConfig: true,
      tableId: seatOf(guest.id),
    });
  }
  const addedGuests: SeatingGuest[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("guest:")) continue;
    const id = key.slice("guest:".length);
    if (!id || configGuests.has(id) || !isRecord(value) || data[`removed:guest:${id}`] === true)
      continue;
    const name = cleanText(value.name, 40);
    if (!name) continue;
    addedGuests.push({
      id,
      name,
      order: cleanOrder(value.order),
      fromConfig: false,
      tableId: seatOf(id),
    });
  }
  addedGuests.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  guests.push(...addedGuests.slice(0, MAX_GUESTS));

  const pool: SeatingGuest[] = [];
  for (const guest of guests) {
    const table = guest.tableId ? tableById.get(guest.tableId) : undefined;
    if (table) table.guests.push(guest);
    else pool.push(guest);
  }
  return { tables, guests, pool };
}

/** Seats still free at a table; 0 when it is full or over capacity. */
export function freeSeats(table: Pick<SeatingTable, "seats" | "guests">): number {
  return Math.max(0, table.seats - table.guests.length);
}

/**
 * Whether a guest can be moved to a table. A guest who already sits there can always
 * "move" there; otherwise the table needs a free seat.
 */
export function canSeat(
  table: Pick<SeatingTable, "id" | "seats" | "guests">,
  guestId: string,
): boolean {
  return table.guests.some((guest) => guest.id === guestId) || table.guests.length < table.seats;
}

/** Sort key that puts a new guest or table after the existing ones. */
export function orderAfter(items: { order: number }[]): number {
  let max = -1;
  for (const item of items) if (item.order > max) max = item.order;
  return Math.floor(max) + 1;
}

/* ---------------------------------------------------------------- definition */

export const seating: WidgetDef<SeatingConfig> = {
  type: "seating",
  title: "Seating plan",
  description: "Put guests at tables by dragging them or picking a table.",
  guide: [
    "Use to assign people to tables, cars, rooms, teams or any groups with a limited number of places.",
    "config.tables: [{id, name, seats}] the groups, seats is a whole number from 1 to 30.",
    "config.guests: [{id, name}] the people to place. They start unseated; nobody is seated through config.",
    "config.allowAdd: members may add guests and tables (default true). Moving, renaming and removing is always possible.",
    "State keys:",
    '"seat:<guestId>" = "<tableId>": where a guest sits. Delete the key to move the guest back to the unseated pool. A seat that points to a missing table counts as unseated.',
    '"guest:<id>" = {name, order}: a guest added by a member (sorted by order after the config guests), or a new name for a config guest.',
    '"table:<id>" = {name, seats, order}: a table added by a member, or a new name and seat count for a config table.',
    '"removed:guest:<id>" = true and "removed:table:<id>" = true: removed. Guests of a removed table are unseated.',
    "A table is full when it has as many guests as seats; the component refuses further moves to it.",
  ].join("\n"),
  configSchema,
  starter: {
    title: "Anniversary dinner seating",
    description: "Drag guests to a table, or tap a guest and then a table.",
    config: {
      allowAdd: true,
      tables: [
        { id: "window", name: "Window table", seats: 6 },
        { id: "long", name: "Long table", seats: 8 },
        { id: "garden", name: "Garden table", seats: 4 },
      ],
      guests: [
        { id: "g1", name: "Leyla" },
        { id: "g2", name: "Omer" },
        { id: "g3", name: "Grandma Nur" },
        { id: "g4", name: "Uncle Hakan" },
        { id: "g5", name: "Aunt Sibel" },
        { id: "g6", name: "Ece" },
        { id: "g7", name: "Baris" },
        { id: "g8", name: "Melis" },
        { id: "g9", name: "Tolga" },
        { id: "g10", name: "Irem" },
        { id: "g11", name: "Jonas" },
        { id: "g12", name: "Sofia" },
        { id: "g13", name: "Kerem" },
        { id: "g14", name: "Nazli" },
      ],
    },
    initialState: {
      "seat:g1": "window",
      "seat:g2": "window",
      "seat:g3": "window",
      "seat:g4": "long",
      "seat:g5": "long",
      "seat:g6": "garden",
      "seat:g7": "garden",
    },
  },
  keywords: [
    "seating",
    "seat",
    "seats",
    "guests",
    "wedding",
    "dinner",
    "groups",
    "teams",
    "rooms",
    "oturma",
    "masa",
    "davetli",
    "dugun",
    "yerlesim",
  ],
};
