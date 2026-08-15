import { H1, H2, Lead, P, UL, LI, Code } from '../../_components/prose';

export default function DocsSeguridad() {
  return (
    <article>
      <H1>Seguridad</H1>
      <Lead>
        Qué protege esto y qué no, dicho de frente. Una llave de Riverz toca datos de tus clientes
        reales.
      </Lead>

      <H2>La llave lleva tu cuenta adentro</H2>
      <P>
        Cada llave está atada a una cuenta. Si un agente manda un{' '}
        <Code>workspace_id</Code> distinto, la llamada se <strong>rechaza</strong> — no se ignora
        en silencio, porque un agente que cree estar operando sobre otra cuenta tiene que
        enterarse de que no.
      </P>
      <P>
        La herramienta que lista cuentas devuelve sólo la tuya. Las que hablan de la plataforma y
        no de una cuenta no están disponibles con una llave de comercio, ni escondiéndolas ni
        llamándolas por nombre.
      </P>

      <H2>Guardamos un hash, no tu llave</H2>
      <P>
        El valor se muestra una vez, al crearla. Después vive un SHA-256 en la base. Si alguien se
        llevara una copia de nuestra base, no se llevaría llaves usables — y nosotros tampoco
        podemos volver a mostrártela.
      </P>

      <H2>Solo lectura por defecto</H2>
      <P>
        Una llave que puede escribirle a un cliente y una que sólo contesta preguntas no valen lo
        mismo si se filtran. Por eso al crear una, el valor por defecto es sólo lectura: escribir
        se pide a propósito.
      </P>

      <H2>Lo irreversible pide confirmación</H2>
      <P>
        Mandarle un mensaje a una persona no se ejecuta en la primera llamada: devuelve qué haría
        y espera un token firmado junto con los argumentos. Cambiar el texto después de que
        alguien lo aprobó invalida ese token.
      </P>
      <P>
        Ojo con qué protege: la confirmación protege de un <strong>error</strong>, no de una llave
        filtrada. Contra eso sirve el alcance de sólo lectura y revocar.
      </P>

      <H2>Queda registrado todo</H2>
      <P>
        Cada llamada se anota — <strong>las lecturas también</strong>. Sobre datos de personas,
        saber quién miró qué es parte de la respuesta. Lo ves en Ajustes → Agentes (MCP).
      </P>
      <P>
        Lo que NO se guarda en ese registro: el teléfono de un contacto o el texto de un mensaje.
        Se anota qué campos se usaron, no su contenido.
      </P>

      <H2>Límites</H2>
      <UL>
        <LI>60 llamadas por minuto y por llave.</LI>
        <LI>Diez llaves vivas por cuenta.</LI>
        <LI>Los tokens de OAuth vencen en una hora; se renuevan con el refresh.</LI>
      </UL>

      <H2>Si perdés una llave</H2>
      <P>
        Revocala desde Ajustes → Agentes (MCP). Es inmediato. Revocar no borra el registro de lo
        que hizo: una llave que se usó tiene que seguir explicando lo que dejó.
      </P>
    </article>
  );
}
