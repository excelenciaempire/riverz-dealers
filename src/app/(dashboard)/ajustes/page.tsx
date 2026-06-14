'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { User, Palette, Building2, Blocks, ArrowRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ProfileForm } from '@/components/settings/profile-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WorkspacePanel } from '@/components/settings/workspace-panel';

/**
 * Ajustes — sólo cosas que NO son integraciones. Canales y apps externas
 * viven en /integraciones (es su propia página, no un tab acá). Las
 * etiquetas se gestionan donde se usan: en Contactos y en el chat.
 */
const TAB_VALUES = ['profile', 'workspace', 'appearance'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Ajustes</h1>
        <Link
          href="/integraciones"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Blocks className="size-4" />
          Integraciones
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
        <TabsList className="bg-card border border-border">
          <TabsTrigger
            value="profile"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <User className="size-4" />
            Perfil
          </TabsTrigger>
          <TabsTrigger
            value="workspace"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <Building2 className="size-4" />
            Equipo
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <Palette className="size-4" />
            Apariencia
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="workspace">
          <WorkspacePanel />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
