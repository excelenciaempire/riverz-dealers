import { describe, expect, it } from 'vitest';
import { vehicleInput, opportunityInput, appointmentInput } from './validation';
import { demoData, mutateDemo } from './demo';
describe('dealer inputs and working demo', () => {
  it('validates real VINs, bounded prices and HTTPS photos', () => {
    const v = demoData().vehicles[0];
    expect(vehicleInput(v).year).toBe(2023);
    for (const change of [
      { price: -1 },
      { price: NaN },
      { vin: 'NOT-A-VIN' },
      { photos: ['javascript:alert(1)'] },
      { photos: ['http://example.com/car.jpg'] },
      { year: 1000 },
      { mileage: 3.5 },
    ])
      expect(() => vehicleInput({ ...v, ...change })).toThrow();
  });
  it('requires timezone offsets and a future bounded appointment', () => {
    const a = demoData().appointments[0];
    expect(appointmentInput(a).status).toBe('confirmed');
    expect(() =>
      appointmentInput({ ...a, starts_at: '2027-05-01T10:00:00' })
    ).toThrow();
    expect(() => appointmentInput({ ...a, ends_at: a.starts_at })).toThrow();
    expect(() =>
      appointmentInput({ ...a, starts_at: '2020-01-01T10:00:00Z' })
    ).toThrow();
  });
  it('records multiple interests and buyer preferences', () => {
    const d = demoData(),
      o = d.opportunities[0];
    const next = mutateDemo(
      d,
      'opportunity',
      {
        ...o,
        vehicle_ids: d.vehicles.slice(0, 2).map((v) => v.id),
        preferences: 'SUV',
        financing: true,
      },
      o.id
    );
    expect(
      next.interests.filter((i) => i.opportunity_id === o.id)
    ).toHaveLength(2);
    expect(d.interests).toHaveLength(2);
  });
  it('rejects foreign contacts and malformed booleans', () => {
    const d = demoData(),
      o = d.opportunities[0];
    expect(() =>
      opportunityInput({ ...o, financing: 'false', vehicle_ids: [] })
    ).toThrow();
    expect(() =>
      mutateDemo(
        d,
        'opportunity',
        {
          ...o,
          contact_id: '90000000-0000-4000-8000-000000000000',
          vehicle_ids: [],
        },
        o.id
      )
    ).toThrow('reference');
  });
  it('selling a vehicle cancels its appointment and pauses follow-up', () => {
    const d = demoData(),
      v = d.vehicles[1];
    const next = mutateDemo(d, 'vehicle', { ...v, status: 'sold' }, v.id);
    expect(next.appointments[0].status).toBe('cancelled');
    expect(next.opportunities[1].follow_up_paused).toBe(true);
    expect(next.opportunities[1].next_follow_up_at).toBeNull();
  });
  it('closed opportunities stop follow-ups and pending appointments', () => {
    const d = demoData(),
      o = d.opportunities[1],
      next = mutateDemo(
        d,
        'opportunity',
        { ...o, stage: 'won', vehicle_ids: [d.vehicles[1].id] },
        o.id
      );
    expect(
      next.opportunities.find((x) => x.id === o.id)?.next_follow_up_at
    ).toBeNull();
    expect(next.appointments[0].status).toBe('cancelled');
  });
  it('blocks overlapping seller appointments even on a different vehicle', () => {
    const d = demoData(),
      a = d.appointments[0];
    expect(() =>
      mutateDemo(d, 'appointment', { ...a, vehicle_id: d.vehicles[0].id })
    ).toThrow('conflict');
  });
  it('will not book reserved vehicles', () => {
    const d = demoData(),
      a = d.appointments[0];
    expect(() =>
      mutateDemo(d, 'appointment', { ...a, vehicle_id: d.vehicles[2].id })
    ).toThrow('unavailable');
  });
});
