import type { ToolState } from "@sofa/shared";
import type { z } from "zod";

/**
 * A built-in tool type. The definition is shared by the server (validation, model prompt,
 * starter templates) and the web app (which has one React component per type in
 * apps/web/src/widgets/<Type>.tsx).
 */
export type WidgetDef<C = unknown> = {
  /** stable id, lower-case, e.g. "poll" */
  type: string;
  title: string;
  /** one sentence for people, shown in the starter gallery */
  description: string;
  /**
   * For the model: when to use this widget, what each config field means, and which state
   * keys the component reads and writes. Keep it short and exact.
   */
  guide: string;
  configSchema: z.ZodType<C>;
  /** shown in the starter gallery and used when the AI is not available */
  starter: { title: string; description: string; config: C; initialState?: ToolState };
  /** words that suggest this widget when matching a request without AI */
  keywords: string[];
};
