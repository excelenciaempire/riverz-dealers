/** Internal presentation account: configured UI, no autonomous operation or charges.
 * The allowlist is server-owned; neither profile metadata nor tenant settings
 * can grant a live merchant this exemption.
 */
export const PRESENTATION_WORKSPACE_ID = '165c45e4-c67d-4c79-b00a-c14bafe888f6';

export function isPresentationWorkspace(
  workspaceId: string | null | undefined
): boolean {
  return workspaceId === PRESENTATION_WORKSPACE_ID;
}
