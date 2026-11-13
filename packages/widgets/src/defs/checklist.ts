import { z } from "zod";
import type { WidgetDef } from "../types";

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "ids use letters, digits, _ and - only");

const configSchema = z
  .object({
    items: z
      .array(
        z.object({
          id,
          text: z.string().trim().min(1).max(200),
          section: z.string().trim().max(60).optional(),
        }),
      )
      .max(100)
      .default([]),
    assignable: z.boolean().default(true),
    showProgress: z.boolean().default(true),
  })
  .refine((config) => new Set(config.items.map((i) => i.id)).size === config.items.length, {
    message: "item ids must be unique",
    path: ["items"],
  });

export type ChecklistConfig = z.infer<typeof configSchema>;

export const checklist: WidgetDef<ChecklistConfig> = {
  type: "checklist",
  title: "Checklist",
  description: "Things to do or bring: check them off and claim who does what.",
  guide: [
    "Use for a list of things to do, buy, pack or bring, optionally with who takes care of each. For rows with several fields (quantities, notes) use table.",
    "config.items: [{ id, text, section? }], up to 100; ids are short, stable and unique (letters, digits, _ and -). section is an optional heading; items with the same section text are grouped, in order of first appearance, items without a section first.",
    'config.assignable: true lets members claim an item ("I\'ll do it") or assign it to someone (default true).',
    'config.showProgress: true shows a progress bar and "x of y done" (default true).',
    "Members can always add, rename and remove items. Keep ids when you change the config so their progress survives.",
    "State keys:",
    "done:<itemId> = { by: memberId, name: string, at: number (ms) }; delete the key to uncheck.",
    "claim:<itemId> = { id: memberId, name: string, color?: string }; delete the key to unassign.",
    "item:<itemId> = { text: string, section?: string, createdAt: number (ms), by?: memberId }: an item added by a member, or new text for a config item with the same id.",
    "removed:<itemId> = true hides an item (config or member-added).",
    "Order inside a section: config items first, then member-added items by createdAt, then id.",
  ].join("\n"),
  configSchema,
  starter: {
    title: "Cabin weekend",
    description: "Everything we need to sort out before the trip.",
    config: {
      items: [
        { id: "book", text: "Confirm the cabin booking", section: "Before we go" },
        { id: "cars", text: "Decide who drives", section: "Before we go" },
        { id: "playlist", text: "Make a road trip playlist", section: "Before we go" },
        { id: "breakfast", text: "Breakfast for two mornings", section: "Food" },
        { id: "bbq", text: "Meat and vegetables for the barbecue", section: "Food" },
        { id: "coffee", text: "Coffee, tea and snacks", section: "Food" },
        { id: "firewood", text: "Firewood and matches", section: "Gear" },
        { id: "games", text: "Board games and cards", section: "Gear" },
        { id: "speaker", text: "Bluetooth speaker", section: "Gear" },
      ],
      assignable: true,
      showProgress: true,
    },
  },
  keywords: [
    "checklist",
    "todo",
    "to-do",
    "tasks",
    "task",
    "list",
    "packing",
    "bring",
    "shopping",
    "groceries",
    "chores",
    "liste",
    "yapilacak",
    "yapilacaklar",
    "gorev",
    "alisveris",
    "bavul",
  ],
};
