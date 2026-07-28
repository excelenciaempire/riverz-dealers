import { deflateRawSync } from 'zlib'

/**
 * Empaquetador ZIP mínimo (DEFLATE), sin dependencias.
 *
 * Existe por una sola razón: WordPress instala plugins desde un .zip, y
 * el proyecto no tenía librería de compresión. Sumar una dependencia
 * entera para armar un archivo de tres ficheros de texto no se justifica.
 *
 * Implementa lo estrictamente necesario del formato: cabecera local por
 * entrada, directorio central y registro de fin. Sin Zip64, sin cifrado,
 * sin carpetas vacías — nada de eso hace falta para un plugin.
 */

/** CRC-32 (IEEE 802.3), que es la suma que exige el formato ZIP. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** Ruta dentro del archivo, con `/` como separador. */
  path: string
  content: string | Buffer
}

/**
 * Fecha fija (2026-01-01 00:00) en el formato MS-DOS que usa el ZIP.
 *
 * Es deliberada: con una marca de tiempo fija, el mismo contenido produce
 * siempre el mismo archivo byte a byte. Así el navegador puede cachearlo
 * y dos descargas del mismo plugin son comparables.
 */
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const raw =
      typeof entry.content === 'string'
        ? Buffer.from(entry.content, 'utf8')
        : entry.content
    const deflated = deflateRawSync(raw)
    const crc = crc32(raw)

    // Si comprimir no achica, guardamos sin comprimir (método 0). Pasa con
    // ficheros muy chicos, donde la cabecera DEFLATE pesa más que el ahorro.
    const useDeflate = deflated.length < raw.length
    const method = useDeflate ? 8 : 0
    const body = useDeflate ? deflated : raw

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // firma de cabecera local
    local.writeUInt16LE(20, 4) // versión mínima
    local.writeUInt16LE(0x0800, 6) // bit 11: nombres en UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // sin campo extra

    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // firma de directorio central
    central.writeUInt16LE(20, 4) // versión que lo creó
    central.writeUInt16LE(20, 6) // versión mínima
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comentario
    central.writeUInt16LE(0, 34) // disco
    central.writeUInt16LE(0, 36) // atributos internos
    // Atributos externos: 0644 como archivo regular, para que al
    // descomprimir en el servidor del comercio queden permisos sanos.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)

    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // firma de fin de directorio
  end.writeUInt16LE(0, 4) // disco
  end.writeUInt16LE(0, 6) // disco del directorio
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // sin comentario

  return Buffer.concat([...locals, centralBuf, end])
}
