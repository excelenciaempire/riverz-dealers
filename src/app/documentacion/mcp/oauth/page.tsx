import { H1, H2, H3, Lead, P, UL, LI, Code, Pre, Nota } from '../../_components/prose';

export default function DocsOauth() {
  return (
    <article>
      <H1>Conectar con OAuth</H1>
      <Lead>
        Para los clientes que descubren el servidor por su cuenta. No se les pega ninguna llave:
        reciben la dirección y abren una pantalla de Riverz donde la persona autoriza el acceso.
      </Lead>

      <P>
        Si el cliente sabe enviar una cabecera <Code>Authorization</Code>, nada de esto es
        necesario y la vía de la llave es más corta. Este camino existe para conectores que esperan
        encontrar un servidor de autorización del otro lado.
      </P>

      <H2>El recorrido completo</H2>
      <UL>
        <LI>
          El cliente llama a <Code>https://riverz.co/api/mcp</Code> sin credencial y recibe un 401
          con una cabecera <Code>WWW-Authenticate</Code> que apunta al documento de descubrimiento.
        </LI>
        <LI>
          De ese documento obtiene el servidor de autorización y se registra por su cuenta en{' '}
          <Code>/api/oauth/register</Code>. No hace falta que nadie de Riverz cree nada
          manualmente.
        </LI>
        <LI>
          Abre <Code>/oauth/autorizar</Code>. La pantalla muestra qué aplicación pide acceso, sobre
          qué cuenta y qué podrá hacer. Si no hay sesión iniciada, primero se inicia y luego se
          regresa a esa misma pantalla.
        </LI>
        <LI>
          Con la autorización concedida, el cliente recibe un código y lo canjea por un token en{' '}
          <Code>/api/oauth/token</Code>.
        </LI>
      </UL>

      <H2>Documentos de descubrimiento</H2>
      <Pre>{`GET https://riverz.co/.well-known/oauth-protected-resource
GET https://riverz.co/.well-known/oauth-authorization-server`}</Pre>
      <P>Ambos son públicos: describen cómo solicitar permiso, no conceden ninguno.</P>

      <H2>Detalles de implementación</H2>
      <H3>PKCE obligatorio, únicamente S256</H3>
      <P>
        No hay secreto de cliente. Como los clientes se registran por su cuenta, el{' '}
        <Code>client_id</Code> no prueba identidad: lo único que vincula el canje con quien
        solicitó el código es el <Code>code_verifier</Code>. Cualquier{' '}
        <Code>code_challenge_method</Code> distinto de <Code>S256</Code> se rechaza.
      </P>

      <H3>Las redirecciones se comparan de forma exacta</H3>
      <P>
        Deben coincidir carácter por carácter con alguna de las registradas. No se admiten
        prefijos ni comodines, porque aceptar coincidencias parciales es precisamente el mecanismo
        con el que se interceptan códigos de autorización. Se admite <Code>https</Code>, y{' '}
        <Code>http</Code> solamente en localhost, ya que un cliente de escritorio no puede
        disponer de un certificado.
      </P>

      <H3>Alcances</H3>
      <UL>
        <LI>
          <Code>mcp:read</Code>. Consulta la operación sin modificar nada.
        </LI>
        <LI>
          <Code>mcp:write</Code>. Además permite actuar. Las acciones irreversibles siguen pidiendo
          confirmación.
        </LI>
      </UL>
      <P>
        Si no se solicita ningún alcance se concede el más restrictivo. Un cliente que no declaró
        qué necesita, no necesita escribir.
      </P>

      <H3>El token vence en una hora</H3>
      <P>
        Es deliberado: si se filtra, la ventana de exposición es corta. El{' '}
        <Code>refresh_token</Code> permite obtener uno nuevo sin volver a molestar a la persona.
      </P>
      <Pre>{`POST https://riverz.co/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=...&client_id=...`}</Pre>

      <Nota>
        El acceso se revoca desde <strong>Ajustes, Agentes (MCP)</strong>, igual que una llave
        pegada manualmente. Para Riverz las dos vías producen lo mismo: un token asociado a una
        cuenta y a un alcance.
      </Nota>
    </article>
  );
}
