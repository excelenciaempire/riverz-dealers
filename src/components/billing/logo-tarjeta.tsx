import { CreditCard } from 'lucide-react';

/**
 * El logo de la tarjeta guardada.
 *
 * Dibujado acá y no traído de ningún lado: son cuatro marcas, pesan nada, y una
 * imagen externa en esta pantalla sería una petición más —y un permiso más en
 * la política de contenido— para mostrar veinte píxeles.
 *
 * La que no se reconoce cae al ícono genérico. Es mejor que inventar un logo:
 * quien ve un rectángulo neutro entiende «tarjeta»; quien ve el logo equivocado
 * cree que guardó otra.
 */
export function LogoTarjeta({ marca }: { marca: string | null }) {
  const m = (marca ?? '').toLowerCase();

  if (m === 'visa') {
    return (
      <svg viewBox="0 0 48 32" className="h-5 w-8 shrink-0" aria-label="Visa">
        <rect width="48" height="32" rx="4" fill="#1434CB" />
        <text
          x="24"
          y="21"
          textAnchor="middle"
          fill="#fff"
          fontSize="13"
          fontStyle="italic"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          VISA
        </text>
      </svg>
    );
  }

  if (m === 'mastercard') {
    return (
      <svg viewBox="0 0 48 32" className="h-5 w-8 shrink-0" aria-label="Mastercard">
        <rect width="48" height="32" rx="4" fill="#16161a" />
        <circle cx="20" cy="16" r="8" fill="#EB001B" />
        <circle cx="28" cy="16" r="8" fill="#F79E1B" fillOpacity="0.85" />
      </svg>
    );
  }

  if (m === 'amex' || m === 'american_express') {
    return (
      <svg viewBox="0 0 48 32" className="h-5 w-8 shrink-0" aria-label="American Express">
        <rect width="48" height="32" rx="4" fill="#006FCF" />
        <text
          x="24"
          y="20"
          textAnchor="middle"
          fill="#fff"
          fontSize="9"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          AMEX
        </text>
      </svg>
    );
  }

  return <CreditCard className="size-5 shrink-0 text-muted-foreground" aria-hidden />;
}
