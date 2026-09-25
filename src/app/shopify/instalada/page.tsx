import type { Metadata } from 'next';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('settings.shopifyInstalledTitle'),
    robots: { index: false, follow: false },
  };
}

/**
 * Adonde llega el dueño de la tienda después de instalar la app que Riverz le
 * creó. Casi nunca tiene cuenta en Riverz, así que no puede ser una pantalla
 * del panel: lo mandaría a iniciar sesión sin decirle si funcionó.
 */
export default async function ShopifyInstaladaPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const t = await getT();
  const error = (await searchParams).estado === 'error';
  const Icono = error ? AlertCircle : CheckCircle2;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <Icono
          className={
            error
              ? 'mx-auto size-10 text-amber-600 dark:text-amber-400'
              : 'mx-auto size-10 text-emerald-600 dark:text-emerald-400'
          }
        />
        <h1 className="text-foreground mt-4 text-xl font-semibold">
          {t(
            error
              ? 'settings.shopifyInstallErrorTitle'
              : 'settings.shopifyInstalledTitle'
          )}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {t(
            error
              ? 'settings.shopifyInstallErrorBody'
              : 'settings.shopifyInstalledBody'
          )}
        </p>
      </div>
    </main>
  );
}
