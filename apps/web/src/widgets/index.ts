import type { ComponentType } from "react";
import { Availability } from "./Availability";
import { Bracket } from "./Bracket";
import { Checklist } from "./Checklist";
import { Expenses } from "./Expenses";
import { Itinerary } from "./Itinerary";
import { Poll } from "./Poll";
import { Seating } from "./Seating";
import { Table } from "./Table";
import type { WidgetProps } from "./types";

export type { WidgetProps } from "./types";

/** widget type id -> component */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous config types
export const WIDGETS: Record<string, ComponentType<WidgetProps<any>>> = {
  poll: Poll,
  checklist: Checklist,
  availability: Availability,
  table: Table,
  expenses: Expenses,
  itinerary: Itinerary,
  bracket: Bracket,
  seating: Seating,
};
