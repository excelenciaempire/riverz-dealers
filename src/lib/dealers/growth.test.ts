import { describe, it, expect } from 'vitest';
import { dealerSettings, assertDealerSlot } from './settings';
import { parseDealerFeed, dealerCsv } from './feed';
import { dealerGrowthMetrics, dealerInventoryMatches } from './growth';
import { demoData } from './demo';
describe('configurable dealer operations', () => {
  it('merges defaults but rejects unknown fields, invalid hours, unsafe URLs and sellers', () => {
    expect(
      dealerSettings({ leads: { response_minutes: 12 } }).leads.response_minutes
    ).toBe(12);
    for (const v of [
      { orders: {} },
      { follow_up: { start_hour: 20, end_hour: 9 } },
      { inventory: { feed_url: 'http://localhost' } },
      { leads: { default_seller_id: 'other' } },
      { appointments: { weekdays: [9] } },
      { coach: { enabled: 'true' } },
      { business: { timezone: 'Bogota' } },
    ])
      expect(() => dealerSettings(v)).toThrow();
  });
  it('enforces duration, notice, weekdays, business hours and explicit timezone', () => {
    const settings = dealerSettings({
        business: { timezone: 'America/New_York' },
        appointments: {
          weekdays: [1],
          notice_hours: 1,
          duration_minutes: 30,
          start_hour: 9,
          end_hour: 17,
        },
      }),
      now = Date.parse('2026-10-04T12:00:00Z');
    expect(() =>
      assertDealerSlot(
        settings,
        '2026-10-05T13:00:00Z',
        '2026-10-05T13:30:00Z',
        now
      )
    ).not.toThrow();
    expect(() =>
      assertDealerSlot(
        settings,
        '2026-10-05T12:00:00Z',
        '2026-10-05T12:30:00Z',
        now
      )
    ).toThrow();
    expect(() =>
      assertDealerSlot(
        settings,
        '2026-10-06T13:00:00Z',
        '2026-10-06T13:30:00Z',
        now
      )
    ).toThrow();
    expect(() =>
      assertDealerSlot(
        settings,
        '2026-10-05T13:00:00Z',
        '2026-10-05T14:00:00Z',
        now
      )
    ).toThrow();
  });
  it('parses quoted CSV, maps supplier columns and preserves missing prices', () => {
    expect(dealerCsv('stock,notes\r\nA,"One, two\nthree"')).toEqual([
      { stock: 'A', notes: 'One, two\nthree' },
    ]);
    const s = dealerSettings({
      inventory: { mapping: { stock_number: 'Stock', model: 'Description' } },
    }).inventory;
    const rows = parseDealerFeed(
      'Stock,make,Description,year,price\nA,Toyota,"Camry, LE",2026,',
      s,
      'csv'
    );
    expect(rows[0]).toMatchObject({
      stock_number: 'A',
      model: 'Camry, LE',
      price: null,
      currency: 'USD',
    });
    expect(() =>
      parseDealerFeed(
        'Stock,make,Description,year,price\nA,Toyota,Camry,2026,$30000',
        s,
        'csv'
      )
    ).toThrow();
  });
  it('rejects incomplete snapshots, duplicates, invalid VINs and prices', () => {
    const s = dealerSettings({}).inventory,
      row = {
        stock_number: 'A',
        make: 'Toyota',
        model: 'Camry',
        year: 2026,
        price: null,
      };
    expect(
      parseDealerFeed(JSON.stringify({ vehicles: [row] }), s)
    ).toHaveLength(1);
    expect(() =>
      parseDealerFeed(
        JSON.stringify({ vehicles: [row], total: 100, has_more: true }),
        s
      )
    ).toThrow();
    for (const rows of [
      [],
      [row, row],
      [{ ...row, vin: 'wrong' }],
      [{ ...row, price: -1 }],
    ])
      expect(() => parseDealerFeed(JSON.stringify(rows), s)).toThrow();
  });
  it('uses one configurable cohort and never counts sent replies as connected customers', () => {
    const d = demoData(),
      now = Date.now();
    d.appointments = [];
    d.opportunities = d.opportunities.slice(0, 2);
    d.opportunities.forEach((o) => {
      o.created_at = new Date(now - 86400000).toISOString();
      o.first_contact_at = null;
      o.first_response_at = null;
    });
    d.opportunities[0].first_response_at = new Date(
      now - 86400000 + 600000
    ).toISOString();
    d.opportunities[1].created_at = new Date(now - 60 * 86400000).toISOString();
    const m = dealerGrowthMetrics(
      d,
      dealerSettings({ metrics: { days: 7 } }),
      now
    );
    expect(m).toMatchObject({
      leads: 1,
      responded: 1,
      connected: 0,
      medianResponseMinutes: 10,
      contactRate: 0,
      showRate: null,
    });
  });
  it('matches only fresh available inventory, explicit preferences, budget and currency', () => {
    const d = demoData(),
      now = Date.now(),
      o = d.opportunities[0],
      v = d.vehicles[0];
    d.opportunities = [o];
    d.vehicles = [v];
    d.interests = [];
    o.preferences = v.make;
    o.budget = 100000;
    o.currency = v.currency;
    o.follow_up_paused = false;
    o.stage = 'inquiry';
    d.contacts.find((c) => c.id === o.contact_id)!.opted_out = false;
    v.status = 'available';
    v.source_checked_at = new Date(now).toISOString();
    v.source_changed_at = v.source_checked_at;
    expect(dealerInventoryMatches(d, dealerSettings({}), now)).toHaveLength(1);
    v.price = null;
    expect(dealerInventoryMatches(d, dealerSettings({}), now)).toHaveLength(0);
    v.price = 20000;
    v.source_checked_at = new Date(now - 48 * 3600000).toISOString();
    expect(dealerInventoryMatches(d, dealerSettings({}), now)).toHaveLength(0);
  });
});
