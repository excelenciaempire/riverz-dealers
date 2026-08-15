import Link from 'next/link';
import { H1, H2, H3, Lead, P, UL, LI, Code, Pre, Nota } from '../_components/prose';
import { CopiarTodo } from '../_components/copiar-todo';
import { instruccionesParaAgente } from '../_components/instrucciones';

export default function DocsMcp() {
  return (
    <article>
      <H1>Conectar un agente con una llave</H1>
      <Lead>
        La vía más corta: se crea una llave, se pega en el cliente y queda operativo. Funciona con
        Claude Desktop, n8n, Cursor y cualquier programa capaz de enviar una cabecera HTTP.
      </Lead>

      <div className="mt-5">
        <CopiarTodo texto={instruccionesParaAgente()} />
        <p className="mt-2 text-xs text-muted-foreground">
          Copia la dirección, la autenticación, las reglas y todas las herramientas en un solo
          bloque, listo para pegar en un asistente.
        </p>
      </div>

      <H2>1. Crear la llave</H2>
      <P>
        Dentro de Riverz, en <strong>Ajustes, Agentes (MCP)</strong>. Conviene ponerle un nombre
        que indique dónde va a estar instalada, por ejemplo &ldquo;laptop de Juan&rdquo; o
        &ldquo;n8n&rdquo;. Ese nombre es lo que permite revocar una llave concreta sin tocar las
        demás.
      </P>
      <P>
        Después se elige el alcance. <strong>Sólo lectura</strong> consulta la operación sin
        modificar nada. <strong>Lectura y escritura</strong> además permite activar
        automatizaciones y enviar mensajes a clientes.
      </P>
      <Nota>
        El valor de la llave se muestra <strong>una sola vez</strong>. No es una limitación de la
        interfaz: en la base de datos se guarda un hash, de modo que Riverz tampoco puede volver a
        mostrarlo. Si se pierde, hay que revocarla y crear otra.
      </Nota>

      <H2>2. Pegarla en el cliente</H2>
      <H3>Claude Desktop, Cursor y compatibles</H3>
      <P>En el archivo de configuración de servidores MCP:</P>
      <Pre>{`{
  "mcpServers": {
    "riverz": {
      "url": "https://riverz.co/api/mcp",
      "headers": { "Authorization": "Bearer rvz_LA_LLAVE" }
    }
  }
}`}</Pre>

      <H3>Cualquier otro cliente</H3>
      <P>
        El servidor habla JSON-RPC 2.0 sobre HTTP POST. Así se listan las herramientas disponibles:
      </P>
      <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer rvz_LA_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</Pre>
      <P>
        Y así se llama una. No hace falta enviar <Code>workspace_id</Code>, porque el servidor lo
        toma de la llave.
      </P>
      <Pre>{`curl -s https://riverz.co/api/mcp \\
  -H "Authorization: Bearer rvz_LA_LLAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": { "name": "conversaciones_pendientes", "arguments": {} }
  }'`}</Pre>

      <H2>Las acciones irreversibles piden confirmación</H2>
      <P>
        Las herramientas cuyo efecto llega a una persona no se ejecutan en la primera llamada. El
        servidor devuelve una descripción de lo que haría junto con un{' '}
        <Code>confirm_token</Code> válido por cinco minutos. Sólo con ese token en una segunda
        llamada la acción se ejecuta.
      </P>
      <P>
        El token se firma junto con los argumentos, así que modificar el texto del mensaje después
        de que alguien lo aprobó lo invalida. La confirmación está garantizada por el protocolo y
        no por el comportamiento del cliente.
      </P>

      <H2>Errores frecuentes</H2>
      <UL>
        <LI>
          <Code>-32001 clave inválida o ausente</Code>. La llave es incorrecta, venció o fue
          revocada.
        </LI>
        <LI>
          <Code>-32003 esta clave sólo opera sobre su propia cuenta</Code>. Se envió un{' '}
          <Code>workspace_id</Code> que no corresponde a la llave. Conviene omitirlo, porque el
          servidor lo completa.
        </LI>
        <LI>
          <Code>-32003 esta clave es de sólo lectura</Code>. La herramienta modifica algo y la
          llave no tiene permiso. Hace falta una llave de lectura y escritura.
        </LI>
        <LI>
          <Code>-32005</Code>. Se superaron las 60 llamadas por minuto con la misma llave.
        </LI>
      </UL>

      <P>
        <Link
          href="/documentacion/mcp/herramientas"
          className="text-primary underline underline-offset-2"
        >
          Ver todas las herramientas
        </Link>
      </P>
    </article>
  );
}
