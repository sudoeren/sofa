import { availability } from "./defs/availability";
import { bracket } from "./defs/bracket";
import { checklist } from "./defs/checklist";
import { expenses } from "./defs/expenses";
import { itinerary } from "./defs/itinerary";
import { poll } from "./defs/poll";
import { seating } from "./defs/seating";
import { table } from "./defs/table";
import type { WidgetDef } from "./types";

export type { AvailabilityConfig } from "./defs/availability";
export type { BracketConfig } from "./defs/bracket";
export type { ChecklistConfig } from "./defs/checklist";
export type { ExpensesConfig } from "./defs/expenses";
export type { ItineraryConfig } from "./defs/itinerary";
export type { PollConfig } from "./defs/poll";
export type { SeatingConfig } from "./defs/seating";
export type { TableConfig } from "./defs/table";
export type { WidgetDef } from "./types";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous config types
export const WIDGET_DEFS: WidgetDef<any>[] = [
  poll,
  checklist,
  availability,
  table,
  expenses,
  itinerary,
  bracket,
  seating,
];

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous config types
export function getWidgetDef(type: string): WidgetDef<any> | undefined {
  return WIDGET_DEFS.find((def) => def.type === type);
}
