import Link from 'next/link';
import { H1, H2, H3, Lead, P, UL, LI, Code, Pre, Nota } from '../_components/prose';

export default function DocsMcp() {
  return (
    <article>
      <H1>Conectar un agente con una llave</H1>
      <Lead>
        La vía corta: creás una llave, la pegás en tu cliente y listo. Funciona con Claude
        Desktop, n8n, Cursor y cualquier cosa que sepa mandar una cabecera HTTP.
      </Lead>

      <H2>1. Creá la llave</H2>
      <P>
        En Riverz, andá a <strong>Ajustes → Agentes (MCP)</strong>. Ponele un nombre que te diga
        dónde va a estar (&ldquo;mi laptop&rdquo;, &ldquo;n8n&rdquo;) — es lo que vas a mirar el
        día que quieras revocar una y no todas.
      </P>
      <P>
        Elegí el alcance. <strong>Sólo lectura</strong> consulta y no cambia nada;{' '}
        <strong>lectura y escritura</strong> además puede prender automatizaciones y escribirle a
        tus clientes.
      </P>
      <Nota>
        El valor se muestra <strong>una sola vez</strong>. No es una molestia de diseño: en
        nuestra base vive un hash, así que ni nosotros podemos volver a mostrarlo. Si la perdés,
        revocá esa y creá otra.
      </Nota>

      <H2>2. Pegala en tu cliente</H2>
      <H3>Claude Desktop, Cursor y compatibles</H3>
      <P>
        En el archivo de configuración de servidores MCP:
      </P>
      <Pre>{`{
  "mcpServers": {
    "riverz": {
      "url": "https://riverz.co/api/mcp",
      "headers": { "Authorization": "Bearer rvz_TU_LLAVE" }
    }
  }
}`}</Pre>

      <H3>Cualquier otra cosa</H3>
      <P>
        Es JSON-RPC 2.0 sobre HTTP POST. Un <Code>tools/list</Code> a mano:
      </P>
      <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer rvz_TU_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</Pre>
      <P>
        Y una llamada a una herramienta. Fijate que <Code>workspace_id</Code> no hace falta: sale
        de la llave.
      </P>
      <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer rvz_TU_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": { "name": "conversaciones_pendientes", "arguments": {} }
  }'`}</Pre>

      <H2>Lo irreversible pide confirmación</H2>
      <P>
        Las herramientas que le llegan a una persona no se ejecutan en la primera llamada.
        Devuelven qué harían y un <Code>confirm_token</Code> que vive cinco minutos. Recién con
        ese token en la segunda llamada pasa algo.
      </P>
      <P>
        El token se firma junto con los argumentos, así que cambiar el texto del mensaje después
        de que alguien lo aprobó lo invalida. La confirmación vive en el protocolo, no en que el
        cliente se porte bien.
      </P>

      <H2>Si algo no anda</H2>
      <UL>
        <LI>
          <Code>-32001 clave inválida o ausente</Code> — la llave está mal, venció o la
          revocaron.
        </LI>
        <LI>
          <Code>-32003 esta clave sólo opera sobre su propia cuenta</Code> — mandaste un{' '}
          <Code>workspace_id</Code> que no es el tuyo. Sacalo: se completa solo.
        </LI>
        <LI>
          <Code>-32003 esta clave es de sólo lectura</Code> — la herramienta cambia algo y la
          llave no puede. Creá una de lectura y escritura.
        </LI>
        <LI>
          <Code>-32005</Code> — más de 60 llamadas por minuto con la misma llave.
        </LI>
      </UL>

      <P>
        <Link
          href="/documentacion/mcp/herramientas"
          className="text-primary underline underline-offset-2"
        >
          Ver todas las herramientas →
        </Link>
      </P>
    </article>
  );
}
