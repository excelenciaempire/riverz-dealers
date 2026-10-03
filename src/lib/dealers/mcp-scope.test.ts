import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it('initializes the production MCP registry after commerce capabilities have been removed',async()=>{
 vi.stubEnv('NEXT_PUBLIC_RIVERZ_VERTICAL','dealers');
 const {ALL_TOOLS,findTool}=await import('@/lib/mcp/registry');
 expect(ALL_TOOLS.length).toBeGreaterThan(0);
 expect(findTool('metricas')).toBeUndefined();
 expect(findTool('pedidos_listar')).toBeUndefined();
 expect(findTool('contactos_listar')?.capabilityKey).toBe('contactos.listar');
 expect(findTool('conversacion_mensajes')?.capabilityKey).toBe('conversaciones.mensajes');
 expect(ALL_TOOLS.some(t=>/^(?:pedidos|productos|flows)\./.test(t.capabilityKey??''))).toBe(false);
},60000);
