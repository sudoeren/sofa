import { z } from "zod";
import type { WidgetDef } from "../types";

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "ids use letters, digits, _ and - only");

const configSchema = z
  .object({
    prompt: z.string().trim().min(1).max(200),
    slots: z
      .array(z.object({ id, label: z.string().trim().min(1).max(60) }))
      .max(24)
      .default([]),
    allowMaybe: z.boolean().default(true),
    allowAdd: z.boolean().default(true),
  })
  .refine((config) => new Set(config.slots.map((s) => s.id)).size === config.slots.length, {
    message: "slot ids must be unique",
    path: ["slots"],
  })
  .refine((config) => config.allowAdd || config.slots.length >= 1, {
    message: "give at least one slot unless members can add their own",
    path: ["slots"],
  });

export type AvailabilityConfig = z.infer<typeof configSchema>;

export const availability: WidgetDef<AvailabilityConfig> = {
  type: "availability",
  title: "Availability",
  description: "Find a time that works: everyone marks the slots they can make.",
  guide: [
    "Use to find a date or time that suits the group: each member marks every slot yes, maybe or no and the best slot is highlighted. For a plain vote on one option use poll.",
    "config.prompt: what is being scheduled (max 200 chars).",
    'config.slots: [{ id, label }], up to 24, in chronological order. label is free text you write from the request, short, e.g. "Fri 14 Mar, evening" or "Sat 10:00". ids are short, stable and unique (letters, digits, _ and -); keep them when you change labels so answers survive.',
    'config.allowMaybe: true adds a "maybe" answer between yes and no (default true).',
    "config.allowAdd: true lets members add, rename and remove slots (default true). With false, give at least one slot.",
    "State keys:",
    'answer:<memberId>:<slotId> = "yes" | "maybe" | "no"; delete the key for no answer.',
    "who:<memberId> = { name: string, color?: string }: written when a member first answers, so they stay listed by name after leaving.",
    "slot:<slotId> = { label: string, createdAt: number (ms), by?: memberId }: a slot added by a member, or a new label for a config slot with the same id.",
    "removed:<slotId> = true hides a slot (config or member-added).",
    "Best slot: most yes answers, ties broken by fewest no answers; all tied slots are highlighted. Order: config slots, then member-added by createdAt, then id.",
  ].join("\n"),
  configSchema,
  starter: {
    title: "Housewarming dinner",
    description: "Mark the evenings you can make and we pick the best one.",
    config: {
      prompt: "When can you come to the housewarming dinner?",
      slots: [
        { id: "fri-20", label: "Fri 20 Nov, evening" },
        { id: "sat-21", label: "Sat 21 Nov, evening" },
        { id: "sun-22", label: "Sun 22 Nov, lunch" },
        { id: "fri-27", label: "Fri 27 Nov, evening" },
        { id: "sat-28", label: "Sat 28 Nov, evening" },
      ],
      allowMaybe: true,
      allowAdd: true,
    },
  },
  keywords: [
    "availability",
    "available",
    "schedule",
    "scheduling",
    "when",
    "date",
    "time",
    "meet",
    "meeting",
    "free",
    "musait",
    "musaitlik",
    "uygun",
    "zaman",
    "tarih",
    "bulusma",
    "toplanti",
  ],
};
