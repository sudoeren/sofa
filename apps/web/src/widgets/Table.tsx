import type { JsonValue, MemberInfo, ToolState } from "@sofa/shared";
import type { TableConfig } from "@sofa/widgets";
import { Plus, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Avatar, asRecord, entriesWithPrefix, InlineEdit, MemberPick, newKeyId } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./table.css";

type ColumnType = "text" | "number" | "checkbox" | "member" | "select";
type Column = { id: string; label: string; type: ColumnType; options: string[]; createdAt: number };
type Row = { id: string; cells: Record<string, unknown>; createdAt: number };
type MemberRef = { id: string; name: string };

const TYPES: ColumnType[] = ["text", "number", "checkbox", "member", "select"];
const ADDABLE: { type: ColumnType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "checkbox", label: "Checkbox" },
  { type: "member", label: "Member" },
];
const MAX_ROWS = 300;
const MAX_COLUMNS = 16;
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function isType(value: unknown): value is ColumnType {
  return typeof value === "string" && (TYPES as string[]).includes(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v !== "")
    : [];
}

function createdAtOf(record: Record<string, unknown> | undefined): number {
  return typeof record?.createdAt === "number" && Number.isFinite(record.createdAt)
    ? record.createdAt
    : 0;
}

function readColumns(config: TableConfig, data: ToolState): Column[] {
  const out: Column[] = [];
  const seen = new Set<string>();
  for (const column of config.columns ?? []) {
    seen.add(column.id);
    if (data[`colRemoved:${column.id}`] === true) continue;
    const override = asRecord(data[`col:${column.id}`]);
    const label =
      typeof override?.label === "string" && override.label.trim()
        ? override.label.trim()
        : column.label;
    const options = stringList(column.options);
    const type = isType(column.type) ? column.type : "text";
    out.push({
      id: column.id,
      label,
      type: type === "select" && options.length === 0 ? "text" : type,
      options,
      createdAt: 0,
    });
  }
  const added: Column[] = [];
  for (const [id, value] of entriesWithPrefix(data, "col:")) {
    if (seen.has(id) || id.includes(":") || data[`colRemoved:${id}`] === true) continue;
    const record = asRecord(value);
    if (typeof record?.label !== "string" || !record.label.trim()) continue;
    const options = stringList(record.options);
    const type = isType(record.type) ? record.type : "text";
    added.push({
      id,
      label: record.label.trim(),
      type: type === "select" && options.length === 0 ? "text" : type,
      options,
      createdAt: createdAtOf(record),
    });
  }
  added.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return out.concat(added).slice(0, MAX_COLUMNS);
}

function readRows(config: TableConfig, data: ToolState): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const row of config.rows ?? []) {
    seen.add(row.id);
    if (data[`rowRemoved:${row.id}`] === true) continue;
    out.push({ id: row.id, cells: asRecord(row.cells) ?? {}, createdAt: 0 });
  }
  const added: Row[] = [];
  for (const [id, value] of entriesWithPrefix(data, "row:")) {
    if (seen.has(id) || id.includes(":") || data[`rowRemoved:${id}`] === true) continue;
    if (value !== true && !asRecord(value)) continue;
    added.push({ id, cells: {}, createdAt: createdAtOf(asRecord(value)) });
  }
  added.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return out.concat(added).slice(0, MAX_ROWS);
}

/** state wins over config; null in state means "emptied" */
function rawCell(data: ToolState, row: Row, columnId: string): unknown {
  const key = `cell:${row.id}:${columnId}`;
  return key in data ? data[key] : row.cells[columnId];
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asMember(value: unknown): MemberRef | null {
  if (typeof value === "string" && value.trim()) return { id: "", name: value.trim() };
  const record = asRecord(value);
  if (!record || typeof record.name !== "string" || !record.name.trim()) return null;
  return { id: typeof record.id === "string" ? record.id : "", name: record.name };
}

function isEmptyCell(value: unknown): boolean {
  return value === undefined || value === null || value === "" || value === false;
}

/** Text or number input that keeps a local draft while focused. */
function InputCell({
  value,
  numeric,
  label,
  cellId,
  onCommit,
  onMove,
}: {
  value: string;
  numeric: boolean;
  label: string;
  cellId: string;
  onCommit: (draft: string) => void;
  onMove: (direction: "up" | "down" | "enter", draftEmpty: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onMove("enter", draft.trim() === "");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove("down", draft.trim() === "");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove("up", draft.trim() === "");
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelled.current = true;
      event.currentTarget.blur();
    }
  }

  return (
    <input
      type="text"
      inputMode={numeric ? "decimal" : undefined}
      className={numeric ? "tb-input tb-number w-num" : "tb-input"}
      data-cell={cellId}
      aria-label={label}
      value={draft}
      maxLength={numeric ? 20 : 500}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        focused.current = true;
        cancelled.current = false;
        event.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        if (cancelled.current || draft.trim() === value.trim()) {
          cancelled.current = false;
          setDraft(value);
          return;
        }
        if (numeric && draft.trim() !== "" && asNumber(draft) === null) {
          setDraft(value);
          return;
        }
        onCommit(draft.trim());
      }}
      onKeyDown={onKeyDown}
    />
  );
}

export function Table({ config, data, set, del, me, members }: WidgetProps<TableConfig>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnDraft, setColumnDraft] = useState("");
  const [columnType, setColumnType] = useState<ColumnType>("text");
  const columnInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingColumn) columnInput.current?.focus();
  }, [addingColumn]);

  const columns = readColumns(config, data);
  const rows = readRows(config, data);
  const present: MemberInfo[] = members.some((m) => m.id === me.id) ? members : [me, ...members];
  const canAddRows = config.allowAddRows !== false;
  const canAddColumns = config.allowAddColumns === true;
  const showSum = config.summary === "sum" && columns.some((c) => c.type === "number");

  function focusCell(cellId: string): boolean {
    const nodes = rootRef.current?.querySelectorAll<HTMLElement>("[data-cell]") ?? [];
    for (const node of nodes) {
      if (node.dataset.cell === cellId) {
        node.focus();
        return true;
      }
    }
    return false;
  }

  useEffect(() => {
    if (pendingFocus && focusCell(pendingFocus)) setPendingFocus(null);
  });

  function writeCell(row: Row, column: Column, value: JsonValue | undefined) {
    const key = `cell:${row.id}:${column.id}`;
    if (value !== undefined && value !== null && value !== "") return set(key, value);
    // emptied: a config value has to be overridden, otherwise the key can go
    if (isEmptyCell(row.cells[column.id])) del(key);
    else set(key, null);
  }

  function addRow(focusColumnId?: string) {
    if (!canAddRows || rows.length >= MAX_ROWS) return;
    const id = newKeyId();
    set(`row:${id}`, { createdAt: Date.now(), by: me.id });
    const target = focusColumnId ?? columns[0]?.id;
    if (target) setPendingFocus(`${id}:${target}`);
  }

  function move(
    rowIndex: number,
    column: Column,
    direction: "up" | "down" | "enter",
    draftEmpty: boolean,
  ) {
    const next = rows[direction === "up" ? rowIndex - 1 : rowIndex + 1];
    if (next) {
      focusCell(`${next.id}:${column.id}`);
      return;
    }
    if (direction !== "enter") return;
    const row = rows[rowIndex];
    const rowEmpty =
      draftEmpty &&
      row !== undefined &&
      columns.every((c) => c.id === column.id || isEmptyCell(rawCell(data, row, c.id)));
    if (rowEmpty || !canAddRows) {
      // nothing to continue from: just commit by leaving the field
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    addRow(column.id);
  }

  function addColumn() {
    const label = columnDraft.trim().slice(0, 40);
    if (!label || columns.length >= MAX_COLUMNS) return;
    set(`col:${newKeyId()}`, { label, type: columnType, createdAt: Date.now() });
    setColumnDraft("");
    setColumnType("text");
    setAddingColumn(false);
  }

  function renameColumn(column: Column, label: string) {
    const stored = asRecord(data[`col:${column.id}`]) ?? {};
    set(`col:${column.id}`, {
      ...(stored as Record<string, JsonValue>),
      label: label.slice(0, 40),
      createdAt: createdAtOf(stored) || column.createdAt || Date.now(),
    });
  }

  function renderCell(row: Row, rowIndex: number, column: Column) {
    const raw = rawCell(data, row, column.id);
    const cellId = `${row.id}:${column.id}`;
    const label = `${column.label}, row ${rowIndex + 1}`;
    if (column.type === "checkbox") {
      return (
        <input
          type="checkbox"
          className="tb-checkbox"
          data-cell={cellId}
          aria-label={label}
          checked={raw === true}
          onChange={(event) => set(`cell:${row.id}:${column.id}`, event.target.checked)}
        />
      );
    }
    if (column.type === "select") {
      const value = asText(raw);
      const options =
        value && !column.options.includes(value) ? [...column.options, value] : column.options;
      return (
        <select
          className={value ? "tb-select" : "tb-select is-empty"}
          data-cell={cellId}
          aria-label={label}
          value={value}
          onChange={(event) => writeCell(row, column, event.target.value)}
        >
          <option value="">-</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    if (column.type === "member") {
      const stored = asMember(raw);
      const live = stored ? present.find((m) => m.id === stored.id) : undefined;
      const name = live?.name ?? stored?.name ?? "";
      return (
        <MemberPick
          className="tb-member"
          style={{ display: "flex", borderRadius: 0, outlineOffset: -2 }}
          value={stored ? { id: stored.id, name } : null}
          members={present}
          onChange={(next) => writeCell(row, column, next)}
          ariaLabel={label}
        >
          {stored ? (
            <>
              <Avatar size={20} member={{ name, color: live?.color }} />
              <span className="tb-member-name">{name}</span>
            </>
          ) : (
            <span className="tb-placeholder">Pick</span>
          )}
        </MemberPick>
      );
    }
    const numeric = column.type === "number";
    const number = numeric ? asNumber(raw) : null;
    return (
      <InputCell
        value={numeric ? (number === null ? "" : String(number)) : asText(raw)}
        numeric={numeric}
        label={label}
        cellId={cellId}
        onCommit={(draft) =>
          writeCell(row, column, numeric ? (asNumber(draft) ?? undefined) : draft)
        }
        onMove={(direction, draftEmpty) => move(rowIndex, column, direction, draftEmpty)}
      />
    );
  }

  const firstNumber = columns.findIndex((c) => c.type === "number");

  return (
    <div className="w-root tb-root" ref={rootRef}>
      {columns.length === 0 ? (
        <div className="w-empty">
          This table has no columns{canAddColumns ? " yet. Add one below." : "."}
        </div>
      ) : (
        <div className="tb-scroll">
          <table className="tb-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.id} scope="col" className={`tb-th is-${column.type}`}>
                    {canAddColumns ? (
                      <span className="tb-th-inner">
                        <InlineEdit
                          value={column.label}
                          onCommit={(label) => renameColumn(column, label)}
                          ariaLabel={`Rename column ${column.label}`}
                          maxLength={40}
                          required
                        />
                        {columns.length > 1 ? (
                          <button
                            type="button"
                            className="w-icon-btn tb-hover-btn"
                            aria-label={`Remove column ${column.label}`}
                            onClick={() => set(`colRemoved:${column.id}`, true)}
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
                {canAddRows ? (
                  <th className="tb-actions">
                    <span className="tb-sr">Row actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row.id} className="tb-row">
                  {columns.map((column) => (
                    <td key={column.id} className={`tb-td is-${column.type}`}>
                      {renderCell(row, rowIndex, column)}
                    </td>
                  ))}
                  {canAddRows ? (
                    <td className="tb-actions">
                      <button
                        type="button"
                        className="w-icon-btn tb-hover-btn"
                        aria-label={`Remove row ${rowIndex + 1}`}
                        onClick={() => set(`rowRemoved:${row.id}`, true)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className="tb-none" colSpan={columns.length + (canAddRows ? 1 : 0)}>
                    {canAddRows ? "No rows yet. Add the first one below." : "No rows yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
            {showSum ? (
              <tfoot>
                <tr>
                  {columns.map((column, index) => {
                    if (column.type === "number") {
                      let sum = 0;
                      for (const row of rows) sum += asNumber(rawCell(data, row, column.id)) ?? 0;
                      return (
                        <td
                          key={column.id}
                          className="tb-sum is-number w-num"
                          aria-label={`Total ${column.label}`}
                        >
                          {numberFormat.format(sum)}
                        </td>
                      );
                    }
                    return (
                      <td key={column.id} className="tb-sum">
                        {index === 0 && firstNumber > 0 ? "Total" : ""}
                      </td>
                    );
                  })}
                  {canAddRows ? <td className="tb-sum tb-actions" /> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      {addingColumn ? (
        <div className="tb-column-form">
          <input
            className="w-input w-grow"
            ref={columnInput}
            value={columnDraft}
            maxLength={40}
            placeholder="Column name"
            aria-label="Column name"
            onChange={(event) => setColumnDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addColumn();
              } else if (event.key === "Escape") {
                setAddingColumn(false);
              }
            }}
          />
          <select
            className="w-input tb-type"
            aria-label="Column type"
            value={columnType}
            onChange={(event) =>
              setColumnType(isType(event.target.value) ? event.target.value : "text")
            }
          >
            {ADDABLE.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="w-btn w-btn-primary"
            onClick={addColumn}
            disabled={!columnDraft.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="w-btn w-btn-ghost"
            onClick={() => setAddingColumn(false)}
          >
            Cancel
          </button>
        </div>
      ) : canAddRows || canAddColumns ? (
        <div className="w-row tb-foot">
          {canAddRows && columns.length > 0 ? (
            <button type="button" className="w-btn w-btn-ghost tb-add" onClick={() => addRow()}>
              <Plus size={15} aria-hidden="true" /> Add row
            </button>
          ) : null}
          {canAddColumns && columns.length < MAX_COLUMNS ? (
            <button
              type="button"
              className="w-btn w-btn-ghost tb-add"
              onClick={() => setAddingColumn(true)}
            >
              <Plus size={15} aria-hidden="true" /> Add column
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
