'use client';

import type { CustomRange } from '@/components/dashboard/date-range-filter';
import {
  DateRangeChip,
  type DateChipOption,
  type DateChipPreset,
} from '@/components/common/date-range-chip';
import { useT } from '@/hooks/use-locale';

export type DatePreset = DateChipPreset;

const PRESETS: DateChipOption[] = [
  { value: 'all', key: 'contacts.dateAnytime' },
  { value: '7d', key: 'contacts.dateLast7' },
  { value: '30d', key: 'contacts.dateLast30' },
  { value: '90d', key: 'contacts.dateLast90' },
];

/** Filtro por fecha de ALTA del contacto — el chip de fecha compartido, con
 *  las etiquetas de esta lista. */
export function DateAddedFilter({
  preset,
  custom,
  onChange,
}: {
  preset: DatePreset;
  custom: CustomRange | null;
  onChange: (preset: DatePreset, custom: CustomRange | null) => void;
}) {
  const t = useT();
  return (
    <DateRangeChip
      label={t('contacts.dateAddedLabel')}
      options={PRESETS}
      preset={preset}
      custom={custom}
      onChange={onChange}
    />
  );
}
