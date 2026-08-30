"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocale, useT } from "@/hooks/use-locale";

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
 * Sobre la lista: NO es un `<select>` nativo. Un select no puede dibujar una
 * imagen en sus opciones, así que las banderas tendrían que ser emoji — y
 * Windows no trae la fuente de banderas, con lo cual el dueño y buena parte de
 * los comercios verían dos letras donde va la bandera. Con un popover propio
 * las banderas son SVG servidos por nosotros y se ven en todos lados. Lo que
 * hay que reponer a mano es lo que el select regalaba: el buscador, las
 * flechas y Enter.
 *
 * De los 245 países que conoce libphonenumber tenemos bandera para los que de
 * verdad entran (LatAm, España, Estados Unidos y un puñado más). El resto sale
 * con su código de dos letras en un recuadro: honesto, legible, y sin cargar
 * medio mega de escudos que nadie va a mirar.
 */

/** Los que más entran, arriba de todo y en este orden. */
const PRIMEROS: CountryCode[] = ["CO", "MX", "AR", "CL", "PE", "EC", "ES", "US"];

/** De estos hay SVG en `public/flags`. */
const CON_BANDERA = new Set([
  "CO", "MX", "AR", "CL", "PE", "EC", "ES", "US", "BR", "UY", "PY", "BO", "VE",
  "CR", "PA", "DO", "GT", "HN", "SV", "NI", "CA", "GB", "PT", "IT", "FR", "DE",
]);

/**
 * El número que llega de afuera, venga con `+` o sin él.
 *
 * El componente emite E.164 con `+`, pero la base guarda SIN: la app normaliza
 * con `normalizeToWhatsApp`, que es el formato que quiere Meta
 * (`5491161047646`). Sin el `+`, libphonenumber no puede deducir el país y
 * devuelve `undefined` — así que el campo se quedaba vacío mostrando el país
 * por defecto, con el número bien guardado. Ese era el "no me deja guardar":
 * se veía vacío, se volvía a teclear lo mismo, y entonces no había nada
 * distinto que guardar (verificado en producción el 2026-08-30).
 *
 * Sólo se antepone el `+` cuando lo que hay son puros dígitos: un texto
 * nacional suelto no se puede interpretar sin país y tiene que seguir dando
 * `undefined`.
 */
function interpretar(value: string) {
  const directo = parsePhoneNumberFromString(value);
  if (directo?.country) return directo;
  const solo = value.trim();
  if (!/^\d{6,15}$/.test(solo)) return undefined;
  return parsePhoneNumberFromString(`+${solo}`);
}

function nombrePais(iso: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

function Bandera({ iso }: { iso: string }) {
  const base = "h-[13px] w-[18px] shrink-0 overflow-hidden rounded-[2px]";
  if (!CON_BANDERA.has(iso)) {
    return (
      <span
        aria-hidden
        className={`${base} flex items-center justify-center bg-muted text-[8px] font-semibold leading-none tracking-tight text-muted-foreground`}
      >
        {iso}
      </span>
    );
  }
  return (
    // `<img>` y no `next/image`: el optimizador devuelve 400 para SVG mientras
    // `dangerouslyAllowSVG` esté apagado, y apagarlo por una bandera no vale.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${iso.toLowerCase()}.svg`}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${base} object-cover`}
    />
  );
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
  const t = useT();
  const { locale } = useLocale();
  const [pais, setPais] = useState<CountryCode>(paisPorDefecto);
  const [local, setLocal] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState("");
  const buscador = useRef<HTMLInputElement>(null);
  /** Lo último que pasó por acá. Distingue "lo tecleó la persona" de "llegó de afuera". */
  const [visto, setVisto] = useState<string>(value);

  // El valor puede llegar ya cargado (perfil, invitación): se abre el país que
  // le corresponde y se muestra el número.
  //
  // Hay que reaccionar al CAMBIO de `value`, no sólo al montaje. El perfil se
  // carga después de pintar: antes esto era un efecto con `[]`, al montar
  // `value` estaba vacío, salía por el `if (!value) return` y no volvía a
  // correr nunca — así que el campo se veía VACÍO con un número guardado. Quien
  // entraba a /perfil lo volvía a teclear igual, y entonces no había nada que
  // guardar —era el mismo número— y el botón quedaba gris: se leía como "no me
  // deja guardar" (reportado 2026-08-29).
  //
  // Se ajusta DURANTE el render y no en un efecto: es el patrón de React para
  // derivar de una prop que cambia, sin el render de más ni la pintura
  // intermedia con el valor viejo.
  if (value !== visto) {
    setVisto(value);
    if (!value) {
      setLocal("");
    } else {
      const p = interpretar(value);
      if (p?.country) {
        setPais(p.country);
        setLocal(p.formatNational());
      }
    }
  }

  useEffect(() => {
    if (abierto) requestAnimationFrame(() => buscador.current?.focus());
    else setBusca("");
  }, [abierto]);

  const paises = useMemo(() => {
    const todos = getCountries();
    const conNombre = (c: CountryCode) => ({
      iso: c,
      nombre: nombrePais(c, locale),
      cod: getCountryCallingCode(c),
    });
    const resto = todos
      .filter((c) => !PRIMEROS.includes(c))
      .map(conNombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, locale));
    return [...PRIMEROS.filter((c) => todos.includes(c)).map(conNombre), ...resto];
  }, [locale]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return paises;
    return paises.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        p.iso.toLowerCase().includes(q) ||
        p.cod.startsWith(q),
    );
  }, [busca, paises]);

  /**
   * El texto local del país elegido, a E.164.
   *
   * Se le pide a la librería que lo INTERPRETE como número nacional en vez de
   * pegar los dígitos detrás del prefijo. La diferencia es Argentina: el
   * formato nacional trae el `0` de tronco y el `15` del móvil
   * (`011 15-6104-7646`), y pegar eso detrás del `+54` daba
   * `+540111561047646` — un número de quince dígitos que no existe y al que
   * `isValid()` decía que sí, así que ninguna validación lo frenaba. Bastaba
   * abrir /perfil y guardar sin tocar nada para romper el teléfono al que van
   * los avisos (visto el 2026-08-29).
   *
   * Si la librería no entiende lo que se está tecleando —a mitad de camino
   * siempre pasa— se cae al pegado simple, que es lo que había.
   */
  const emitir = (iso: CountryCode, texto: string) => {
    const digitos = texto.replace(/\D/g, "");
    if (!digitos) {
      setVisto("");
      onChange("");
      return;
    }
    const p = parsePhoneNumberFromString(texto, iso);
    const e164 =
      p && p.isValid() ? p.number : `+${getCountryCallingCode(iso)}${digitos}`;
    // Anotado como visto: lo que vuelve por `value` es el eco de esto, y no
    // tiene que re-formatear el campo mientras se está tecleando.
    setVisto(e164);
    onChange(e164);
  };

  const alEscribir = (texto: string) => {
    // `AsYouType` deja de agrupar si el texto trae basura, así que entra solo
    // lo que es dígito y él decide dónde van los espacios.
    const formateado = new AsYouType(pais).input(texto.replace(/[^\d\s()-]/g, ""));
    setLocal(formateado);
    emitir(pais, formateado);
  };

  const elegir = (iso: CountryCode) => {
    setPais(iso);
    setAbierto(false);
    // El número local no se toca: quien se equivocó de país corrige el país,
    // no vuelve a teclear los diez dígitos.
    emitir(iso, local);
  };

  return (
    <div
      className={`flex items-stretch rounded-md border border-border bg-muted focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20 ${className}`}
    >
      <Popover open={abierto} onOpenChange={setAbierto}>
        <PopoverTrigger
          type="button"
          disabled={disabled}
          aria-label={t("common.phoneCountry")}
          className="flex shrink-0 items-center gap-1.5 rounded-l-md pl-3 pr-2 text-sm text-foreground outline-none hover:bg-accent/50 focus-visible:bg-accent/50 disabled:opacity-60"
        >
          <Bandera iso={pais} />
          <span className="tabular-nums">+{getCountryCallingCode(pais)}</span>
          <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[19rem] p-0">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={buscador}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={t("common.phoneSearchCountry")}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <ul className="max-h-[17rem] overflow-y-auto py-1">
            {filtrados.map((p) => (
              <li key={p.iso}>
                <button
                  type="button"
                  onClick={() => elegir(p.iso)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <Bandera iso={p.iso} />
                  <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
                  <span className="tabular-nums text-muted-foreground">+{p.cod}</span>
                  {p.iso === pais && (
                    <Check aria-hidden className="size-3.5 shrink-0 text-accent-ink" />
                  )}
                </button>
              </li>
            ))}
            {filtrados.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("common.phoneNoResults")}
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>

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
