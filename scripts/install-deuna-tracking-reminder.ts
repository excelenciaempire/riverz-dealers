/**
 * Compatibilidad con el instalador anterior.
 * El recordatorio ahora incluye una captura del rastreo validada por visión.
 *
 * Run: node --env-file=.env.local --import tsx scripts/install-deuna-tracking-reminder.ts
 */
async function main() {
  const { installDeunaTrackingEvidence } = await import(
    '../src/lib/tracking/install'
  );
  console.log(JSON.stringify(await installDeunaTrackingEvidence(), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
