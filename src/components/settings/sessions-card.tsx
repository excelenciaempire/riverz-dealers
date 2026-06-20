'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useT } from '@/hooks/use-locale';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export function SessionsCard() {
  const supabase = createClient();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onConfirm = async () => {
    setSigningOut(true);
    try {
      // scope: 'global' revokes every refresh token for this user
      // across all devices; the next auth-state change on this tab
      // triggers the usual redirect.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        toast.error(error.message);
        return;
      }
      window.location.href = '/ingresar';
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.genericError');
      toast.error(msg);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <Card className="bg-card/40 border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <LogOut className="size-4 text-accent-ink" />
            {t('settings.activeSessions')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            <LogOut className="size-4" />
            {t('settings.signOutAllDevices')}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.signOutAllConfirm')}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={signingOut}
            >
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={onConfirm} disabled={signingOut}>
              {signingOut ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t('settings.signOut')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
