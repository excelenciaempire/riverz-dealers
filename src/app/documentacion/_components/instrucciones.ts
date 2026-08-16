import { ALL_TOOLS } from '@/lib/mcp/registry';
import type { Locale } from '@/lib/i18n/config';

/**
 * Todo lo que un agente necesita para conectarse, en un solo texto.
 *
 * Se arma desde el registro de herramientas y no a mano. Una lista escrita
 * aparte se desincroniza, y acá el costo de eso es peor que en una página web:
 * el agente le va a creer, va a llamar algo que no existe y va a informar un
 * error que no es suyo.
 *
 * Está escrito para que lo lea un modelo: primero lo que no se puede adivinar
 * (la dirección, la autenticación, las reglas), después el inventario. Sigue el
 * idioma de la página porque quien lo pega también lo lee para revisarlo.
 */
export function instruccionesParaAgente(locale: Locale = 'es'): string {
  const publicas = ALL_TOOLS.filter((t) => !t.platformOnly);
  const en = locale === 'en';

  const herramientas = publicas
    .map((t) => {
      const params = Object.keys(t.schema.properties ?? {}).filter((k) => k !== 'workspace_id');
      const args = params.length
        ? ` ${en ? 'Parameters' : 'Parámetros'}: ${params.join(', ')}.`
        : '';
      const d = en ? (t.descriptionEn ?? t.description) : t.description;
      return `- ${t.name} [${t.risk}]: ${d}${args}`;
    })
    .join('\n');

  const config = `   {
     "mcpServers": {
       "riverz": {
         "type": "http",
         "url": "https://riverz.co/api/mcp",
         "headers": { "Authorization": "Bearer rvz_YOUR_KEY" }
       }
     }
   }`;

  const ejemplo = `curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer rvz_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"conversaciones_pendientes","arguments":{}}}'`;

  if (en) {
    return `RIVERZ: MCP SERVER

Riverz is a CRM for support and sales over WhatsApp, Instagram, Messenger, email
and Mercado Libre. It exposes its operation as MCP tools.

HOW TO CONNECT
Server: https://riverz.co/api/mcp
Protocol: JSON-RPC 2.0 over HTTP POST (Streamable HTTP transport).
Methods: initialize, tools/list, tools/call, ping.

There are two ways to authenticate. Both use the same header.

1) With a key. The merchant creates it under Settings, Agents (MCP), and pastes
   it into the client configuration:
   Authorization: Bearer rvz_YOUR_KEY

   Typical MCP client configuration:
${config}

2) With OAuth 2.1, for clients that discover the server on their own.
   Discovery: https://riverz.co/.well-known/oauth-protected-resource
   Authorization server: https://riverz.co/.well-known/oauth-authorization-server
   Dynamic client registration available. PKCE S256 required. No client secret.
   Scopes: mcp:read and mcp:write.

RULES YOU CANNOT GUESS
- The account comes from the credential. Do not send workspace_id: sending one
  that differs from the key rejects the call with code -32003.
- Keys can be read only. With one of those, any tool that changes something is
  rejected, also with -32003.
- Tools marked irreversible do not run on the first call. They return what they
  would do plus a confirm_token that lasts five minutes. To execute, repeat the
  call with that token among the arguments. The token is signed together with
  the arguments: change the message text and it stops working.
- Limit: 60 calls per minute per key. Exceeding it returns -32005.
- Every call is logged, reads included.

TOOLS
${herramientas}

EXAMPLE
${ejemplo}

Full documentation: https://docs.riverz.co
`;
  }

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
${config.replace('rvz_YOUR_KEY', 'rvz_LA_LLAVE')}

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
${ejemplo.replace(/rvz_YOUR_KEY/g, 'rvz_LA_LLAVE')}

Documentación completa: https://docs.riverz.co
`;
}
