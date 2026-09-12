import { describe, expect, it, vi } from 'vitest';
import { limitedFormData, PayloadTooLargeError } from './limited-form-data';

async function upload(size: number, declared?: string) {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(size)]), 'photo.png');
  form.set('conversation_id', 'conversation');
  const encoded = new Response(form);
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  let offset = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + 64));
      offset += 64;
    },
    cancel,
  });
  const headers = new Headers(encoded.headers);
  if (declared !== undefined) headers.set('content-length', declared);
  const request = new Request('https://riverz.test/upload', {
    method: 'POST', headers, body, duplex: 'half',
  } as RequestInit);
  return { request, cancel, bytes, read: () => offset };
}

describe('limitedFormData', () => {
  it('accepts multipart fields and binary data at the exact body limit', async () => {
    const fixture = await upload(256);
    const form = await limitedFormData(fixture.request, fixture.bytes.length);
    expect(form.get('conversation_id')).toBe('conversation');
    expect(new Uint8Array(await (form.get('file') as Blob).arrayBuffer())).toEqual(new Uint8Array(256));
  });

  it.each([undefined, '1', 'garbage'])('stops oversized streaming bodies with declared length %s', async (length) => {
    const fixture = await upload(64 * 1024, length);
    await expect(limitedFormData(fixture.request, 1024)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(fixture.cancel).toHaveBeenCalled();
    expect(fixture.read()).toBeLessThan(fixture.bytes.length);
  });

  it('rejects a declared oversized body before consuming it', async () => {
    const fixture = await upload(64 * 1024, '100000');
    await expect(limitedFormData(fixture.request, 1024)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(fixture.cancel).toHaveBeenCalled();
    expect(fixture.read()).toBeLessThan(1024);
  });

  it('rejects malformed multipart and cancels its source', async () => {
    const fixture = await upload(64 * 1024);
    fixture.request.headers.set('content-type', 'text/plain');
    await expect(limitedFormData(fixture.request, 1024)).rejects.toBeInstanceOf(TypeError);
    expect(fixture.cancel).toHaveBeenCalled();
  });

  it('isolates limits across concurrent successful and oversized uploads', async () => {
    const fixtures = await Promise.all(Array.from({ length: 100 }, (_, i) => upload(i % 2 ? 65536 : 256)));
    const results = await Promise.allSettled(fixtures.map(({ request }) => limitedFormData(request, 1024)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(50);
    for (const result of results.filter(result => result.status === 'rejected')) {
      expect(result.reason).toBeInstanceOf(PayloadTooLargeError);
    }
    for (let i = 1; i < fixtures.length; i += 2) expect(fixtures[i].cancel).toHaveBeenCalled();
  });
});
