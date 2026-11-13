import { z } from "zod";
import type { WidgetDef } from "../types";

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "ids use letters, digits, _ and - only");

const column = z
  .object({
    id,
    label: z.string().trim().min(1).max(40),
    type: z.enum(["text", "number", "checkbox", "member", "select"]).default("text"),
    options: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .refine((col) => col.type !== "select" || (col.options?.length ?? 0) >= 1, {
    message: "a select column needs options",
    path: ["options"],
  });

const cellValue = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);

const configSchema = z
  .object({
    columns: z.array(column).min(1).max(12),
    rows: z
      .array(z.object({ id, cells: z.record(z.string(), cellValue).default({}) }))
      .max(200)
      .default([]),
    allowAddRows: z.boolean().default(true),
    allowAddColumns: z.boolean().default(false),
    summary: z.enum(["none", "sum"]).default("none"),
  })
  .refine((config) => new Set(config.columns.map((c) => c.id)).size === config.columns.length, {
    message: "column ids must be unique",
    path: ["columns"],
  })
  .refine((config) => new Set(config.rows.map((r) => r.id)).size === config.rows.length, {
    message: "row ids must be unique",
    path: ["rows"],
  });

export type TableConfig = z.infer<typeof configSchema>;

export const table: WidgetDef<TableConfig> = {
  type: "table",
  title: "Table",
  description: "A small shared table for anything structured, edited by everyone.",
  guide: [
    'Use for structured rows with several fields: "who brings what", a packing list with quantities, a contact sheet, a simple budget. For a plain to-do list use checklist; for splitting costs use expenses.',
    'config.columns: 1 to 12 of { id, label, type, options? }. type is "text" (default), "number", "checkbox", "member" (pick a member of the space) or "select" (options: 1 to 20 strings, required for select).',
    "config.rows: initial content, up to 200 of { id, cells: { <columnId>: value } }. value is a string, number, boolean or null matching the column type (member columns: a name as string). Missing cells are empty.",
    "Ids are short, stable and unique (letters, digits, _ and -). Keep them when you change the config so edits survive.",
    'config.allowAddRows (default true): members can add and remove rows. config.allowAddColumns (default false): members can add, rename and remove columns. config.summary: "sum" shows a footer with the total of each number column (default "none").',
    "State keys:",
    "cell:<rowId>:<columnId> = string (text, select) | number | boolean (checkbox) | { id: memberId, name: string } (member) | null (emptied; overrides the config value). Delete the key to fall back to the config value.",
    "row:<rowId> = { createdAt: number (ms), by?: memberId }: a row added by a member. rowRemoved:<rowId> = true hides a row.",
    'col:<columnId> = { label: string, type?: "text" | "number" | "checkbox" | "member" | "select", options?: string[], createdAt: number (ms) }: a column added by a member, or a new label for a config column with the same id (its type stays). colRemoved:<columnId> = true hides a column.',
    "Order: config rows and columns first, then member-added ones by createdAt, then id.",
  ].join("\n"),
  configSchema,
  starter: {
    title: "Potluck: who brings what",
    description: "Sign up for a dish so we do not end up with five desserts.",
    config: {
      columns: [
        { id: "dish", label: "Dish", type: "text" },
        {
          id: "course",
          label: "Course",
          type: "select",
          options: ["Starter", "Main", "Side", "Dessert", "Drinks"],
        },
        { id: "who", label: "Who", type: "member" },
        { id: "serves", label: "Serves", type: "number" },
        { id: "veg", label: "Vegetarian", type: "checkbox" },
      ],
      rows: [
        { id: "r1", cells: { dish: "Lentil soup", course: "Starter", serves: 8, veg: true } },
        {
          id: "r2",
          cells: { dish: "Stuffed vine leaves", course: "Starter", serves: 10, veg: true },
        },
        { id: "r3", cells: { dish: "Roast chicken with potatoes", course: "Main", serves: 6 } },
        { id: "r4", cells: { dish: "Green salad", course: "Side", serves: 8, veg: true } },
        { id: "r5", cells: { dish: "Baklava", course: "Dessert", serves: 12, veg: true } },
        { id: "r6", cells: { dish: "Lemonade and sparkling water", course: "Drinks", serves: 12 } },
      ],
      allowAddRows: true,
      allowAddColumns: true,
      summary: "sum",
    },
  },
  keywords: [
    "table",
    "sheet",
    "spreadsheet",
    "grid",
    "rows",
    "columns",
    "potluck",
    "brings",
    "contacts",
    "inventory",
    "quantities",
    "tablo",
    "cizelge",
    "kim ne getiriyor",
    "envanter",
    "rehber",
  ],
};
