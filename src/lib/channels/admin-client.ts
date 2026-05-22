/**
 * Channel-engine service-role client. Same singleton as the automation
 * engine — re-exported here so adapter code imports from the channel
 * namespace.
 */
export { supabaseAdmin } from "@/lib/automations/admin-client";
