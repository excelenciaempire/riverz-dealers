import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, findTool } from '@/lib/mcp/registry';
import { ALL_CAPABILITIES, findCapability } from '@/lib/capabilities/registry';
const h = vi.hoisted(() => ({ visible: false }));
vi.mock('@/lib/ui/improvements-preview', () => ({ get SHOW_RIVERZ_IMPROVEMENTS() { return h.visible; } }));
afterEach(() => { h.visible = false; vi.resetModules(); });
describe('HTTP tools reserved for comparison', () => {
  // Collect the normal registry before assertions: cold module acquisition is
  // fixture setup, and a timeout must not race the comparison flag below.
  it('keeps the normal MCP and Operator catalogs unchanged and cannot find hidden HTTP tools', () => {
    expect(ALL_TOOLS).toHaveLength(20);
    expect(ALL_CAPABILITIES.some(cap => cap.key.startsWith('integraciones.http_'))).toBe(false);
    expect(findTool('http_accion_ejecutar')).toBeUndefined(); expect(findCapability('integraciones.http_ejecutar')).toBeUndefined();
  }, 30_000);
  it('adds exactly three tools in comparison with POST irreversible, preview and owned permission mapping', async () => {
    vi.resetModules(); h.visible = true;
    const { ALL_TOOLS } = await import('@/lib/mcp/registry');
    const { ALL_CAPABILITIES } = await import('@/lib/capabilities/registry');
    const { OPERATOR_CAPABILITIES } = await import('@/lib/operator/capabilities');
    const { userCanUseTool } = await import('@/lib/mcp/access');
    const tools = ALL_TOOLS.filter(tool => tool.capabilityKey?.startsWith('integraciones.http_'));
    expect(tools).toHaveLength(3); expect(ALL_TOOLS).toHaveLength(23);
    for (const tool of tools) {
      expect(tool.schema.required).toContain('workspace_id');
      expect(ALL_CAPABILITIES.find(cap => cap.key === tool.capabilityKey)).toBeDefined();
      expect(OPERATOR_CAPABILITIES.find(cap => cap.key === tool.capabilityKey)).toBeDefined();
      expect(userCanUseTool({ admin: true, sections: ['/automatizaciones'] }, tool)).toBe(true);
      expect(userCanUseTool({ admin: true, sections: ['/ajustes'] }, tool)).toBe(false);
    }
    const post = tools.find(tool => tool.name === 'http_accion_ejecutar')!;
    expect(post.risk).toBe('irreversible'); expect(post.preview).toBeTypeOf('function');
    expect(userCanUseTool({ admin: false, sections: null }, post)).toBe(false);
    expect(JSON.stringify(tools.map(tool => tool.schema))).not.toMatch(/invocationKey|confirmed|credential|workspaceId/);
  }, 30_000);
});
