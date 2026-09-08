import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (...parts: string[]) =>
  readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');

describe('robustez para varios comercios y varias cuentas por canal', () => {
  const pollers = [
    ['lib', 'channels', 'gmail', 'poll.ts'],
    ['lib', 'channels', 'outlook', 'poll.ts'],
    ['lib', 'channels', 'zoho', 'poll.ts'],
    ['lib', 'channels', 'mercadolibre', 'poll.ts'],
    ['lib', 'channels', 'mercadolibre', 'messages-poll.ts'],
    ['lib', 'channels', 'mercadolibre', 'orders.ts'],
    ['lib', 'channels', 'mercadolibre', 'catalog.ts'],
    ['lib', 'channels', 'mercadolibre', 'reviews.ts'],
    ['lib', 'channels', 'mercadolibre', 'claims-poll.ts'],
    ['lib', 'channels', 'tiktok_comment', 'poll.ts'],
    ['app', 'api', 'meta', 'ads-sync', 'route.ts'],
    ['app', 'api', 'cron', 'gmail-watch', 'route.ts'],
    ['app', 'api', 'cron', 'outlook-watch', 'route.ts'],
    ['app', 'api', 'cron', 'meta-contact-names', 'route.ts'],
    ['app', 'api', 'cron', 'meta-token-refresh', 'route.ts'],
    ['app', 'api', 'cron', 'meta-webhook-subscriptions', 'route.ts'],
  ];

  it.each(pollers)(
    '%s recorre todas las conexiones con concurrencia acotada',
    (...parts) => {
      const src = source(...parts);
      expect(src).toContain('listConnections');
      expect(src).toMatch(/(?:map|forEach)WithConcurrency/);
    }
  );

  it('la identidad de conexión incluye la cuenta externa, no solo el canal', () => {
    const src = source('lib', 'channels', 'upsert-connection.ts');
    expect(src).toContain('.eq("workspace_id", row.workspace_id)');
    expect(src).toContain('.eq("channel", row.channel)');
    expect(src).toContain(
      '.eq("external_account_id", row.external_account_id)'
    );
  });

  it('Meta enriquece nombres solo con el token de la conexión dueña', () => {
    const src = source('app', 'api', 'cron', 'meta-contact-names', 'route.ts');
    expect(src).toContain('conversations!inner(connection_id)');
    expect(src).toMatch(/\.eq\(['"]conversations\.connection_id['"], c\.id\)/);
  });

  it('cada cuenta de Mercado Libre reconcilia solo sus propios reclamos', () => {
    const src = source('lib', 'channels', 'mercadolibre', 'claims-poll.ts');
    expect(src.match(/\.eq\(['"]connection_id['"], conn\.id\)/g)).toHaveLength(
        3
    );
  });

  it('los backfills manuales también procesan varias cuentas sin bloquearse', () => {
    const meta = source('lib', 'channels', 'comment-pull.ts');
    const tiktok = source('lib', 'channels', 'tiktok_comment', 'poll.ts');
    expect(meta.match(/mapWithConcurrency\(/g)).toHaveLength(2);
    expect(tiktok).toContain('mapWithConcurrency(');
  });
});
