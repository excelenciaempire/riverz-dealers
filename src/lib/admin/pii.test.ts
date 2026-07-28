import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertMetadataOnly, parseSelectColumns, FORBIDDEN_COLUMNS } from './pii';

describe('assertMetadataOnly', () => {
  it('deja pasar columnas de metadatos', () => {
    expect(() =>
      assertMetadataOnly('messages', 'id, status, error_code, created_at'),
    ).not.toThrow();
  });

  it('rechaza el cuerpo de un mensaje', () => {
    expect(() =>
      assertMetadataOnly('messages', 'id, content_text, created_at'),
    ).toThrow(/content_text/);
  });

  it('rechaza PII del cliente final', () => {
    expect(() => assertMetadataOnly('contacts', 'id, name, phone')).toThrow();
    expect(() => assertMetadataOnly('orders', 'id, customer_phone')).toThrow();
    expect(() => assertMetadataOnly('voice_calls', 'id, phone')).toThrow();
    expect(() =>
      assertMetadataOnly('webhook_events_raw', 'id, raw_body'),
    ).toThrow();
  });

  it('rechaza secretos de integración aunque estén cifrados', () => {
    expect(() =>
      assertMetadataOnly('channel_connections', 'id, status, secrets'),
    ).toThrow(/secrets/);
    expect(() => assertMetadataOnly('ai_agents', 'id, api_key_encrypted')).toThrow();
  });

  it('rechaza select(*) sobre una tabla con columnas prohibidas', () => {
    expect(() => assertMetadataOnly('contacts', '*')).toThrow();
  });

  it('permite email/nombre donde son del comercio, no del comprador', () => {
    // profiles y waitlist son gente de Riverz: identificarla es el objetivo.
    expect(() => assertMetadataOnly('profiles', 'user_id, email, full_name')).not.toThrow();
    expect(() => assertMetadataOnly('waitlist', 'id, email, name')).not.toThrow();
  });

  it('ve dentro de los embeds de PostgREST', () => {
    expect(() =>
      assertMetadataOnly('messages', 'id, status, conversations!inner(workspace_id)'),
    ).not.toThrow();
  });

  it('valida cada embed contra SU tabla, no la de afuera', () => {
    // `name` es del comprador aunque se pida desde messages.
    expect(() =>
      assertMetadataOnly('messages', 'id, status, contacts(id, name)'),
    ).toThrow(/contacts/);
    // El mismo nombre de columna es legítimo si viene de profiles.
    expect(() =>
      assertMetadataOnly('workspaces', 'id, name, profiles(email)'),
    ).not.toThrow();
  });
});

describe('parseSelectColumns', () => {
  it('aplana embeds, alias y hints', () => {
    expect(
      parseSelectColumns('id, alias:status, conversations!inner(workspace_id)'),
    ).toEqual(['id', 'status', 'conversations', 'workspace_id']);
  });
});

/**
 * Red de seguridad: el panel es de SOLO LECTURA sobre los datos de los
 * comercios. Si alguien agrega un insert/update/delete/upsert a la capa de
 * consultas, esto lo frena acá y no en producción.
 *
 * Las únicas escrituras permitidas del panel viven fuera de estos módulos:
 * `admin_audit_log`, `feature_flags` y `voice_model_config`.
 */
describe('la capa de lectura no escribe', () => {
  const here = join(process.cwd(), 'src', 'lib', 'admin');
  const readOnlyModules = ['queries.ts', 'logs.ts'];

  for (const file of readOnlyModules) {
    it(`${file} no llama a insert/update/delete/upsert`, () => {
      const src = readFileSync(join(here, file), 'utf8');
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    });
  }
});

describe('catálogo de columnas prohibidas', () => {
  it('cubre las tablas con contenido de conversación', () => {
    for (const table of ['messages', 'conversations', 'contacts', 'orders']) {
      expect(FORBIDDEN_COLUMNS[table]?.length).toBeGreaterThan(0);
    }
  });
});
