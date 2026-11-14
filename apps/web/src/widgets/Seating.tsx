import type { SeatingConfig } from "@sofra/widgets";
import {
  canSeat,
  freeSeats,
  MAX_SEATS,
  orderAfter,
  resolveSeating,
  type SeatingGuest,
  type SeatingTable,
} from "@sofra/widgets/defs/seating";
import { GripVertical, Minus, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type PointerEvent, useMemo, useRef, useState } from "react";
import { InlineEdit, newKeyId } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./seating.css";

const POOL = "pool";
const DRAG_THRESHOLD = 6;

type DragState = { id: string; name: string; x: number; y: number; over: string | null };
type DragStart = { id: string; pointerId: number; x: number; y: number; active: boolean };

export function Seating({ config, data, set, del }: WidgetProps<SeatingConfig>) {
  const view = useMemo(() => resolveSeating(config, data), [config, data]);
  const { tables, guests, pool } = view;
  const allowAdd = config.allowAdd !== false;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // id of the table that just refused a guest because it is full
  const [refusedAt, setRefusedAt] = useState<string | null>(null);
  const [newGuest, setNewGuest] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editKey, setEditKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<DragStart | null>(null);
  const suppressClick = useRef(false);

  const selected = selectedId ? (guests.find((guest) => guest.id === selectedId) ?? null) : null;

  function moveGuest(guest: SeatingGuest, target: string): boolean {
    if (target === POOL) {
      if (guest.tableId) del(`seat:${guest.id}`);
      setRefusedAt(null);
      return true;
    }
    const table = tables.find((t) => t.id === target);
    if (!table) return false;
    if (!canSeat(table, guest.id)) {
      setRefusedAt(table.id);
      return false;
    }
    if (guest.tableId !== table.id) set(`seat:${guest.id}`, table.id);
    setRefusedAt(null);
    return true;
  }

  function placeSelected(target: string) {
    if (selected && moveGuest(selected, target)) setSelectedId(null);
  }

  function removeGuest(guest: SeatingGuest) {
    if (guest.fromConfig) set(`removed:guest:${guest.id}`, true);
    else del(`guest:${guest.id}`);
    del(`seat:${guest.id}`);
    setSelectedId(null);
    setRefusedAt(null);
  }

  function addGuest(event: FormEvent) {
    event.preventDefault();
    const name = newGuest.trim().slice(0, 40);
    if (!name) return;
    set(`guest:${newKeyId()}`, {
      name,
      order: orderAfter(guests.filter((guest) => !guest.fromConfig)),
    });
    setNewGuest("");
  }

  function writeTable(table: SeatingTable, patch: { name?: string; seats?: number }) {
    set(`table:${table.id}`, {
      name: table.name,
      seats: table.seats,
      order: table.order,
      ...patch,
    });
  }

  function addTable() {
    const last = tables[tables.length - 1];
    set(`table:${newKeyId()}`, {
      name: `Table ${tables.length + 1}`,
      seats: last?.seats ?? 6,
      order: orderAfter(tables.filter((table) => !table.fromConfig)),
    });
  }

  function removeTable(table: SeatingTable) {
    if (table.fromConfig) set(`removed:table:${table.id}`, true);
    else del(`table:${table.id}`);
    setRefusedAt(null);
  }

  /* drag and drop with pointer events (mouse, pen and touch) */

  function dropTargetAt(x: number, y: number): string | null {
    if (typeof document.elementFromPoint !== "function") return null;
    const hit = document.elementFromPoint(x, y)?.closest("[data-drop]");
    if (!hit || !rootRef.current?.contains(hit)) return null;
    return hit.getAttribute("data-drop");
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, guest: SeatingGuest) {
    if (event.button !== 0) return;
    // A finger on the name scrolls the page; touch dragging starts from the grip.
    const onGrip = (event.target as Element).closest?.("[data-grip]") !== null;
    if (event.pointerType !== "mouse" && !onGrip) return;
    suppressClick.current = false;
    dragStart.current = {
      id: guest.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // capture is a nicety; dragging still works while the pointer stays over the chip
    }
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>, guest: SeatingGuest) {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId || start.id !== guest.id) return;
    if (!start.active) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
      start.active = true;
    }
    setDrag({
      id: guest.id,
      name: guest.name,
      x: event.clientX,
      y: event.clientY,
      over: dropTargetAt(event.clientX, event.clientY),
    });
  }

  function endDrag(
    event: PointerEvent<HTMLButtonElement>,
    guest: SeatingGuest,
    cancelled: boolean,
  ) {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    dragStart.current = null;
    if (!start.active) return;
    suppressClick.current = true;
    setDrag(null);
    if (cancelled) return;
    const target = dropTargetAt(event.clientX, event.clientY);
    if (target && moveGuest(guest, target)) setSelectedId(null);
  }

  function onGuestClick(guest: SeatingGuest) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setRefusedAt(null);
    setSelectedId(selectedId === guest.id ? null : guest.id);
  }

  const chip = (guest: SeatingGuest) => (
    <li key={guest.id}>
      <button
        type="button"
        className={`st-guest${selectedId === guest.id ? " is-selected" : ""}${drag?.id === guest.id ? " is-dragging" : ""}`}
        aria-pressed={selectedId === guest.id}
        aria-label={`${guest.name}${selectedId === guest.id ? ", selected" : ""}`}
        onClick={() => onGuestClick(guest)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && selectedId) {
            setSelectedId(null);
            setRefusedAt(null);
          }
        }}
        onPointerDown={(event) => onPointerDown(event, guest)}
        onPointerMove={(event) => onPointerMove(event, guest)}
        onPointerUp={(event) => endDrag(event, guest, false)}
        onPointerCancel={(event) => endDrag(event, guest, true)}
      >
        <span className="st-grip" data-grip="" aria-hidden="true">
          <GripVertical size={13} />
        </span>
        <span className="st-guest-name">{guest.name}</span>
      </button>
    </li>
  );

  const seatedCount = guests.length - pool.length;

  return (
    <div className={`w-root st-root${drag ? " is-dragging" : ""}`} ref={rootRef}>
      <div className="st-bar">
        {selected ? (
          <>
            <span className="w-small w-muted st-bar-label">Moving</span>
            <span className="w-grow st-bar-name">
              <InlineEdit
                key={`${selected.id}:${editKey}`}
                value={selected.name}
                onCommit={(name) =>
                  name
                    ? set(`guest:${selected.id}`, {
                        name: name.slice(0, 40),
                        order: selected.order,
                      })
                    : setEditKey(editKey + 1)
                }
                ariaLabel={`Name of ${selected.name}`}
                maxLength={40}
              />
            </span>
            <button
              type="button"
              className="w-icon-btn st-danger"
              aria-label={`Remove ${selected.name}`}
              title="Remove guest"
              onClick={() => removeGuest(selected)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="w-icon-btn"
              aria-label="Cancel selection"
              title="Cancel"
              onClick={() => {
                setSelectedId(null);
                setRefusedAt(null);
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </>
        ) : (
          <span className="w-small w-muted w-grow st-hint">
            {seatedCount} of {guests.length} seated. Tap or drag a guest to move.
          </span>
        )}
      </div>

      <section
        className={`st-pool${drag?.over === POOL ? " is-over" : ""}`}
        data-drop={POOL}
        aria-label="Unseated guests"
      >
        <div className="st-pool-head">
          <h4 className="st-heading">Unseated</h4>
          <span className="w-chip w-num">{pool.length}</span>
          <span className="w-grow" />
          {selected?.tableId && (
            <button type="button" className="w-btn st-place" onClick={() => placeSelected(POOL)}>
              Unseat {selected.name}
            </button>
          )}
        </div>
        {pool.length === 0 ? (
          <div className="w-small w-muted st-pool-empty">
            {guests.length === 0 ? "No guests yet." : "Everyone has a seat."}
          </div>
        ) : (
          <ul className="st-guests">{pool.map(chip)}</ul>
        )}
        {allowAdd && (
          <form className="st-add" onSubmit={addGuest}>
            <input
              className="w-input"
              value={newGuest}
              onChange={(event) => setNewGuest(event.target.value)}
              placeholder="Add a guest"
              aria-label="Name of the guest to add"
              maxLength={40}
            />
            <button
              type="submit"
              className="w-btn st-add-btn"
              disabled={!newGuest.trim()}
              aria-label="Add guest"
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          </form>
        )}
      </section>

      <div className="st-tables">
        {tables.map((table) => {
          const taken = table.guests.length;
          const free = freeSeats(table);
          const over = taken > table.seats;
          const full = free === 0;
          const sitsHere = selected?.tableId === table.id;
          const refused = drag?.over === table.id && !canSeat(table, drag.id);
          return (
            <section
              key={table.id}
              className={`st-table${full ? " is-full" : ""}${drag?.over === table.id ? (refused ? " is-refused" : " is-over") : ""}`}
              data-drop={table.id}
              aria-label={table.name}
            >
              <header className="st-table-head">
                <span className="w-grow st-table-name">
                  <InlineEdit
                    key={editKey}
                    value={table.name}
                    onCommit={(name) =>
                      name
                        ? writeTable(table, { name: name.slice(0, 40) })
                        : setEditKey(editKey + 1)
                    }
                    ariaLabel={`Name of ${table.name}`}
                    maxLength={40}
                  />
                </span>
                <button
                  type="button"
                  className="w-icon-btn st-step"
                  aria-label={`One seat fewer at ${table.name}`}
                  disabled={table.seats <= Math.max(1, taken)}
                  onClick={() => writeTable(table, { seats: table.seats - 1 })}
                >
                  <Minus size={13} aria-hidden="true" />
                </button>
                <span
                  className={`w-num w-small st-count${over ? " is-over" : ""}`}
                  title={`${taken} of ${table.seats} seats taken`}
                >
                  {taken}/{table.seats}
                </span>
                <button
                  type="button"
                  className="w-icon-btn st-step"
                  aria-label={`One seat more at ${table.name}`}
                  disabled={table.seats >= MAX_SEATS}
                  onClick={() => writeTable(table, { seats: table.seats + 1 })}
                >
                  <Plus size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="w-icon-btn st-quiet"
                  aria-label={`Remove ${table.name}`}
                  title={taken > 0 ? "Remove table (its guests become unseated)" : "Remove table"}
                  onClick={() => removeTable(table)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
              <ul className="st-guests">
                {table.guests.map(chip)}
                {Array.from({ length: free }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
                  <li key={`free-${index}`} className="st-free" aria-hidden="true" />
                ))}
              </ul>
              <div className="st-table-foot">
                {refusedAt === table.id && full ? (
                  <span className="w-small st-over-text" role="status">
                    Full: {table.seats === 1 ? "the only seat is" : `all ${table.seats} seats are`}{" "}
                    taken
                  </span>
                ) : (
                  <span className={`w-small ${over ? "st-over-text" : "w-muted"}`}>
                    {over ? `Over by ${taken - table.seats}` : full ? "Full" : `${free} free`}
                  </span>
                )}
                {selected && !sitsHere && (
                  <button
                    type="button"
                    className={`w-btn st-place${full ? "" : " w-btn-primary"}`}
                    aria-label={`Seat ${selected.name} at ${table.name}`}
                    onClick={() => placeSelected(table.id)}
                  >
                    Seat here
                  </button>
                )}
              </div>
            </section>
          );
        })}
        {allowAdd && (
          <button type="button" className="st-add-table" onClick={addTable}>
            <Plus size={15} aria-hidden="true" />
            Add a table
          </button>
        )}
      </div>

      {drag && (
        <div className="st-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.name}
        </div>
      )}
    </div>
  );
}
