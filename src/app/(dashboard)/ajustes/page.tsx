'use client';

import { useSearchParams } from 'next/navigation';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { User, Palette, Building2, GitBranch } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useT } from '@/hooks/use-locale';
import { ProfileForm } from '@/components/settings/profile-form';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WorkspacePanel } from '@/components/settings/workspace-panel';
import { AssignmentRulesPanel } from '@/components/settings/assignment-rules-panel';

/**
 * Ajustes — sólo cosas que NO son integraciones. Canales y apps externas
 * viven en /integraciones (es su propia página, no un tab acá). Las
 * etiquetas se gestionan donde se usan: en Contactos y en el chat.
 */
const TAB_VALUES = ['profile', 'workspace', 'rules', 'appearance'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const router = useLocalizedRouter();
  const searchParams = useSearchParams();
  const t = useT();

  const queryTab = searchParams.get('tab');
  const tab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    // Fix del bug previo: el router.replace apuntaba a `/settings` pero
    // la ruta real es `/ajustes`. Cambiar tabs producía un 404.
    router.replace(`/ajustes?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('settings.title')}</h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
        <TabsList className="bg-card border border-border max-w-full overflow-x-auto">
          <TabsTrigger
            value="profile"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <User className="size-4" />
            {t('settings.tabProfile')}
          </TabsTrigger>
          <TabsTrigger
            value="workspace"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <Building2 className="size-4" />
            {t('settings.tabWorkspace')}
          </TabsTrigger>
          <TabsTrigger
            value="rules"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <GitBranch className="size-4" />
            {t('settings.tabRules')}
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <Palette className="size-4" />
            {t('settings.tabAppearance')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileForm />
        </TabsContent>

        <TabsContent value="workspace">
          <WorkspacePanel />
        </TabsContent>

        <TabsContent value="rules">
          <AssignmentRulesPanel />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
