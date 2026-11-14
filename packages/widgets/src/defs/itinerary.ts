import type { JsonValue, ToolState } from "@sofa/shared";
import { z } from "zod";
import type { WidgetDef } from "../types";

const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "id must be 1-40 characters of letters, digits, _ or -");

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const daySchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(40),
  date: z.string().regex(DATE, "date must be YYYY-MM-DD").optional(),
});

const stopSchema = z.object({
  id: idSchema,
  dayId: idSchema,
  time: z.string().regex(TIME, "time must be HH:MM (24 hour)").optional(),
  title: z.string().trim().min(1).max(80),
  note: z.string().trim().max(300).optional(),
  place: z.string().trim().max(80).optional(),
  link: z.string().trim().max(500).optional(),
});

const configSchema = z
  .object({
    days: z.array(daySchema).max(31).default([]),
    stops: z.array(stopSchema).max(200).default([]),
    allowAdd: z.boolean().default(true),
  })
  .superRefine((config, ctx) => {
    const days = new Set<string>();
    for (const [index, day] of config.days.entries()) {
      if (days.has(day.id)) {
        ctx.addIssue({ code: "custom", message: "duplicate day id", path: ["days", index, "id"] });
      }
      days.add(day.id);
    }
    const stops = new Set<string>();
    for (const [index, stop] of config.stops.entries()) {
      if (stops.has(stop.id)) {
        ctx.addIssue({
          code: "custom",
          message: "duplicate stop id",
          path: ["stops", index, "id"],
        });
      }
      stops.add(stop.id);
      if (!days.has(stop.dayId)) {
        ctx.addIssue({
          code: "custom",
          message: "dayId must be the id of an entry in days",
          path: ["stops", index, "dayId"],
        });
      }
    }
  });

export type ItineraryConfig = z.infer<typeof configSchema>;

/* ---------------------------------------------------------------- helpers */

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

/** "HH:MM" or "" for anything else. */
export function cleanTime(value: unknown): string {
  return typeof value === "string" && TIME.test(value) ? value : "";
}

/** "YYYY-MM-DD" of a real calendar day, or "". */
export function cleanDate(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value)) return "";
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return date.getUTCDate() === d ? value : "";
}

/** "Fri, 12 Jun" style text for a YYYY-MM-DD date; "" when the date is not valid. */
export function formatDayDate(value: string, locale = "en"): string {
  const clean = cleanDate(value);
  if (!clean) return "";
  const [y, m, d] = clean.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)));
  } catch {
    return clean;
  }
}

export type SafeLink = { href: string; text: string };

/** Only http and https links are shown. The text is the host plus a shortened path. */
export function safeLink(value: unknown): SafeLink | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 500 || !/^https?:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const text = host + path;
  return { href: url.href, text: text.length > 42 ? `${text.slice(0, 41)}…` : text };
}

/* ---------------------------------------------------------------- state */

export type ItineraryGoer = { id: string; name: string };

export type ItineraryStop = {
  id: string;
  dayId: string;
  /** "HH:MM" or "" */
  time: string;
  title: string;
  note: string;
  place: string;
  link: string;
  order: number;
  fromConfig: boolean;
  done: boolean;
  booked: boolean;
  going: ItineraryGoer[];
};

export type ItineraryDay = {
  id: string;
  label: string;
  /** "YYYY-MM-DD" or "" */
  date: string;
  order: number;
  fromConfig: boolean;
  stops: ItineraryStop[];
};

/** The value written to "stop:<id>". */
export type StoredStop = {
  dayId: string;
  time: string;
  title: string;
  note: string;
  place: string;
  link: string;
  order: number;
};

export function toStoredStop(stop: ItineraryStop, patch: Partial<StoredStop> = {}): StoredStop {
  return {
    dayId: stop.dayId,
    time: stop.time,
    title: stop.title,
    note: stop.note,
    place: stop.place,
    link: stop.link,
    order: stop.order,
    ...patch,
  };
}

/** Timed stops first by time, then untimed ones; inside the same time by sort key, then id. */
export function compareStops(a: ItineraryStop, b: ItineraryStop): number {
  if (a.time !== b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return a.order - b.order || compareIds(a.id, b.id);
}

const MAX_DAYS = 60;
const MAX_STOPS = 500;

/** Merge config and shared state into ordered days with their stops. Never throws on bad state. */
export function resolveItinerary(config: ItineraryConfig, data: ToolState): ItineraryDay[] {
  const days: ItineraryDay[] = [];
  const configDays = new Set<string>();
  for (const [index, day] of listOf(config?.days).entries()) {
    configDays.add(day.id);
    if (data[`removed:day:${day.id}`] === true) continue;
    const override = data[`day:${day.id}`];
    const edited = isRecord(override) ? override : null;
    days.push({
      id: day.id,
      label: (edited && cleanText(edited.label, 40)) || day.label,
      date:
        edited && typeof edited.date === "string" ? cleanDate(edited.date) : cleanDate(day.date),
      order: index,
      fromConfig: true,
      stops: [],
    });
  }
  const addedDays: ItineraryDay[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("day:")) continue;
    const id = key.slice("day:".length);
    if (!id || configDays.has(id) || !isRecord(value)) continue;
    if (data[`removed:day:${id}`] === true) continue;
    const label = cleanText(value.label, 40);
    if (!label) continue;
    addedDays.push({
      id,
      label,
      date: cleanDate(value.date),
      order: cleanOrder(value.order),
      fromConfig: false,
      stops: [],
    });
  }
  addedDays.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  days.push(...addedDays.slice(0, MAX_DAYS));
  const byId = new Map(days.map((day) => [day.id, day]));

  const going = new Map<string, ItineraryGoer[]>();
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("going:")) continue;
    const rest = key.slice("going:".length);
    const cut = rest.indexOf(":");
    if (cut <= 0 || cut === rest.length - 1) continue;
    const stopId = rest.slice(0, cut);
    const memberId = rest.slice(cut + 1);
    const name = isRecord(value) ? cleanText(value.name, 40) : cleanText(value, 40);
    if (!name) continue;
    const list = going.get(stopId) ?? [];
    list.push({ id: memberId, name });
    going.set(stopId, list);
  }
  for (const list of going.values()) list.sort((a, b) => compareIds(a.id, b.id));

  const parse = (value: JsonValue | undefined): StoredStop | null => {
    if (!isRecord(value)) return null;
    const title = cleanText(value.title, 80);
    const dayId = typeof value.dayId === "string" ? value.dayId : "";
    if (!title || !dayId) return null;
    return {
      dayId,
      time: cleanTime(value.time),
      title,
      note: cleanText(value.note, 300),
      place: cleanText(value.place, 80),
      link: cleanText(value.link, 500),
      order: cleanOrder(value.order),
    };
  };
  const place = (id: string, stored: StoredStop, fromConfig: boolean) => {
    const day = byId.get(stored.dayId);
    if (!day) return;
    day.stops.push({
      id,
      ...stored,
      fromConfig,
      done: data[`done:${id}`] === true,
      booked: data[`booked:${id}`] === true,
      going: going.get(id) ?? [],
    });
  };

  const configStops = new Set<string>();
  for (const [index, stop] of listOf(config?.stops).entries()) {
    configStops.add(stop.id);
    if (data[`removed:stop:${stop.id}`] === true) continue;
    const edited = parse(data[`stop:${stop.id}`]);
    place(
      stop.id,
      edited ?? {
        dayId: stop.dayId,
        time: cleanTime(stop.time),
        title: stop.title,
        note: stop.note ?? "",
        place: stop.place ?? "",
        link: stop.link ?? "",
        order: index,
      },
      true,
    );
  }
  let added = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("stop:")) continue;
    const id = key.slice("stop:".length);
    if (!id || configStops.has(id) || data[`removed:stop:${id}`] === true) continue;
    const stored = parse(value);
    if (!stored || added >= MAX_STOPS) continue;
    added++;
    place(id, stored, false);
  }
  for (const day of days) day.stops.sort(compareStops);
  return days;
}

/** Sort key that puts a new stop (or day) after everything in `items`. */
export function orderAfter(items: { order: number }[]): number {
  let max = -1;
  for (const item of items) if (item.order > max) max = item.order;
  return Math.floor(max) + 1;
}

/**
 * New sort key for moving a stop one place up (-1) or down (1) inside its day. Stops are
 * ordered by time first, so a stop can only trade places with a neighbour that has the
 * same time (or, like it, none). Null when it cannot move.
 */
export function moveOrder(
  stops: ItineraryStop[],
  stopId: string,
  direction: -1 | 1,
): number | null {
  const sorted = [...stops].sort(compareStops);
  const index = sorted.findIndex((stop) => stop.id === stopId);
  const stop = sorted[index];
  const neighbour = sorted[index + direction];
  if (!stop || !neighbour || neighbour.time !== stop.time) return null;
  const beyond = sorted[index + 2 * direction];
  if (beyond && beyond.time === stop.time) {
    const middle = (neighbour.order + beyond.order) / 2;
    if (middle !== neighbour.order && middle !== beyond.order) return middle;
  }
  return neighbour.order + direction;
}

/* ---------------------------------------------------------------- definition */

export const itinerary: WidgetDef<ItineraryConfig> = {
  type: "itinerary",
  title: "Itinerary",
  description: "A day-by-day plan with times, places and who is joining.",
  guide: [
    "Use for trip plans, event schedules and agendas: days with timed stops that the group edits, books and ticks off.",
    'config.days: [{id, label, date?}] in order; label like "Day 1" or "Saturday"; date is "YYYY-MM-DD".',
    'config.stops: [{id, dayId, time?, title, note?, place?, link?}]; time is 24 hour "HH:MM"; link must be http or https and is shown as text. Stops without a time come after the timed ones.',
    "config.allowAdd: members may add stops and days (default true). Editing, moving and removing is always possible.",
    "State keys:",
    '"stop:<id>" = {dayId, time, title, note, place, link, order}: an added stop, or the edited version of a config stop with the same id. Empty string for unset text fields; order is a number used to sort stops that share a time (config stops start at their index).',
    '"removed:stop:<id>" = true: stop removed.',
    '"day:<id>" = {label, date, order}: an added day (sorted by order after the config days) or new label/date for a config day. "removed:day:<id>" = true hides a day and its stops.',
    '"done:<stopId>" = true and "booked:<stopId>" = true: independent marks; delete the key to clear.',
    '"going:<stopId>:<memberId>" = {name}: that member is joining the stop; delete the key to leave.',
  ].join("\n"),
  configSchema,
  starter: {
    title: "Lisbon long weekend",
    description:
      "Our plan for three days. Add stops, mark what is booked and say which ones you are joining.",
    config: {
      allowAdd: true,
      days: [
        { id: "fri", label: "Friday", date: "2026-05-15" },
        { id: "sat", label: "Saturday", date: "2026-05-16" },
        { id: "sun", label: "Sunday", date: "2026-05-17" },
      ],
      stops: [
        {
          id: "arrive",
          dayId: "fri",
          time: "11:40",
          title: "Land and take the metro into town",
          place: "Humberto Delgado Airport",
        },
        {
          id: "checkin",
          dayId: "fri",
          time: "14:00",
          title: "Check in at the apartment",
          place: "Alfama",
          note: "Key box code is in the booking mail.",
        },
        { id: "walk", dayId: "fri", time: "16:30", title: "Walk up to the Santa Luzia viewpoint" },
        {
          id: "dinner1",
          dayId: "fri",
          time: "20:00",
          title: "Dinner and fado",
          place: "Mesa de Frades",
          note: "Table for six under Deniz.",
        },
        { id: "tram", dayId: "sat", time: "09:30", title: "Tram 28 across the old town" },
        {
          id: "market",
          dayId: "sat",
          time: "12:30",
          title: "Lunch at the food market",
          place: "Mercado da Ribeira",
        },
        {
          id: "belem",
          dayId: "sat",
          time: "15:00",
          title: "Belem tower and the monastery",
          place: "Belem",
          link: "https://www.visitlisboa.com/en/places/belem-tower",
        },
        { id: "sunset", dayId: "sat", title: "Sunset drinks somewhere with a view" },
        {
          id: "sintra",
          dayId: "sun",
          time: "09:00",
          title: "Day trip to Sintra",
          place: "Rossio station",
          note: "Trains leave every 30 minutes.",
        },
        { id: "pack", dayId: "sun", time: "17:30", title: "Back to pack and head to the airport" },
        { id: "gifts", dayId: "sun", title: "Pick up tinned fish and pasteis for home" },
      ],
    },
    initialState: {
      "booked:checkin": true,
      "booked:dinner1": true,
      "done:arrive": true,
    },
  },
  keywords: [
    "itinerary",
    "trip",
    "travel",
    "plan",
    "schedule",
    "agenda",
    "day",
    "days",
    "route",
    "vacation",
    "holiday",
    "tour",
    "program",
    "gezi",
    "tatil",
    "seyahat",
    "rota",
    "gun",
  ],
};
