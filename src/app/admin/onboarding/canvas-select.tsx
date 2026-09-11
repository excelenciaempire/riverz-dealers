'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import css from './automation-canvas.module.css';

export function CanvasSelect({
  value,
  placeholder,
  groups,
  onChange,
  clearable = false,
}: {
  value: string;
  placeholder: string;
  groups: { label?: string; options: { value: string; label: string }[] }[];
  onChange: (value: string) => void;
  clearable?: boolean;
}) {
  const labels = Object.fromEntries(
    groups.flatMap((group) =>
      group.options.map((item) => [item.value, item.label])
    )
  );
  return (
    <Select
      value={value || null}
      onValueChange={(next) => onChange(next ?? '')}
    >
      <SelectTrigger className={css.selectTrigger} aria-label={placeholder}>
        <SelectValue labels={labels} placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={css.selectPopup} align="start">
        {clearable && (
          <SelectItem value="" className={css.selectItem}>
            {placeholder}
          </SelectItem>
        )}
        {groups
          .filter((group) => group.options.length)
          .map((group, index) => (
            <SelectGroup key={group.label ?? index}>
              {group.label && (
                <SelectLabel className={css.selectLabel}>
                  {group.label}
                </SelectLabel>
              )}
              {group.options.map((item) => (
                <SelectItem
                  className={css.selectItem}
                  key={item.value}
                  value={item.value}
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
      </SelectContent>
    </Select>
  );
}
