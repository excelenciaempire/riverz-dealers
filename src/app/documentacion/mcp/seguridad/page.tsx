import { H1, H2, Lead, P, UL, LI, Code } from '../../_components/prose';

export default function DocsSeguridad() {
  return (
    <article>
      <H1>Seguridad</H1>
      <Lead>
        Qué protege este servidor y qué no. Una llave de Riverz alcanza datos de clientes reales,
        así que conviene leer también los límites.
      </Lead>

      <H2>La llave lleva la cuenta adentro</H2>
      <P>
        Cada llave está asociada a una única cuenta. Si un agente envía un{' '}
        <Code>workspace_id</Code> distinto, la llamada se <strong>rechaza</strong>. No se ignora en
        silencio, porque un agente que cree estar operando sobre otra cuenta debe enterarse de que
        no es así en lugar de deducirlo por los resultados.
      </P>
      <P>
        La herramienta que lista cuentas devuelve únicamente la propia. Las herramientas que
        describen la plataforma, y no una cuenta, no están disponibles con una llave de comercio:
        se ocultan del inventario y también se rechazan si se las invoca por su nombre.
      </P>

      <H2>Se almacena un hash, no la llave</H2>
      <P>
        El valor se muestra una sola vez, al crearla. Lo que queda guardado es un SHA-256. Si
        alguien obtuviera una copia de la base de datos no obtendría llaves utilizables, y por el
        mismo motivo Riverz tampoco puede volver a mostrarla.
      </P>

      <H2>Sólo lectura de forma predeterminada</H2>
      <P>
        Una llave capaz de escribirle a un cliente y otra que sólo responde consultas no
        representan el mismo riesgo si se filtran. Por eso el valor predeterminado al crearla es
        sólo lectura, y la capacidad de escribir se solicita de manera explícita.
      </P>

      <H2>Las acciones irreversibles piden confirmación</H2>
      <P>
        Enviar un mensaje a una persona no se ejecuta en la primera llamada: el servidor devuelve
        qué haría y espera un token firmado junto con los argumentos. Modificar el texto después de
        que alguien lo aprobó invalida ese token.
      </P>
      <P>
        Conviene entender qué cubre esa protección. La confirmación protege frente a un{' '}
        <strong>error</strong>, no frente a una llave filtrada. Para eso sirven el alcance de sólo
        lectura y la revocación.
      </P>

      <H2>Todo queda registrado</H2>
      <P>
        Cada llamada se anota, <strong>incluidas las lecturas</strong>. Cuando se trata de datos de
        personas, saber quién consultó qué forma parte de la respuesta. El registro se consulta en
        Ajustes, Agentes (MCP).
      </P>
      <P>
        Lo que ese registro no guarda: el teléfono de un contacto o el texto de un mensaje. Se
        anota qué campos se utilizaron, nunca su contenido.
      </P>

      <H2>Límites</H2>
      <UL>
        <LI>60 llamadas por minuto y por llave.</LI>
        <LI>Diez llaves activas por cuenta.</LI>
        <LI>Los tokens de OAuth vencen en una hora y se renuevan con el refresh.</LI>
      </UL>

      <H2>Si una llave se pierde</H2>
      <P>
        Se revoca desde Ajustes, Agentes (MCP), con efecto inmediato. La revocación no borra el
        registro de lo que hizo: una llave que llegó a usarse debe poder seguir explicando lo que
        dejó.
      </P>
    </article>
  );
}
