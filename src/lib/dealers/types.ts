import type { DealerSettings } from './settings';
export const VEHICLE_STATUSES = ['available', 'reserved', 'sold'] as const;
export const STAGES = [
  'inquiry',
  'qualified',
  'appointment',
  'visit',
  'negotiation',
  'won',
  'lost',
] as const;
export const APPOINTMENT_STATUSES = [
  'requested',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;
export interface Vehicle {
  id: string;
  workspace_id: string;
  stock_number: string;
  vin: string | null;
  make: string;
  model: string;
  year: number;
  mileage: number;
  mileage_unit: 'mi' | 'km';
  price: number | null;
  currency: string;
  status: (typeof VEHICLE_STATUSES)[number];
  photos: string[];
  notes: string;
  source_checked_at?: string | null;
  source_changed_at?: string | null;
  created_at: string;
}
export interface Opportunity {
  id: string;
  workspace_id: string;
  contact_id: string;
  stage: (typeof STAGES)[number];
  budget: number | null;
  currency: string;
  preferences: string;
  buying_timeframe: string;
  financing: boolean;
  trade_in: string;
  buying_reason?: string;
  objection?: string;
  buyer_type?: 'unknown' | 'first_time' | 'replacement' | 'additional';
  lead_source?: string;
  first_contact_at?: string | null;
  first_response_at?: string | null;
  assigned_seller_id?: string | null;
  lost_reason?: string;
  last_contact_at?: string | null;
  next_follow_up_at: string | null;
  follow_up_note: string;
  follow_up_paused: boolean;
  created_at: string;
}
export interface Appointment {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  vehicle_id: string;
  seller_id: string;
  starts_at: string;
  ends_at: string;
  location: string;
  kind: 'visit' | 'test_drive';
  status: (typeof APPOINTMENT_STATUSES)[number];
  customer_confirmed?: boolean;
  vehicle_prepared?: boolean;
  directions_sent?: boolean;
  created_at: string;
}
export interface DealerContact {
  id: string;
  name: string | null;
  phone: string | null;
  opted_out: boolean;
}
export interface DealerData {
  settings?: DealerSettings;
  stage_history?: { opportunity_id: string; to_stage: string; changed_at: string }[];
  activities?: DealerActivity[];
  vehicles: Vehicle[];
  opportunities: Opportunity[];
  appointments: Appointment[];
  interests: { opportunity_id: string; vehicle_id: string }[];
  contacts: DealerContact[];
  timezone: string;
  seller_id: string;
}
export const ACTIVITY_KINDS = [
  'call_connected',
  'call_no_answer',
  'message_sent',
  'video_sent',
  'finance_handoff',
  'visit_recap',
] as const;
export interface DealerActivity {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  actor_id: string;
  kind: (typeof ACTIVITY_KINDS)[number];
  note: string;
  created_at: string;
}
export function vehicleTitle(v: Pick<Vehicle, 'year' | 'make' | 'model'>) {
  return `${v.year} ${v.make} ${v.model}`;
}
