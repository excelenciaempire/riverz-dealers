import {expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({visible:false}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.visible;}}));
import {GET} from './route';
it('does not serve the new worker outside comparison',()=>{h.visible=false;const response=GET();expect(response.status).toBe(404);expect(response.headers.get('Cache-Control')).toBe('no-store');});
it('serves push-only JavaScript with deliberate root scope and no authenticated-page cache',async()=>{h.visible=true;const response=GET();expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toContain('application/javascript');expect(response.headers.get('Service-Worker-Allowed')).toBe('/');expect(response.headers.get('Cache-Control')).toBe('no-store');expect(await response.text()).not.toMatch(/caches\.|addEventListener\('fetch'/);});
