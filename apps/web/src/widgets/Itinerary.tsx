import type { ItineraryConfig } from "@sofa/widgets";
import {
  cleanDate,
  cleanTime,
  formatDayDate,
  type ItineraryDay,
  type ItineraryStop,
  moveOrder,
  orderAfter,
  resolveItinerary,
  type StoredStop,
  safeLink,
  toStoredStop,
} from "@sofa/widgets/defs/itinerary";
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Plus,
  Settings2,
  Ticket,
  Trash2,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Avatar, InlineEdit, newKeyId } from "./shared";
import type { WidgetProps } from "./types";
import "./common.css";
import "./itinerary.css";

export function Itinerary({ config, data, set, del, me, members }: WidgetProps<ItineraryConfig>) {
  const days = useMemo(() => resolveItinerary(config, data), [config, data]);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  // bumped when an empty title is refused, so the field shows the stored text again
  const [editKey, setEditKey] = useState(0);
  const allowAdd = config.allowAdd !== false;

  function writeStop(stop: ItineraryStop, patch: Partial<StoredStop>) {
    set(`stop:${stop.id}`, toStoredStop(stop, patch));
  }

  function removeStop(stop: ItineraryStop) {
    if (stop.fromConfig) set(`removed:stop:${stop.id}`, true);
    else del(`stop:${stop.id}`);
    setOpenStop(null);
  }

  function writeDay(day: ItineraryDay, patch: { label?: string; date?: string }) {
    set(`day:${day.id}`, { label: day.label, date: day.date, order: day.order, ...patch });
  }

  function removeDay(day: ItineraryDay) {
    set(`removed:day:${day.id}`, true);
    setOpenDay(null);
  }

  function addDay() {
    const added = days.filter((day) => !day.fromConfig);
    set(`day:${newKeyId()}`, {
      label: `Day ${days.length + 1}`,
      date: "",
      order: orderAfter(added),
    });
  }

  function addStop(day: ItineraryDay, title: string, time: string) {
    const stored: StoredStop = {
      dayId: day.id,
      time: cleanTime(time),
      title,
      note: "",
      place: "",
      link: "",
      order: orderAfter(day.stops),
    };
    set(`stop:${newKeyId()}`, stored);
  }

  return (
    <div className="w-root it-root">
      {days.length === 0 && <div className="w-empty w-small">No days yet.</div>}
      {days.map((day) => {
        const dateText = formatDayDate(day.date);
        const done = day.stops.filter((stop) => stop.done).length;
        return (
          <section key={day.id} className="it-day" aria-label={day.label}>
            <header className="it-day-head">
              <div className="it-day-title">
                <InlineEdit
                  key={editKey}
                  className="it-day-label"
                  value={day.label}
                  onCommit={(label) =>
                    label ? writeDay(day, { label: label.slice(0, 40) }) : setEditKey(editKey + 1)
                  }
                  ariaLabel={`Name of ${day.label}`}
                  maxLength={40}
                />
              </div>
              {dateText && <span className="w-small w-muted it-day-date">{dateText}</span>}
              {day.stops.length > 0 && (
                <span className="w-small w-muted w-num it-day-count">
                  {done}/{day.stops.length}
                </span>
              )}
              <button
                type="button"
                className="w-icon-btn"
                aria-label={`Options for ${day.label}`}
                aria-expanded={openDay === day.id}
                onClick={() => setOpenDay(openDay === day.id ? null : day.id)}
              >
                <Settings2 size={14} aria-hidden="true" />
              </button>
            </header>
            {openDay === day.id && (
              <DayOptions
                day={day}
                onDate={(date) => writeDay(day, { date })}
                onRemove={() => removeDay(day)}
              />
            )}

            {day.stops.length === 0 ? (
              <div className="w-small w-muted it-none">Nothing planned yet.</div>
            ) : (
              <ol className="it-stops">
                {day.stops.map((stop) => {
                  const link = safeLink(stop.link);
                  const mine = stop.going.some((goer) => goer.id === me.id);
                  const open = openStop === stop.id;
                  return (
                    <li key={stop.id} className={`it-stop${stop.done ? " is-done" : ""}`}>
                      <div className="it-time w-num w-small">{stop.time}</div>
                      <div className="it-rail">
                        <button
                          type="button"
                          className="it-dot"
                          aria-pressed={stop.done}
                          aria-label={`${stop.title}: done`}
                          title={stop.done ? "Mark as not done" : "Mark as done"}
                          onClick={() =>
                            stop.done ? del(`done:${stop.id}`) : set(`done:${stop.id}`, true)
                          }
                        >
                          {stop.done && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                        </button>
                      </div>
                      <div className="it-body">
                        <div className="it-line">
                          <button
                            type="button"
                            className="w-grow it-title"
                            aria-expanded={open}
                            aria-label={`Details of ${stop.title}`}
                            title={open ? "Close" : "Edit details"}
                            onClick={() => setOpenStop(open ? null : stop.id)}
                          >
                            <span className="it-title-text">{stop.title}</span>
                            {open ? (
                              <ChevronUp size={14} aria-hidden="true" />
                            ) : (
                              <ChevronDown size={14} aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            className={`w-icon-btn it-join${mine ? " is-on" : ""}`}
                            aria-pressed={mine}
                            aria-label={`I'm in: ${stop.title}`}
                            title={mine ? "I'm in (tap to leave)" : "I'm in"}
                            onClick={() =>
                              mine
                                ? del(`going:${stop.id}:${me.id}`)
                                : set(`going:${stop.id}:${me.id}`, { name: me.name })
                            }
                          >
                            {mine ? (
                              <UserCheck size={15} aria-hidden="true" />
                            ) : (
                              <UserPlus size={15} aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        {(stop.place ||
                          stop.note ||
                          link ||
                          stop.booked ||
                          stop.going.length > 0) && (
                          <div className="it-meta w-small">
                            {stop.booked && (
                              <span className="w-chip w-chip-accent">
                                <Ticket size={11} aria-hidden="true" />
                                Booked
                              </span>
                            )}
                            {stop.place && (
                              <span className="it-place">
                                <MapPin size={12} aria-hidden="true" />
                                {stop.place}
                              </span>
                            )}
                            {link && (
                              <a
                                className="it-link"
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink size={12} aria-hidden="true" />
                                {link.text}
                              </a>
                            )}
                            {stop.going.length > 0 && (
                              <ul className="it-going" aria-label={`${stop.going.length} joining`}>
                                {stop.going.slice(0, 6).map((goer) => {
                                  const member = members.find((m) => m.id === goer.id);
                                  return (
                                    <li key={goer.id}>
                                      <Avatar
                                        size={18}
                                        member={{
                                          name: member?.name ?? goer.name,
                                          color: member?.color,
                                        }}
                                      />
                                    </li>
                                  );
                                })}
                                {stop.going.length > 6 && (
                                  <li className="w-muted w-num">+{stop.going.length - 6}</li>
                                )}
                              </ul>
                            )}
                            {stop.note && <span className="it-note w-muted">{stop.note}</span>}
                          </div>
                        )}
                        {open && (
                          <StopEditor
                            stop={stop}
                            day={day}
                            days={days}
                            editKey={editKey}
                            onEmptyTitle={() => setEditKey(editKey + 1)}
                            onPatch={(patch) => writeStop(stop, patch)}
                            onBooked={() =>
                              stop.booked
                                ? del(`booked:${stop.id}`)
                                : set(`booked:${stop.id}`, true)
                            }
                            onRemove={() => removeStop(stop)}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {allowAdd && <AddStop day={day} onAdd={(title, time) => addStop(day, title, time)} />}
          </section>
        );
      })}
      {allowAdd && (
        <button type="button" className="w-btn it-add-day" onClick={addDay}>
          <CalendarPlus size={15} aria-hidden="true" />
          Add a day
        </button>
      )}
    </div>
  );
}

function DayOptions({
  day,
  onDate,
  onRemove,
}: {
  day: ItineraryDay;
  onDate: (date: string) => void;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const count = day.stops.length;
  return (
    <div className="it-panel">
      <label className="it-field">
        <span className="w-small w-muted">Date</span>
        <input
          type="date"
          className="w-input"
          value={day.date}
          onChange={(event) => onDate(cleanDate(event.target.value))}
        />
      </label>
      <button
        type="button"
        className="w-btn w-btn-ghost it-danger"
        onClick={() => (confirm || count === 0 ? onRemove() : setConfirm(true))}
      >
        <Trash2 size={14} aria-hidden="true" />
        {confirm ? `Remove with ${count} ${count === 1 ? "stop" : "stops"}?` : "Remove day"}
      </button>
    </div>
  );
}

function StopEditor({
  stop,
  day,
  days,
  editKey,
  onEmptyTitle,
  onPatch,
  onBooked,
  onRemove,
}: {
  stop: ItineraryStop;
  day: ItineraryDay;
  days: ItineraryDay[];
  editKey: number;
  onEmptyTitle: () => void;
  onPatch: (patch: Partial<StoredStop>) => void;
  onBooked: () => void;
  onRemove: () => void;
}) {
  const up = moveOrder(day.stops, stop.id, -1);
  const down = moveOrder(day.stops, stop.id, 1);
  const hint = stop.time
    ? "Stops with a time are ordered by time"
    : "Stops without a time can be reordered";
  return (
    <div className="it-panel it-editor">
      <div className="it-field">
        <span className="w-small w-muted">Title</span>
        <InlineEdit
          key={editKey}
          className="it-boxed"
          value={stop.title}
          onCommit={(title) => (title ? onPatch({ title: title.slice(0, 80) }) : onEmptyTitle())}
          ariaLabel="Title"
          maxLength={80}
        />
      </div>
      <div className="it-editor-grid">
        <label className="it-field it-field-time">
          <span className="w-small w-muted">Time</span>
          <input
            type="time"
            className="w-input w-num"
            value={stop.time}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "" || cleanTime(value)) onPatch({ time: value });
            }}
          />
        </label>
        <label className="it-field">
          <span className="w-small w-muted">Day</span>
          <select
            className="w-input"
            value={stop.dayId}
            onChange={(event) => {
              const target = days.find((d) => d.id === event.target.value);
              if (target && target.id !== stop.dayId) {
                onPatch({ dayId: target.id, order: orderAfter(target.stops) });
              }
            }}
          >
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="it-field">
        <span className="w-small w-muted">Place</span>
        <InlineEdit
          className="it-boxed"
          value={stop.place}
          onCommit={(place) => onPatch({ place: place.slice(0, 80) })}
          placeholder="Where"
          ariaLabel="Place"
          maxLength={80}
        />
      </div>
      <div className="it-field">
        <span className="w-small w-muted">Note</span>
        <InlineEdit
          className="it-boxed"
          value={stop.note}
          onCommit={(note) => onPatch({ note: note.slice(0, 300) })}
          placeholder="Anything to remember"
          ariaLabel="Note"
          maxLength={300}
        />
      </div>
      <div className="it-field">
        <span className="w-small w-muted">Link</span>
        <InlineEdit
          className="it-boxed"
          value={stop.link}
          onCommit={(link) => onPatch({ link: link.slice(0, 500) })}
          placeholder="https://"
          ariaLabel="Link"
          maxLength={500}
        />
        {stop.link && !safeLink(stop.link) && (
          <span className="w-small it-warn">Only http and https links are shown.</span>
        )}
      </div>
      <div className="it-editor-actions">
        <button
          type="button"
          className={`w-btn it-booked${stop.booked ? " is-on" : ""}`}
          aria-pressed={stop.booked}
          onClick={onBooked}
        >
          <Ticket size={14} aria-hidden="true" />
          Booked
        </button>
        <button
          type="button"
          className="w-icon-btn"
          aria-label="Move up"
          title={up === null ? hint : "Move up"}
          disabled={up === null}
          onClick={() => up !== null && onPatch({ order: up })}
        >
          <ArrowUp size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="w-icon-btn"
          aria-label="Move down"
          title={down === null ? hint : "Move down"}
          disabled={down === null}
          onClick={() => down !== null && onPatch({ order: down })}
        >
          <ArrowDown size={15} aria-hidden="true" />
        </button>
        <span className="w-grow" />
        <button type="button" className="w-btn w-btn-ghost it-danger" onClick={onRemove}>
          <Trash2 size={14} aria-hidden="true" />
          Remove
        </button>
      </div>
    </div>
  );
}

function AddStop({
  day,
  onAdd,
}: {
  day: ItineraryDay;
  onAdd: (title: string, time: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim().slice(0, 80);
    if (!clean) return;
    onAdd(clean, time);
    setTitle("");
    setTime("");
  }
  return (
    <form className="it-add" onSubmit={submit}>
      <input
        type="time"
        className="w-input w-num it-add-time"
        value={time}
        onChange={(event) => setTime(event.target.value)}
        aria-label={`Time of the new stop on ${day.label}`}
      />
      <input
        className="w-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a stop"
        aria-label={`New stop on ${day.label}`}
        maxLength={80}
      />
      <button
        type="submit"
        className="w-btn it-add-btn"
        disabled={!title.trim()}
        aria-label={`Add stop to ${day.label}`}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
    </form>
  );
}
