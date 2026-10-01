'use client';
import { useState } from 'react';
import { useLocale, useT } from '@/hooks/use-locale';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { httpActionStarterDocs, httpActionStarterDraft, httpActionStarters, type HttpActionStarter } from '@/lib/integrations/http-action-starters';
import type { HttpActionDefinition } from '@/lib/integrations/http-action-contract';

export function HttpActionStarterPicker({ apply }: { apply: (draft: HttpActionDefinition) => void }) {
  return SHOW_RIVERZ_IMPROVEMENTS ? <Picker apply={apply} /> : null;
}
function Picker({ apply }: { apply: (draft: HttpActionDefinition) => void }) {
  const t = useT(), { locale } = useLocale();
  const [selected, setSelected] = useState<HttpActionStarter | ''>('');
  const docs = selected ? httpActionStarterDocs(selected) : null;
  return <div className="space-y-2 rounded-lg border border-border p-3">
    <label className="block space-y-1 text-xs"><span>{t('settings.httpStarterTitle')}</span>
      <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={selected}
        onChange={event => setSelected(event.target.value as HttpActionStarter | '')}>
        <option value="">{t('settings.httpStarterManual')}</option>
        {httpActionStarters().map(id => <option key={id} value={id}>{t(`settings.httpStarter_${id}`)}</option>)}
      </select>
    </label>
    {selected && <>
      <p className="text-xs text-muted-foreground">{t(selected === 'make-request' ? 'settings.httpStarterMakeHelp' : 'settings.httpStarterHelp')}</p>
      <p className="text-xs text-muted-foreground">{t('settings.httpStarterReplace')}</p>
      {docs && <a className="block text-xs underline" href={docs} target="_blank" rel="noopener noreferrer">{t('settings.httpStarterDocs')}</a>}
      <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" onClick={() => {
        const draft = httpActionStarterDraft(selected, locale); if (draft) apply(draft);
      }}>{t('settings.httpStarterApply')}</button>
    </>}
  </div>;
}
