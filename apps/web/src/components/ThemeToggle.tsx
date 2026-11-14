import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../lib/storage";
import { useTheme } from "../lib/theme";
import { Menu, MenuItem } from "./Menu";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Theme picker: follow the system, or always light or dark. */
export function ThemeToggle() {
  const { theme, preference, setPreference } = useTheme();
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0];
  const TriggerIcon = preference === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <Menu
      label={`Theme: ${current?.label ?? "System"}`}
      icon={<TriggerIcon size={18} aria-hidden="true" />}
    >
      {(close) =>
        OPTIONS.map(({ value, label, icon: Icon }) => (
          <MenuItem
            key={value}
            icon={value === preference ? <Check size={16} /> : <Icon size={16} />}
            onSelect={() => {
              setPreference(value);
              close();
            }}
          >
            {label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
