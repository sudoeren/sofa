import type { TemplateInfo } from "@sofra/shared";
import {
  Armchair,
  CalendarCheck,
  LayoutGrid,
  ListChecks,
  type LucideIcon,
  MapPinned,
  Table2,
  Trophy,
  Vote,
  Wallet,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  poll: Vote,
  checklist: ListChecks,
  availability: CalendarCheck,
  table: Table2,
  expenses: Wallet,
  itinerary: MapPinned,
  bracket: Trophy,
  seating: Armchair,
};

export function templateIcon(templateId: string): LucideIcon {
  return ICONS[templateId] ?? LayoutGrid;
}

export const EXAMPLE_PROMPTS = [
  "A poll to pick a restaurant for Friday, with three options",
  "A three-day itinerary for Lisbon with morning, afternoon and evening",
  "Split the cabin costs between five people",
  "A bracket for an 8-player table tennis tournament",
  "A weekly chore tracker for our flat",
];

type ListProps = {
  templates: TemplateInfo[];
  /** id of the template being added, if any */
  busyId: string | null;
  onPick: (template: TemplateInfo) => void;
};

export function TemplateList({ templates, busyId, onPick }: ListProps) {
  return (
    <ul className="template-grid">
      {templates.map((template) => {
        const Icon = templateIcon(template.id);
        return (
          <li key={template.id}>
            <button
              type="button"
              className="template-card"
              onClick={() => onPick(template)}
              disabled={busyId !== null}
              aria-busy={busyId === template.id}
            >
              <span className="template-icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="template-title">{template.title}</span>
              <span className="template-text">{template.description}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
