import {describe,expect,it} from 'vitest';
import {userCanUseTool} from './access';
import type {McpTool} from './tool';
const tool=(risk:'lectura'|'irreversible')=>({name:'product-policy',capabilityKey:risk==='lectura'?'productos.politica_devolucion':'productos.definir_politica_devolucion',risk}) as McpTool;
describe('Current product section for MCP return policy tools',()=>{
 it('allows a current product reader without allowing writes by an agent',()=>{
  expect(userCanUseTool({admin:false,sections:['/productos']},tool('lectura'))).toBe(true);expect(userCanUseTool({admin:false,sections:['/productos']},tool('irreversible'))).toBe(false);
 });
 it('requires the product section even for a scoped administrator',()=>{
  expect(userCanUseTool({admin:true,sections:['/productos']},tool('irreversible'))).toBe(true);for(const sections of [[],['/pedidos'],['/bandeja']])expect(userCanUseTool({admin:true,sections},tool('irreversible'))).toBe(false);
 });
});
