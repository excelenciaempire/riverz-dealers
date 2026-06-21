import type { MessageEntry, Namespace } from "./types";

// === Namespace registry ====================================================
// Each feature area's strings live in its own file (one namespace = one
// file). The flat MESSAGES map is keyed "<namespace>.<key>".
// Keep this list alphabetized for easy merges.
import { assistant } from "./assistant";
import { auth } from "./auth";
import { automations } from "./automations";
import { broadcasts } from "./broadcasts";
import { common } from "./common";
import { contacts } from "./contacts";
import { dashboard } from "./dashboard";
import { errAccount } from "./errAccount";
import { errAi } from "./errAi";
import { errFlows } from "./errFlows";
import { errInbox } from "./errInbox";
import { errMeta } from "./errMeta";
import { errProducts } from "./errProducts";
import { errWhatsapp } from "./errWhatsapp";
import { flows } from "./flows";
import { igAgent } from "./igAgent";
import { inbox } from "./inbox";
import { landing } from "./landing";
import { legal } from "./legal";
import { layout } from "./layout";
import { metrics } from "./metrics";
import { nav } from "./nav";
import { products } from "./products";
import { settings } from "./settings";
import { system } from "./system";
import { templates } from "./templates";

const NAMESPACES: Record<string, Namespace> = {
  assistant,
  auth,
  automations,
  broadcasts,
  common,
  contacts,
  dashboard,
  errAccount,
  errAi,
  errFlows,
  errInbox,
  errMeta,
  errProducts,
  errWhatsapp,
  flows,
  igAgent,
  inbox,
  landing,
  legal,
  layout,
  metrics,
  nav,
  products,
  settings,
  system,
  templates,
};

/** Flat lookup: { "nav.inbox": { es, en }, ... } built once at module load. */
export const MESSAGES: Record<string, MessageEntry> = Object.fromEntries(
  Object.entries(NAMESPACES).flatMap(([ns, entries]) =>
    Object.entries(entries).map(([key, value]) => [`${ns}.${key}`, value]),
  ),
);
