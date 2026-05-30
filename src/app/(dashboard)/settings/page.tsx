'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { MessageSquare, Tag, User, Palette, Building2, Plug2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { ChannelsPanel } from '@/components/settings/channels-panel';
import { WorkspacePanel } from '@/components/settings/workspace-panel';
import { ShopifyCard } from '@/components/settings/shopify-card';

const TAB_VALUES = [
  'profile',
  'workspace',
  'channels',
  'templates',
  'tags',
  'appearance',
] as const;
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
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Ajustes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Perfil, equipo, canales, plantillas y etiquetas — todo en un mismo sitio.
        </p>
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
            value="channels"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <Plug2 className="size-4" />
            Canales
          </TabsTrigger>
          <TabsTrigger
            value="templates"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <MessageSquare className="size-4" />
            Plantillas
          </TabsTrigger>
          <TabsTrigger
            value="tags"
            className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
          >
            <Tag className="size-4" />
            Etiquetas
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
          <PasswordForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="workspace">
          <WorkspacePanel />
        </TabsContent>

        <TabsContent value="channels" className="space-y-6">
          <ChannelsPanel />
          <ShopifyCard />
        </TabsContent>

        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>

        <TabsContent value="tags">
          <TagManager />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
