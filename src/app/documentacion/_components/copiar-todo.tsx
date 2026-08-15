'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * "Copiar todo": la documentación entera en un bloque, para pegarla en un agente.
 *
 * Quien conecta Riverz de forma agéntica no lee esta página: se la pasa a un
 * asistente y le pide que se conecte. Ese asistente necesita, en un solo texto,
 * la dirección, cómo autenticarse, qué herramientas existen y las reglas que no
 * puede adivinar. Mandarlo a leer cinco pantallas es pedirle que reconstruya a
 * mano lo que ya sabemos escribir de una vez.
 *
 * El texto se arma en el servidor desde el registro de herramientas, así que no
 * puede quedar viejo.
 */
export function CopiarTodo({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/40"
    >
      {copiado ? (
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="size-3.5 text-muted-foreground" />
      )}
      {copiado ? 'Copiado' : 'Copiar todo'}
    </button>
  );
}
