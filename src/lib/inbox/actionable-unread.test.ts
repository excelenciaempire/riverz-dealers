import { describe, expect, it } from 'vitest';
import { actionableUnreadCount } from './actionable-unread';

describe('actionableUnreadCount', () => {
  it('oculta el contador cuando el equipo o la IA ya respondieron', () => {
    expect(
      actionableUnreadCount({ unread_count: 7, last_sender_type: 'agent' })
    ).toBe(0);
    expect(
      actionableUnreadCount({ unread_count: 7, last_sender_type: 'bot' })
    ).toBe(0);
  });

  it('conserva pendientes del cliente y datos antiguos sin remitente', () => {
    expect(
      actionableUnreadCount({ unread_count: 7, last_sender_type: 'customer' })
    ).toBe(7);
    expect(
      actionableUnreadCount({ unread_count: 2, last_sender_type: undefined })
    ).toBe(2);
    expect(
      actionableUnreadCount({ unread_count: -1, last_sender_type: 'customer' })
    ).toBe(0);
  });
});
