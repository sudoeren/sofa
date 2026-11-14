import {
  type ChatMessage,
  chatArray,
  listTools,
  type Material,
  materialsArray,
  metaMap,
  type ToolRecord,
  toolsMap,
} from "@sofra/shared";
import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";

type Store<T> = { subscribe: (onChange: () => void) => () => void; getSnapshot: () => T };

/**
 * Wrap a Y type as an external store. The snapshot is cached and only recomputed after a
 * change, so useSyncExternalStore gets a stable reference between changes.
 */
export function createYStore<T>(
  // biome-ignore lint/suspicious/noExplicitAny: any shared type
  target: Y.AbstractType<any>,
  read: () => T,
  options: {
    deep?: boolean;
    filter?: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => boolean;
  } = {},
): Store<T> {
  let cache: { value: T } | null = null;
  return {
    subscribe(onChange) {
      const invalidate = () => {
        cache = null;
        onChange();
      };
      // changes may have happened while nobody was subscribed
      cache = null;
      if (options.deep) {
        const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
          if (!options.filter || options.filter(events)) invalidate();
        };
        target.observeDeep(handler);
        return () => target.unobserveDeep(handler);
      }
      target.observe(invalidate);
      return () => target.unobserve(invalidate);
    },
    getSnapshot() {
      if (!cache) cache = { value: read() };
      return cache.value;
    },
  };
}

/** Items of a Y.Array; re-renders on local and remote changes. */
export function useYArray<T>(array: Y.Array<T>): T[] {
  const store = useMemo(() => createYStore(array, () => array.toArray()), [array]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Keys of a Y.Map (not its nested values). */
export function useYMapKeys(map: Y.Map<unknown>): string[] {
  const store = useMemo(() => createYStore(map, () => Array.from(map.keys())), [map]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** One value of a Y.Map. Meant for primitives; objects get a new identity on each change. */
export function useYMapValue<T>(map: Y.Map<unknown>, key: string): T | undefined {
  const store = useMemo(() => createYStore(map, () => map.get(key) as T | undefined), [map, key]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Tool records sorted by order. Changes inside a tool's `state` map are ignored here: the
 * runtime subscribes to those itself, so a vote does not re-render the whole grid.
 */
export function useTools(doc: Y.Doc): ToolRecord[] {
  const store = useMemo(
    () =>
      createYStore(toolsMap(doc), () => listTools(doc), {
        deep: true,
        filter: (events) => events.some((event) => event.path[1] !== "state"),
      }),
    [doc],
  );
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useMaterials(doc: Y.Doc): Material[] {
  return useYArray(useMemo(() => materialsArray(doc), [doc]));
}

export function useChat(doc: Y.Doc): ChatMessage[] {
  return useYArray(useMemo(() => chatArray(doc), [doc]));
}

export function useSpaceTitle(doc: Y.Doc): string {
  const title = useYMapValue<unknown>(
    useMemo(() => metaMap(doc), [doc]),
    "title",
  );
  return typeof title === "string" ? title : "";
}
