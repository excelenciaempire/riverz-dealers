import { vehicleInput, DealerError, object } from './validation';
import type { DealerSettings } from './settings';

/** RFC 4180 including quoted commas, CRLF and multiline cells. */
export function dealerCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length) throw new DealerError('feed');
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new DealerError('feed');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const header = rows.shift()?.map((v) => v.trim());
  if (
    !header?.length ||
    new Set(header).size !== header.length ||
    header.some(
      (h) => !h || ['__proto__', 'constructor', 'prototype'].includes(h)
    )
  )
    throw new DealerError('feed');
  return rows.map((r) => {
    if (r.length !== header.length) throw new DealerError('feed');
    return Object.fromEntries(header.map((h, i) => [h, r[i]]));
  });
}
export function parseDealerFeed(
  text: string,
  settings: DealerSettings['inventory'],
  format = settings.format
) {
  if (text.length > 8 * 1024 * 1024) throw new DealerError('feed');
  let parsed: unknown;
  try {
    parsed =
      format === 'csv'
        ? dealerCsv(text)
        : JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new DealerError('feed');
  }
  const rows = Array.isArray(parsed) ? parsed : object(parsed).vehicles;
  if (
    !Array.isArray(rows) ||
    rows.length < settings.minimum_units ||
    rows.length > 5000
  )
    throw new DealerError('feed');
  if (!Array.isArray(parsed)) {
    const info = object(parsed);
    if (
      info.has_more === true ||
      info.hasMore === true ||
      info.next_page ||
      info.nextPage ||
      info.next ||
      ['total', 'total_count', 'totalCount'].some(
        (key) =>
          typeof info[key] === 'number' && Number(info[key]) !== rows.length
      )
    )
      throw new DealerError('feed');
  }
  const stock = new Set<string>(),
    vins = new Set<string>();
  const result = rows.map((raw) => {
    const r = object(raw),
      v: Record<string, unknown> = {};
    for (const key of [
      'stock_number',
      'vin',
      'make',
      'model',
      'year',
      'mileage',
      'mileage_unit',
      'price',
      'currency',
      'status',
      'photos',
      'notes',
    ])
      v[key] = r[settings.mapping[key] || key];
    const numeric = (value: unknown, fallback: unknown) =>
      value == null || value === ''
        ? fallback
        : typeof value === 'number'
          ? value
          : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())
            ? Number(value)
            : NaN;
    const photos =
      typeof v.photos === 'string'
        ? v.photos.trim().startsWith('[')
          ? JSON.parse(v.photos)
          : v.photos
              .split('|')
              .map((p) => p.trim())
              .filter(Boolean)
        : (v.photos ?? []);
    const vehicle = vehicleInput({
      ...v,
      year: numeric(v.year, NaN),
      mileage: numeric(v.mileage, 0),
      price: numeric(v.price, null),
      mileage_unit: v.mileage_unit || 'mi',
      currency: v.currency || 'USD',
      status: v.status || 'available',
      photos,
      notes: v.notes ?? '',
    });
    if (
      stock.has(vehicle.stock_number) ||
      (vehicle.vin && vins.has(vehicle.vin))
    )
      throw new DealerError('feed');
    stock.add(vehicle.stock_number);
    if (vehicle.vin) vins.add(vehicle.vin);
    return vehicle;
  });
  return result;
}
