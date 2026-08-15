import { H1, H2, H3, Lead, P, UL, LI, Code, Pre, Nota } from '../../_components/prose';

export default function DocsOauth() {
  return (
    <article>
      <H1>Conectar con OAuth</H1>
      <Lead>
        Para los clientes que descubren el servidor solos: no les pegás ninguna llave, les das la
        dirección y ellos te mandan a una pantalla de Riverz a decir que sí.
      </Lead>

      <P>
        Si tu cliente sabe mandar una cabecera <Code>Authorization</Code>, no necesitás nada de
        esto — la vía de la llave es más corta. Esto es para conectores que esperan un servidor
        de autorización del otro lado.
      </P>

      <H2>Lo que pasa, en orden</H2>
      <UL>
        <LI>
          Tu cliente llama a <Code>https://riverz.co/api/mcp</Code> sin credencial y recibe un 401
          con un <Code>WWW-Authenticate</Code> que apunta al documento de descubrimiento.
        </LI>
        <LI>
          De ahí saca el servidor de autorización y se registra solo en{' '}
          <Code>/api/oauth/register</Code>. Nadie de Riverz tiene que crear nada a mano.
        </LI>
        <LI>
          Te abre <Code>/oauth/autorizar</Code>. Ahí ves quién pide acceso, a qué cuenta y qué va
          a poder hacer. Si no tenés sesión, primero entrás y volvés a la misma pantalla.
        </LI>
        <LI>
          Le das Autorizar y el cliente recibe un código, que canjea por un token en{' '}
          <Code>/api/oauth/token</Code>.
        </LI>
      </UL>

      <H2>Los documentos de descubrimiento</H2>
      <Pre>{`GET https://riverz.co/.well-known/oauth-protected-resource
GET https://riverz.co/.well-known/oauth-authorization-server`}</Pre>
      <P>Los dos son públicos: describen cómo pedir permiso, no dan ninguno.</P>

      <H2>Detalles que importan si lo implementás a mano</H2>
      <H3>PKCE es obligatorio, y sólo S256</H3>
      <P>
        No hay secreto de cliente. Como los clientes se registran solos, el <Code>client_id</Code>{' '}
        no prueba nada: lo que ata el canje a quien pidió el código es el{' '}
        <Code>code_verifier</Code>. Un <Code>code_challenge_method</Code> que no sea{' '}
        <Code>S256</Code> se rechaza.
      </P>

      <H3>Las redirecciones se comparan exactas</H3>
      <P>
        Tienen que ser una de las que registraste, carácter por carácter. Sin prefijos ni
        comodines — aceptar &ldquo;empieza con&rdquo; es exactamente cómo se roban códigos de
        autorización. Se admite <Code>https</Code>, y <Code>http</Code> sólo en localhost, porque
        un cliente de escritorio no tiene cómo tener un certificado.
      </P>

      <H3>Los alcances</H3>
      <UL>
        <LI>
          <Code>mcp:read</Code> — consulta y no cambia nada.
        </LI>
        <LI>
          <Code>mcp:write</Code> — además puede actuar. Sigue pidiendo confirmación para lo
          irreversible.
        </LI>
      </UL>
      <P>
        Si no pedís ninguno, se concede el más chico. Un cliente que no dijo qué necesita no
        necesita escribir.
      </P>

      <H3>El token vence en una hora</H3>
      <P>
        A propósito: si se filtra, la ventana es corta. Con el <Code>refresh_token</Code> sacás
        otro sin volver a molestar a nadie.
      </P>
      <Pre>{`POST https://riverz.co/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=...&client_id=...`}</Pre>

      <Nota>
        El acceso se corta desde <strong>Ajustes → Agentes (MCP)</strong>, igual que una llave
        pegada a mano. Para Riverz las dos vías son lo mismo: un token con una cuenta y un
        alcance.
      </Nota>
    </article>
  );
}
