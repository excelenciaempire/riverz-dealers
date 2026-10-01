export type InstallStatus = 'manual' | 'available' | 'prompting' | 'accepted' | 'dismissed' | 'failed' | 'installed';
export interface InstallSnapshot { status: InstallStatus; ios: boolean }
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
type InstallWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'matchMedia' | 'navigator'>;
const INITIAL: InstallSnapshot = { status: 'manual', ios: false };

/** Browser events survive settings navigation, but never survive a dashboard unmount. */
export function createInstallationController() {
  let snapshot = INITIAL;
  let pending: InstallPromptEvent | null = null;
  let mounts = 0;
  let generation = 0;
  let detach: (() => void) | undefined;
  const subscribers = new Set<() => void>();
  function update(status: InstallStatus, ios = snapshot.ios) {
    if (snapshot.status === status && snapshot.ios === ios) return;
    snapshot = { status, ios };
    for (const notify of subscribers) notify();
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    subscribe(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify); }; },
    attach(host: InstallWindow) {
      mounts++;
      if (mounts === 1) {
        generation++;
        const media = host.matchMedia?.('(display-mode: standalone)');
        const nav = host.navigator as Navigator & { standalone?: boolean };
        const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
        const standalone = () => Boolean(media?.matches || nav.standalone === true);
        update(standalone() ? 'installed' : 'manual', ios);
        const installed = () => { generation++; pending = null; update('installed'); };
        const displayChanged = () => { if (standalone()) installed(); };
        const beforeInstall = (raw: Event) => {
          const event = raw as InstallPromptEvent;
          if (typeof event.prompt !== 'function' || !event.userChoice) return;
          event.preventDefault();
          if (snapshot.status === 'installed' || snapshot.status === 'prompting') return;
          pending = event; update('available');
        };
        host.addEventListener('beforeinstallprompt', beforeInstall);
        host.addEventListener('appinstalled', installed);
        media?.addEventListener?.('change', displayChanged);
        detach = () => {
          host.removeEventListener('beforeinstallprompt', beforeInstall);
          host.removeEventListener('appinstalled', installed);
          media?.removeEventListener?.('change', displayChanged);
        };
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--mounts === 0) { detach?.(); detach = undefined; generation++; pending = null; update('manual', false); }
      };
    },
    async prompt() {
      if (!pending || snapshot.status !== 'available') return;
      const event = pending;
      pending = null; // Each browser event may be consumed only once.
      const attempt = generation;
      update('prompting');
      try {
        // Call before any await: the browser requires the user's click activation.
        await event.prompt();
        const choice = await event.userChoice;
        if (attempt !== generation || !mounts) return;
        // Acceptance is not proof of installation. Only appinstalled/standalone is.
        update(choice.outcome === 'accepted' ? 'accepted' : 'dismissed');
      } catch { if (attempt === generation && mounts) update('failed'); }
    },
  };
}

export const installationController = createInstallationController();
