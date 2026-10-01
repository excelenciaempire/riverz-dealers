import { describe, expect, it, vi } from 'vitest';
import { createInstallationController, type InstallPromptEvent } from './installation';

function setup(nav = { userAgent: 'Chrome', platform: 'Linux', maxTouchPoints: 0, standalone: false }) {
  const host = Object.assign(new EventTarget(), { navigator: nav, matchMedia: vi.fn() });
  const media = Object.assign(new EventTarget(), { matches: false });
  host.matchMedia.mockReturnValue(media);
  const controller = createInstallationController();
  const release = controller.attach(host as unknown as Window);
  return { host, media, controller, release };
}
function offer(host: EventTarget, outcome: 'accepted' | 'dismissed' = 'accepted', prompt = vi.fn().mockResolvedValue(undefined)) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome }) }) as InstallPromptEvent;
  host.dispatchEvent(event);
  return { event, prompt };
}

describe('installation controlled by browser evidence and an explicit click', () => {
  it('retains a browser offer across settings navigation without opening it automatically', async () => {
    const { host, controller, release } = setup();
    const { event, prompt } = offer(host);
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    const unsubscribe = controller.subscribe(vi.fn()); unsubscribe();
    expect(controller.getSnapshot().status).toBe('available');
    await controller.prompt();
    expect(prompt).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('accepted');
    host.dispatchEvent(new Event('appinstalled'));
    expect(controller.getSnapshot().status).toBe('installed'); release();
  });
  it('calls prompt in the click stack, consumes the event once and handles dismissal', async () => {
    const { host, controller, release } = setup();
    let finish!: () => void;
    const prompt = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    offer(host, 'dismissed', prompt);
    const first = controller.prompt();
    expect(prompt).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('prompting');
    const duplicate = offer(host);
    expect(duplicate.event.defaultPrevented).toBe(true);
    expect(duplicate.prompt).not.toHaveBeenCalled();
    await controller.prompt(); finish(); await first; await controller.prompt();
    expect(prompt).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('dismissed'); release();
  });
  it('does not overwrite confirmed installation with a late prompt result', async () => {
    const { host, controller, release } = setup();
    let finish!: () => void;
    offer(host, 'dismissed', vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
    const attempt = controller.prompt(); host.dispatchEvent(new Event('appinstalled'));
    finish(); await attempt;
    expect(controller.getSnapshot().status).toBe('installed'); release();
  });
  it('cleans up all listeners and rejects stale completion after the dashboard unmounts', async () => {
    const { host, media, controller, release } = setup();
    let finish!: () => void;
    offer(host, 'accepted', vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
    const attempt = controller.prompt(); release(); release(); finish(); await attempt;
    host.dispatchEvent(new Event('appinstalled')); offer(host);
    media.matches = true; media.dispatchEvent(new Event('change'));
    expect(controller.getSnapshot()).toEqual({ status: 'manual', ios: false });
  });
  it('keeps capture mounted until all dashboard owners release it', async () => {
    const { host, controller, release } = setup();
    const second = controller.attach(host as unknown as Window);
    release(); const { prompt } = offer(host); await controller.prompt();
    expect(prompt).toHaveBeenCalledOnce(); second();
    const stale = offer(host); expect(stale.event.defaultPrevented).toBe(false);
    expect(controller.getSnapshot().status).toBe('manual');
  });
  it('reports failure without reusing the consumed event and accepts a fresh browser offer', async () => {
    const { host, controller, release } = setup();
    const prompt = vi.fn().mockRejectedValue(new Error('unsupported'));
    offer(host, 'accepted', prompt); await controller.prompt(); await controller.prompt();
    expect(prompt).toHaveBeenCalledOnce(); expect(controller.getSnapshot().status).toBe('failed');
    const fresh = offer(host); await controller.prompt();
    expect(fresh.prompt).toHaveBeenCalledOnce(); expect(controller.getSnapshot().status).toBe('accepted'); release();
  });
  it('recognizes standalone display without requesting any permission', () => {
    const { media, controller, release } = setup();
    media.matches = true; media.dispatchEvent(new Event('change'));
    expect(controller.getSnapshot().status).toBe('installed'); release();
  });
  it.each([
    { userAgent: 'iPhone Safari', platform: 'iPhone', maxTouchPoints: 5, standalone: false },
    { userAgent: 'Safari Macintosh', platform: 'MacIntel', maxTouchPoints: 5, standalone: true },
  ])('uses iOS instructions including iPad desktop user agents', nav => {
    const { controller, release } = setup(nav);
    expect(controller.getSnapshot()).toEqual({ ios: true, status: nav.standalone ? 'installed' : 'manual' }); release();
  });
  it('ignores malformed offers and keeps a stable server snapshot', () => {
    const { host, controller, release } = setup();
    const event = new Event('beforeinstallprompt', { cancelable: true }); host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false); expect(controller.getSnapshot().status).toBe('manual');
    expect(controller.getServerSnapshot()).toBe(controller.getServerSnapshot()); release();
  });
});
