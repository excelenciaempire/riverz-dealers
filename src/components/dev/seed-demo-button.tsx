'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Floods the caller's templates / broadcasts / both with realistic
 * test data so the merchant can see the list pages populated without
 * configuring WhatsApp first. Rows are tagged "[Prueba]" so they're
 * easy to wipe later from the normal list UI.
 *
 * Pure UX scaffolding — hits POST /api/dev/seed-demo, no side effects
 * beyond inserting rows under the current user.
 */
export function SeedDemoButton({
  type,
  label,
  onDone,
}: {
  type: 'templates' | 'broadcasts' | 'all';
  label: string;
  onDone?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      const res = await fetch('/api/dev/seed-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo crear');
      const parts: string[] = [];
      if (json.templates) parts.push(`${json.templates} plantillas`);
      if (json.broadcasts) parts.push(`${json.broadcasts} campañas`);
      if (json.recipients) parts.push(`${json.recipients} destinatarios`);
      toast.success(parts.length ? `Insertado: ${parts.join(', ')}` : 'Listo');
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      onClick={run}
      disabled={loading}
      className="border-border text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FlaskConical className="h-4 w-4" />
      )}
      {label}
    </Button>
  );
}
