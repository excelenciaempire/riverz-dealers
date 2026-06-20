import type { MessageEntry, Namespace } from "./types";

// === Namespace registry ====================================================
// Each feature area's strings live in its own file (one namespace = one
// file). Translation agents create a `messages/<ns>.ts` file and add a
// single line here. The flat MESSAGES map is keyed "<namespace>.<key>".
//
// Keep this list alphabetized for easy merges.
import { common } from "./common";
import { nav } from "./nav";
import { settings } from "./settings";

const NAMESPACES: Record<string, Namespace> = {
  common,
  nav,
  settings,
};

/** Flat lookup: { "nav.inbox": { es, en }, ... } built once at module load. */
export const MESSAGES: Record<string, MessageEntry> = Object.fromEntries(
  Object.entries(NAMESPACES).flatMap(([ns, entries]) =>
    Object.entries(entries).map(([key, value]) => [`${ns}.${key}`, value]),
  ),
);
