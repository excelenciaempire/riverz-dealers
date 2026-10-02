import type { DealerData } from './types';
import {
  DealerError,
  vehicleInput,
  opportunityInput,
  appointmentInput,
  appointmentUpdate,
  uuid,
} from './validation';
export function demoData(): DealerData {
  const ws = '10000000-0000-4000-8000-000000000001',
    seller = '10000000-0000-4000-8000-000000000002';
  const id = (n: number) =>
    `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const now = new Date().toISOString(),
    future = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
  return {
    timezone: 'America/New_York',
    seller_id: seller,
    vehicles: [
      {
        id: id(1),
        workspace_id: ws,
        stock_number: 'RV-001',
        vin: null,
        make: 'Toyota',
        model: 'Camry SE',
        year: 2023,
        mileage: 28400,
        mileage_unit: 'mi',
        price: 23900,
        currency: 'USD',
        status: 'available',
        photos: [],
        notes: '',
        created_at: now,
      },
      {
        id: id(2),
        workspace_id: ws,
        stock_number: 'RV-002',
        vin: null,
        make: 'Honda',
        model: 'CR-V EX',
        year: 2022,
        mileage: 35700,
        mileage_unit: 'mi',
        price: 26800,
        currency: 'USD',
        status: 'available',
        photos: [],
        notes: '',
        created_at: now,
      },
      {
        id: id(3),
        workspace_id: ws,
        stock_number: 'RV-003',
        vin: null,
        make: 'Ford',
        model: 'F-150 XLT',
        year: 2021,
        mileage: 51200,
        mileage_unit: 'mi',
        price: 31900,
        currency: 'USD',
        status: 'reserved',
        photos: [],
        notes: '',
        created_at: now,
      },
    ],
    contacts: [
      {
        id: id(10),
        name: 'Sofía Martínez',
        phone: '+15550100001',
        opted_out: false,
      },
      {
        id: id(11),
        name: 'Daniel Rivera',
        phone: '+15550100002',
        opted_out: false,
      },
    ],
    opportunities: [
      {
        id: id(20),
        workspace_id: ws,
        contact_id: id(10),
        stage: 'qualified',
        budget: 25000,
        currency: 'USD',
        preferences: 'Sedan',
        buying_timeframe: '',
        financing: true,
        trade_in: '',
        next_follow_up_at: future(-1),
        follow_up_note: '',
        follow_up_paused: false,
        created_at: now,
      },
      {
        id: id(21),
        workspace_id: ws,
        contact_id: id(11),
        stage: 'appointment',
        budget: 28000,
        currency: 'USD',
        preferences: 'SUV',
        buying_timeframe: '',
        financing: false,
        trade_in: 'Honda Civic 2017',
        next_follow_up_at: future(24),
        follow_up_note: '',
        follow_up_paused: false,
        created_at: now,
      },
    ],
    interests: [
      { opportunity_id: id(20), vehicle_id: id(1) },
      { opportunity_id: id(21), vehicle_id: id(2) },
    ],
    appointments: [
      {
        id: id(30),
        workspace_id: ws,
        opportunity_id: id(21),
        vehicle_id: id(2),
        seller_id: seller,
        starts_at: future(2),
        ends_at: future(2.5),
        location: 'Showroom',
        kind: 'test_drive',
        status: 'confirmed',
        created_at: now,
      },
    ],
  };
}
// In-memory demo shares input rules with the API; never calls a live database.
export function mutateDemo(
  current: DealerData,
  entity: string,
  raw: unknown,
  editId?: string
): DealerData {
  const d = structuredClone(current),
    id = editId || crypto.randomUUID(),
    workspace_id =
      d.vehicles[0]?.workspace_id || '10000000-0000-4000-8000-000000000001',
    created_at = new Date().toISOString();
  if (entity === 'vehicle') {
    const input = vehicleInput(raw);
    if (
      d.vehicles.some(
        (v) =>
          v.id !== id &&
          (v.stock_number === input.stock_number ||
            (input.vin && v.vin === input.vin))
      )
    )
      throw new DealerError('duplicate');
    d.vehicles = [
      ...d.vehicles.filter((v) => v.id !== id),
      { ...input, id, workspace_id, created_at },
    ];
    if (input.status !== 'available') {
      d.appointments.forEach((a) => {
        if (
          a.vehicle_id === id &&
          ['requested', 'confirmed'].includes(a.status)
        )
          a.status = 'cancelled';
      });
      d.opportunities.forEach((o) => {
        if (
          d.interests.some(
            (i) => i.opportunity_id === o.id && i.vehicle_id === id
          )
        ) {
          o.follow_up_paused = true;
          o.next_follow_up_at = null;
        }
      });
    }
  } else if (entity === 'opportunity') {
    const input = opportunityInput(raw),
      contact = d.contacts.find((c) => c.id === input.contact_id);
    if (
      !contact ||
      input.vehicle_ids.some((v) => !d.vehicles.some((x) => x.id === v))
    )
      throw new DealerError('reference');
    if (
      !['won', 'lost'].includes(input.stage) &&
      d.opportunities.some(
        (o) =>
          o.id !== id &&
          o.contact_id === input.contact_id &&
          !['won', 'lost'].includes(o.stage)
      )
    )
      throw new DealerError('duplicate');
    if (contact.opted_out || ['won', 'lost'].includes(input.stage)) {
      input.follow_up_paused = true;
      input.next_follow_up_at = null;
    }
    const { vehicle_ids, ...fields } = input;
    d.opportunities = [
      ...d.opportunities.filter((o) => o.id !== id),
      { ...fields, id, workspace_id, created_at },
    ];
    d.interests = [
      ...d.interests.filter((i) => i.opportunity_id !== id),
      ...vehicle_ids.map((vehicle_id) => ({ opportunity_id: id, vehicle_id })),
    ];
    if (['won', 'lost'].includes(input.stage))
      d.appointments.forEach((a) => {
        if (
          a.opportunity_id === id &&
          ['requested', 'confirmed'].includes(a.status)
        )
          a.status = 'cancelled';
      });
  } else if (entity === 'appointment') {
    const old = editId
      ? d.appointments.find((a) => a.id === uuid(editId))
      : undefined;
    if (editId && !old) throw new DealerError('reference');
    const input = old
      ? { ...old, ...appointmentUpdate(raw) }
      : {
          ...appointmentInput(raw),
          id,
          workspace_id,
          created_at,
          seller_id: d.seller_id,
        };
    if (['requested', 'confirmed'].includes(input.status)) {
      if (
        d.vehicles.find((v) => v.id === input.vehicle_id)?.status !==
        'available'
      )
        throw new DealerError('unavailable');
      const opp = d.opportunities.find((o) => o.id === input.opportunity_id);
      if (
        !opp ||
        ['won', 'lost'].includes(opp.stage) ||
        d.contacts.find((c) => c.id === opp.contact_id)?.opted_out
      )
        throw new DealerError('closed');
      if (Date.parse(input.starts_at) <= Date.now())
        throw new DealerError('past');
      if (
        d.appointments.some(
          (a) =>
            a.id !== id &&
            ['requested', 'confirmed'].includes(a.status) &&
            (a.seller_id === input.seller_id ||
              a.vehicle_id === input.vehicle_id) &&
            a.starts_at < input.ends_at &&
            a.ends_at > input.starts_at
        )
      )
        throw new DealerError('conflict');
    }
    d.appointments = [...d.appointments.filter((a) => a.id !== id), input];
  } else throw new DealerError('invalid');
  return d;
}
