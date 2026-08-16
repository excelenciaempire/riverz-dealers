import { ALL_TOOLS } from '@/lib/mcp/registry';

/**
 * Todo lo que un agente necesita para conectarse, en un solo texto.
 *
 * Se arma desde el registro de herramientas y no a mano. Una lista escrita
 * aparte se desincroniza, y acá el costo de eso es peor que en una página web:
 * el agente le va a creer, va a llamar algo que no existe y va a informar un
 * error que no es suyo.
 *
 * Está escrito para que lo lea un modelo: primero lo que no se puede adivinar
 * (la dirección, la autenticación, las reglas), después el inventario.
 */
export function instruccionesParaAgente(): string {
  const publicas = ALL_TOOLS.filter((t) => !t.platformOnly);

  const linea = (nombre: string, riesgo: string, descripcion: string, params: string[]) => {
    const args = params.length > 0 ? ` Parámetros: ${params.join(', ')}.` : '';
    return `- ${nombre} [${riesgo}]: ${descripcion}${args}`;
  };

  const herramientas = publicas
    .map((t) =>
      linea(
        t.name,
        t.risk,
        t.description,
        Object.keys(t.schema.properties ?? {}).filter((k) => k !== 'workspace_id'),
      ),
    )
    .join('\n');

  return `RIVERZ: SERVIDOR MCP

Riverz es un CRM de atención y ventas por WhatsApp, Instagram, Messenger, correo
y Mercado Libre. Expone su operación como herramientas MCP.

CÓMO CONECTARSE
Servidor: https://riverz.co/api/mcp
Protocolo: JSON-RPC 2.0 sobre HTTP POST (transporte Streamable HTTP).
Métodos: initialize, tools/list, tools/call, ping.

Hay dos formas de autenticarse. Ambas usan la misma cabecera.

1) Con una llave. El comercio la crea en Ajustes, Agentes (MCP), y la pega en la
   configuración del cliente:
   Authorization: Bearer rvz_LA_LLAVE

   Configuración típica de un cliente MCP:
   {
     "mcpServers": {
       "riverz": {
         "type": "http",
         "url": "https://riverz.co/api/mcp",
         "headers": { "Authorization": "Bearer rvz_LA_LLAVE" }
       }
     }
   }

2) Con OAuth 2.1, para clientes que descubren el servidor solos.
   Descubrimiento: https://riverz.co/.well-known/oauth-protected-resource
   Servidor de autorización: https://riverz.co/.well-known/oauth-authorization-server
   Registro dinámico de clientes disponible. PKCE S256 obligatorio. Sin secreto
   de cliente. Alcances: mcp:read y mcp:write.

REGLAS QUE NO SE PUEDEN ADIVINAR
- La cuenta sale de la credencial. No hay que enviar workspace_id: si se envía
  uno distinto al de la llave, la llamada se rechaza con el código -32003.
- Las llaves pueden ser de sólo lectura. Con una de ésas, cualquier herramienta
  que cambie algo se rechaza, también con -32003.
- Las herramientas marcadas como irreversibles no se ejecutan en la primera
  llamada. Devuelven qué harían y un confirm_token que dura cinco minutos. Para
  ejecutar hay que repetir la llamada con ese token entre los argumentos. El
  token se firma junto con los argumentos: si cambia el texto del mensaje, deja
  de servir.
- Límite: 60 llamadas por minuto y por llave. Al excederlo se responde -32005.
- Toda llamada queda registrada, incluidas las lecturas.

HERRAMIENTAS
${herramientas}

EJEMPLO
curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer rvz_LA_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"conversaciones_pendientes","arguments":{}}}'

Documentación completa: https://docs.riverz.co
`;
}
