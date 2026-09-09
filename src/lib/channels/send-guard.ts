import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

export const CHANNEL_DISCONNECTED_CODE = "channel_disconnected";

export class ChannelDisconnectedError extends Error {
  readonly code = CHANNEL_DISCONNECTED_CODE;

  constructor() {
    super(CHANNEL_DISCONNECTED_CODE);
    this.name = "ChannelDisconnectedError";
  }
}

/** Fast guard for a connection row that was just loaded by the caller. */
export function assertConnectionCanSend(
  connection: Pick<ChannelConnection, "status">,
): void {
  if (connection.status === "disconnected") {
    throw new ChannelDisconnectedError();
  }
}

/**
 * Fresh database guard for long-running automatic work. An AI response may
 * start while the channel is connected and finish after the user disconnects
 * it, so checking the snapshot passed into the job is not enough.
 */
export async function storedConnectionCanSend(
  db: SupabaseClient,
  connectionId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("channel_connections")
    .select("status")
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && data.status !== "disconnected");
}

export async function assertStoredConnectionCanSend(
  db: SupabaseClient,
  connectionId: string,
): Promise<void> {
  if (!(await storedConnectionCanSend(db, connectionId))) {
    throw new ChannelDisconnectedError();
  }
}

export function isChannelDisconnectedError(
  error: unknown,
): error is ChannelDisconnectedError {
  return (
    error instanceof ChannelDisconnectedError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === CHANNEL_DISCONNECTED_CODE)
  );
}
