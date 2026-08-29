"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { Vistazo } from "@/lib/wallet/puerta";

/**
 * El saldo, disponible en cualquier pantalla.
 *
 * Arranca con el valor que ya leyó el layout del servidor —esa consulta se
 * hacía igual para decidir si mostrar el cartel de cobro— así que el número
 * aparece pintado en el primer render, sin parpadeo ni cascada de fetch.
 *
 * Después se refresca solo en los tres momentos en que puede haber cambiado
 * sin que el usuario lo pida:
 *
 * 1. **Al navegar.** Es el pulso natural de la app y no cuesta nada: quien
 *    está trabajando cambia de pantalla todo el tiempo.
 * 2. **Al volver a la pestaña.** El caso de la recarga: se paga en Stripe, se
 *    vuelve, y el número tiene que estar al día antes de que lo busquen.
 * 3. **Cuando algo lo mueve.** El evento `riverz:saldo` lo dispara quien
 *    acaba de gastar o cargar sin recargar la página.
 *
 * Con un piso de {@link MINIMO_ENTRE_MS} entre lecturas, para que ir y volver
 * cinco veces entre dos pantallas no sean cinco consultas.
 */

/** Nadie vuelve a preguntar el saldo antes de esto. */
const MINIMO_ENTRE_MS = 20_000;

/** Cualquier parte de la app puede pedir que el saldo se relea. */
export const EVENTO_SALDO = "riverz:saldo";

interface Contexto {
  saldo: Vistazo | null;
  refrescar: () => void;
}

const SaldoContext = createContext<Contexto>({ saldo: null, refrescar: () => {} });

export function SaldoProvider({
  inicial,
  children,
}: {
  inicial: Vistazo | null;
  children: React.ReactNode;
}) {
  const [saldo, setSaldo] = useState<Vistazo | null>(inicial);
  const pathname = usePathname();
  // El valor del servidor ya cuenta como una lectura: sin esto, la primera
  // navegación —que suele ocurrir a los pocos segundos— pediría de nuevo algo
  // que se acaba de leer.
  const ultima = useRef<number>(Date.now());
  const enVuelo = useRef(false);

  const leer = useCallback(async (forzar: boolean) => {
    if (enVuelo.current) return;
    if (!forzar && Date.now() - ultima.current < MINIMO_ENTRE_MS) return;
    enVuelo.current = true;
    try {
      const r = await fetch("/api/wallet/vistazo", { cache: "no-store" });
      if (r.ok) {
        setSaldo((await r.json()) as Vistazo);
        ultima.current = Date.now();
      }
    } catch {
      // Sin red se deja el último número conocido. Borrarlo sería cambiar un
      // dato viejo por ninguno, que es peor.
    } finally {
      enVuelo.current = false;
    }
  }, []);

  useEffect(() => {
    void leer(false);
  }, [pathname, leer]);

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") void leer(false);
    };
    const alPedir = () => void leer(true);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener(EVENTO_SALDO, alPedir);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener(EVENTO_SALDO, alPedir);
    };
  }, [leer]);

  const refrescar = useCallback(() => void leer(true), [leer]);

  return (
    <SaldoContext.Provider value={{ saldo, refrescar }}>
      {children}
    </SaldoContext.Provider>
  );
}

export function useSaldo(): Contexto {
  return useContext(SaldoContext);
}

/** Avisa desde cualquier lado que el saldo se movió. */
export function avisarSaldoCambio() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_SALDO));
}
