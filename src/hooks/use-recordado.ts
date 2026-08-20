'use client'

import { useCallback, useState } from 'react'

/**
 * Lo que una sección ya mostró, para que volver sea instantáneo.
 *
 * La navegación del panel es de cliente —el marco no se recarga— pero cada
 * pantalla pide sus datos al montarse, y al montarse arranca vacía. Ir a
 * Plantillas, mirar una, volver a Campañas y volver a Plantillas son cuatro
 * esperas con el área en blanco por lo mismo que ya se había traído. Eso es lo
 * que se siente como "recargar la página".
 *
 * Acá la sección se acuerda de lo último que mostró: al volver aparece en el
 * acto y la consulta sigue saliendo igual, en silencio, para reemplazarlo. Si
 * algo cambió, se ve un instante después; si no cambió nada —que es lo normal—
 * no se ve nada porque no hay nada que cambiar.
 *
 * Vive en memoria del navegador y no en `sessionStorage` a propósito: al
 * recargar de verdad conviene empezar limpio, y cerrar sesión hace una
 * navegación dura que borra todo esto sin que haya que acordarse de limpiarlo.
 */
const memoria = new Map<string, unknown>()

export function olvidarSecciones() {
  memoria.clear()
}

/**
 * Como `useState`, pero se acuerda entre visitas a la sección.
 *
 * El tercer valor dice si veníamos con algo: sirve para arrancar SIN esqueleto
 * la segunda vez. Se calcula una sola vez, al montar, porque si se recalculara
 * en cada render pasaría a ser `true` apenas llegan los datos nuevos y el
 * esqueleto desaparecería a mitad de la primera carga.
 */
export function useRecordado<T>(clave: string, inicial: T) {
  const [teniamos] = useState(() => memoria.has(clave))
  const [valor, setValorRaw] = useState<T>(() =>
    memoria.has(clave) ? (memoria.get(clave) as T) : inicial,
  )

  const setValor = useCallback(
    (siguiente: T | ((previo: T) => T)) => {
      setValorRaw((previo) => {
        const v =
          typeof siguiente === 'function'
            ? (siguiente as (p: T) => T)(previo)
            : siguiente
        memoria.set(clave, v)
        return v
      })
    },
    [clave],
  )

  return [valor, setValor, teniamos] as const
}
