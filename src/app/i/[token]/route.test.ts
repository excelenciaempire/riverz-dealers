import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

describe('enlace corto de conversación', () => {
  it('redirige al dominio público aunque el proxy reporte localhost', async () => {
    const response = await GET(
      new NextRequest('https://localhost:10000/i/zJonOHoVTnKOInvRWOFeIQ'),
      { params: Promise.resolve({ token: 'zJonOHoVTnKOInvRWOFeIQ' }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://riverz.co/bandeja?c=cc9a2738-7a15-4e72-8e22-7bd158e15e21'
    );
  });
});
