'use client';
import Link from '@/components/i18n/locale-link';
import { useLocale, useT } from '@/hooks/use-locale';
import {
  CarFront,
  CalendarDays,
  Users,
  Clock3,
  ArrowUpRight,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
export function DealerLanding() {
  const t = useT(),
    { locale, setLocale } = useLocale();
  return (
    <main className="bg-background text-foreground min-h-screen">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-medium tracking-tight"
        >
          <CarFront className="h-5 w-5" />
          {t('dealers.brand')}
        </Link>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
          >
            {locale === 'es' ? 'English' : 'Español'}
          </Button>
          <Link
            href="/ingresar"
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('dealers.start')}
          </Link>
        </div>
      </nav>
      <section className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.3fr_1fr] md:py-28">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
            {t('dealers.brand')}
          </p>
          <h1 className="mt-6 max-w-xl text-5xl leading-[1.05] font-medium tracking-tight md:text-7xl">
            {t('dealers.hero')}
          </h1>
          <p className="text-muted-foreground mt-6 max-w-md text-lg leading-relaxed">
            {t('dealers.heroText')}
          </p>
          <Link
            href="/demo-dealers"
            className={buttonVariants({ size: 'lg', className: 'mt-8' })}
          >
            {t('dealers.demoCta')}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="bg-card self-center rounded-2xl border p-6">
          <p className="mb-6 text-sm font-medium">{t('dealers.title')}</p>
          {[
            { key: 'featureVehicles', icon: CarFront },
            { key: 'featureBuyers', icon: Users },
            { key: 'featureAppointments', icon: CalendarDays },
            { key: 'featureFollowups', icon: Clock3 },
          ].map((f) => (
            <div key={f.key} className="flex items-start gap-4 border-t py-5">
              <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600">
                <f.icon className="h-4 w-4" />
              </div>
              <p className="pt-1 text-sm leading-relaxed">
                {t(`dealers.${f.key}`)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
