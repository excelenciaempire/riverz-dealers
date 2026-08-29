"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

/**
 * Un teléfono, escrito igual por todo el mundo.
 *
 * El campo era un `<input type="tel">` pelado. Cada quien escribía lo suyo
 * —«3001234567», «300 123 4567», «(300) 123-4567», «57 300…»— y recién al
 * enviar se intentaba adivinar el país. Un número sin prefijo no se puede
 * adivinar: «11 5808-2948» es argentino para un argentino y basura para
 * cualquier parser, y el aviso de WhatsApp que dependía de ese número no
 * llegaba nunca.
 *
 * Acá el país se ELIGE, así que no hay nada que adivinar. Lo que sale del
 * componente es siempre E.164 (`+573001234567`): un solo formato para toda la
 * base, que es lo que hace que un número guardado hoy siga marcando dentro de
 * un año y que dos filas del mismo cliente no queden separadas por un espacio.
 *
 * Mientras se escribe, `AsYouType` va agrupando los dígitos como se agrupan en
 * ese país. Es la parte que hace que se sienta un campo de teléfono y no una
 * caja de texto: se ve el error de un dígito de más antes de enviar.
 *
 * Sobre las banderas: son emoji, construidas con los dos indicadores
 * regionales del ISO-2. En teléfonos y en Mac se ven; en Windows el sistema no
 * trae la fuente de banderas y dibuja las dos letras del país, que al lado del
 * prefijo se sigue leyendo perfecto. La alternativa era servir 200 SVG o
 * pedirlos a un CDN ajeno desde la pantalla de registro, y ninguna de las dos
 * vale una bandera.
 */

/** Los que más entran primero; el resto va detrás, alfabético. */
const PRIMEROS: CountryCode[] = ["CO", "MX", "AR", "CL", "PE", "EC", "ES", "US"];

function bandera(iso: string): string {
  // 0x1F1E6 es 'A' en indicadores regionales: A→🇦, B→🇧, y el par forma la bandera.
  return String.fromCodePoint(
    ...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function nombrePais(iso: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

export function CampoTelefono({
  id,
  value,
  onChange,
  paisPorDefecto = "CO",
  required,
  disabled,
  className = "",
}: {
  id?: string;
  /** E.164 (`+573001234567`) o vacío. */
  value: string;
  onChange: (e164: string) => void;
  paisPorDefecto?: CountryCode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [pais, setPais] = useState<CountryCode>(paisPorDefecto);
  const [local, setLocal] = useState("");

  // El valor puede llegar ya cargado (perfil, invitación): se abre el país que
  // le corresponde en vez de dejar el de por defecto contradiciendo al número.
  useEffect(() => {
    if (!value) return;
    const p = parsePhoneNumberFromString(value);
    if (!p?.country) return;
    setPais(p.country);
    setLocal(p.formatNational());
    // Solo al montar: después manda lo que se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paises = useMemo(() => {
    const todos = getCountries();
    const resto = todos
      .filter((c) => !PRIMEROS.includes(c))
      .map((c) => ({ iso: c, nombre: nombrePais(c, "es") }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return [
      ...PRIMEROS.filter((c) => todos.includes(c)).map((c) => ({
        iso: c,
        nombre: nombrePais(c, "es"),
      })),
      ...resto,
    ];
  }, []);

  const emitir = (iso: CountryCode, texto: string) => {
    const digitos = texto.replace(/\D/g, "");
    onChange(digitos ? `+${getCountryCallingCode(iso)}${digitos}` : "");
  };

  const alEscribir = (texto: string) => {
    // `AsYouType` deja de agrupar si el texto trae basura, así que entra solo
    // lo que es dígito y él decide dónde van los espacios.
    const formateado = new AsYouType(pais).input(texto.replace(/[^\d\s()-]/g, ""));
    setLocal(formateado);
    emitir(pais, formateado);
  };

  const alCambiarPais = (iso: CountryCode) => {
    setPais(iso);
    // El número local no se toca: quien se equivocó de país corrige el país,
    // no vuelve a teclear los diez dígitos.
    emitir(iso, local);
  };

  return (
    <div
      className={`flex items-stretch rounded-md border border-border bg-muted focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20 ${className}`}
    >
      <div className="relative flex shrink-0 items-center gap-1.5 pl-3 pr-2 text-sm text-foreground">
        <span aria-hidden className="text-[17px] leading-none">
          {bandera(pais)}
        </span>
        <span className="tabular-nums">+{getCountryCallingCode(pais)}</span>
        {/* El `select` va transparente encima: se queda con el teclado, el
            buscar-escribiendo y la rueda nativa del móvil, y lo que se ve es
            la bandera con el prefijo. */}
        <select
          aria-label="País"
          value={pais}
          disabled={disabled}
          onChange={(e) => alCambiarPais(e.target.value as CountryCode)}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {paises.map((p) => (
            <option key={p.iso} value={p.iso}>
              {bandera(p.iso)} {p.nombre} +{getCountryCallingCode(p.iso)}
            </option>
          ))}
        </select>
      </div>

      <span aria-hidden className="my-2 w-px shrink-0 bg-border" />

      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={local}
        required={required}
        disabled={disabled}
        onChange={(e) => alEscribir(e.target.value)}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
