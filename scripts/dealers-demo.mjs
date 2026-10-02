import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// A demonstration is always isolated from live accounts, even if .env.local exists.
const child = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DEALERS_DEMO_ONLY: 'true',
      NEXT_PUBLIC_RIVERZ_VERTICAL: 'dealers',
      NEXT_PUBLIC_SUPABASE_URL: 'https://dealers-demo.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'demo-placeholder',
      SUPABASE_SERVICE_ROLE_KEY: '',
      AUTOMATION_CRON_SECRET: '',
      LATITUDE_API_KEY: '',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  }
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
