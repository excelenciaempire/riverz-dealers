'use client'

import { useState } from 'react'
import { CentroOperacion } from './centro'
import { OperatorChat } from './operator-chat'

/**
 * Las dos mitades del Centro: el estado a la izquierda, el Operator a la
 * derecha. Cuando el Operator ejecuta algo aprobado, el estado se vuelve a
 * cargar — ver el conteo viejo después de prender una automatización hace
 * dudar de si la acción se aplicó.
 */
export function OperacionShell() {
  const [version, setVersion] = useState(0)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <CentroOperacion refreshKey={version} />
      <div className="lg:sticky lg:top-6 lg:self-start">
        <OperatorChat onChanged={() => setVersion((v) => v + 1)} />
      </div>
    </div>
  )
}
