import { z } from "zod";
import type { WidgetDef } from "../types";

const id = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "ids use letters, digits, _ and - only");

const configSchema = z
  .object({
    question: z.string().trim().min(1).max(200),
    options: z
      .array(z.object({ id, label: z.string().trim().min(1).max(120) }))
      .max(20)
      .default([]),
    multiple: z.boolean().default(false),
    allowAdd: z.boolean().default(true),
    anonymous: z.boolean().default(false),
    showResults: z.enum(["always", "afterVote"]).default("always"),
  })
  .refine((config) => new Set(config.options.map((o) => o.id)).size === config.options.length, {
    message: "option ids must be unique",
    path: ["options"],
  })
  .refine((config) => config.allowAdd || config.options.length >= 2, {
    message: "a poll needs at least two options unless members can add their own",
    path: ["options"],
  });

export type PollConfig = z.infer<typeof configSchema>;

export const poll: WidgetDef<PollConfig> = {
  type: "poll",
  title: "Poll",
  description: "Ask a question, let everyone vote and see the result live.",
  guide: [
    "Use for one question the group decides by voting: where to eat, which date, which name. For several questions create several polls.",
    "config.question: the question (max 200 chars).",
    "config.options: [{ id, label }], up to 20; ids are short, stable and unique (letters, digits, _ and -). Keep ids when you change labels so votes survive.",
    "config.multiple: true lets each member pick several options (default false).",
    "config.allowAdd: true lets members add, rename and remove options (default true). With false, give at least two options.",
    'config.anonymous: true shows only counts, not who voted (default false). config.showResults: "always" (default) or "afterVote" (results hidden until the member has voted).',
    "State keys:",
    "vote:<memberId> = { name: string, color?: string, choices: string[] (option ids), at: number (ms) }; delete the key to retract. With multiple=false choices holds one id.",
    "option:<optionId> = { label: string, createdAt: number (ms), by?: memberId }: an option added by a member, or a new label for a config option with the same id.",
    "removed:<optionId> = true hides an option (config or member-added); votes for hidden or unknown ids are ignored.",
    "Order: config options first, then member-added options by createdAt, then id.",
  ].join("\n"),
  configSchema,
  starter: {
    title: "Friday dinner",
    description: "Vote for where we eat on Friday night.",
    config: {
      question: "Where should we eat on Friday?",
      options: [
        { id: "meze", label: "Meze place by the harbour" },
        { id: "pizza", label: "Wood-fired pizza" },
        { id: "ramen", label: "Ramen bar" },
        { id: "home", label: "Cook together at home" },
      ],
      multiple: false,
      allowAdd: true,
      anonymous: false,
      showResults: "always",
    },
  },
  keywords: [
    "poll",
    "vote",
    "voting",
    "survey",
    "choose",
    "pick",
    "decide",
    "which",
    "favorite",
    "anket",
    "oylama",
    "oy",
    "secim",
    "hangisi",
  ],
};
