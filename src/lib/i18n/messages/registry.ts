import type { MessageEntry, Namespace } from "./types";
import { voiceNotes } from './voiceNotes';

// === Namespace registry ====================================================
// Each feature area's strings live in its own file (one namespace = one
// file). The flat MESSAGES map is keyed "<namespace>.<key>".
// Keep this list alphabetized for easy merges.
import { admin } from "./admin";
import { onboarding } from "./onboarding";
import { pitch } from "./pitch";
import { assistant } from "./assistant";
import { auth } from "./auth";
import { automations } from "./automations";
import { broadcasts } from "./broadcasts";
import { common } from "./common";
import { contacts } from "./contacts";
import { dashboard } from "./dashboard";
import { deliveryErrors } from "./deliveryErrors";
import { errAccount } from "./errAccount";
import { errAi } from "./errAi";
import { errFlows } from "./errFlows";
import { errInbox } from "./errInbox";
import { errMeta } from "./errMeta";
import { errProducts } from "./errProducts";
import { errStores } from "./errStores";
import { errWhatsapp } from "./errWhatsapp";
import { flows } from "./flows";
import { health } from "./health";
import { igAgent } from "./igAgent";
import { inbox } from "./inbox";
import { landing } from "./landing";
import { landingV2 } from "./landingV2";
import { landingV3 } from "./landingV3";
import { landingV4 } from "./landingV4";
import { legal } from "./legal";
import { layout } from "./layout";
import { metrics } from "./metrics";
import { nav } from "./nav";
import { oauth } from "./oauth";
import { operation } from "./operation";
import { pliego } from "./pliego";
import { products } from "./products";
import { settings } from "./settings";
import { system } from "./system";
import { templates } from "./templates";
import { voice } from "./voice";
import { webchat } from "./webchat";
import { returns, gaps, unify, approvals, reglas } from "./returns";

const NAMESPACES: Record<string, Namespace> = {
  pitch,
  onboarding,
  admin,
  assistant,
  auth,
  automations,
  broadcasts,
  common,
  contacts,
  dashboard,
  deliveryErrors,
  errAccount,
  errAi,
  errFlows,
  errInbox,
  errMeta,
  errProducts,
  errStores,
  errWhatsapp,
  flows,
  health,
  igAgent,
  inbox,
  landing,
  landingV2,
  landingV3,
  landingV4,
  legal,
  layout,
  metrics,
  nav,
  oauth,
  operation,
  pliego,
  products,
  settings,
  system,
  templates,
  voice,
  voiceNotes,
  webchat,
  returns,
  gaps,
  unify,
  approvals,
  reglas,
};

/** Flat lookup: { "nav.inbox": { es, en }, ... } built once at module load. */
export const MESSAGES: Record<string, MessageEntry> = Object.fromEntries(
  Object.entries(NAMESPACES).flatMap(([ns, entries]) =>
    Object.entries(entries).map(([key, value]) => [`${ns}.${key}`, value]),
  ),
);
