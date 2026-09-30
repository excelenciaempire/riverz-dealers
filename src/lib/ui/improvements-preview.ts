/**
 * The owner requested that additions from the Commslayer plan remain hidden
 * until the complete comparison. Only an explicitly configured comparison
 * build can expose them. This controls presentation, never authorization.
 * Keep future UI additions behind this same gate.
 */
export const SHOW_RIVERZ_IMPROVEMENTS = process.env.NEXT_PUBLIC_RIVERZ_UI_STAGE === 'comparison'
