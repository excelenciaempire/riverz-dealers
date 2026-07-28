import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'zlib'
import { createZip } from './zip'

/**
 * El empaquetador está escrito a mano sobre el formato binario, así que
 * un error de un byte produce un archivo que WordPress rechaza sin
 * explicar por qué. Estas pruebas leen el ZIP resultante como lo haría un
 * descompresor: firmas, directorio central y contenido recuperable.
 */

/** Localiza el registro de fin y devuelve lo que declara. */
function readEnd(zip: Buffer) {
  const sig = zip.readUInt32LE(zip.length - 22)
  return {
    signature: sig,
    entries: zip.readUInt16LE(zip.length - 22 + 10),
    centralSize: zip.readUInt32LE(zip.length - 22 + 12),
    centralOffset: zip.readUInt32LE(zip.length - 22 + 16),
  }
}

/** Extrae una entrada leyendo su cabecera local, como cualquier lector. */
function readFirstEntry(zip: Buffer) {
  expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  const method = zip.readUInt16LE(8)
  const compressedSize = zip.readUInt32LE(18)
  const uncompressedSize = zip.readUInt32LE(22)
  const nameLen = zip.readUInt16LE(26)
  const extraLen = zip.readUInt16LE(28)
  const name = zip.subarray(30, 30 + nameLen).toString('utf8')
  const start = 30 + nameLen + extraLen
  const body = zip.subarray(start, start + compressedSize)
  const content = method === 8 ? inflateRawSync(body) : body
  return { name, method, uncompressedSize, content }
}

describe('createZip', () => {
  it('produce un archivo con la estructura que espera un descompresor', () => {
    const zip = createZip([
      { path: 'plugin/main.php', content: '<?php echo "hola"; ?>' },
      { path: 'plugin/assets/app.js', content: 'console.log(1)' },
    ])

    const end = readEnd(zip)
    expect(end.signature).toBe(0x06054b50)
    expect(end.entries).toBe(2)
    // El directorio central tiene que caer exactamente donde dice el
    // registro de fin; si no, el lector busca entradas en el lugar
    // equivocado y da "archivo corrupto".
    expect(zip.readUInt32LE(end.centralOffset)).toBe(0x02014b50)
    expect(end.centralOffset + end.centralSize + 22).toBe(zip.length)
  })

  it('recupera el contenido y la ruta intactos', () => {
    const source = '<?php\n// acentos: ñ á é í ó ú ¿? ¡!\n'
    const zip = createZip([{ path: 'plugin/main.php', content: source }])
    const entry = readFirstEntry(zip)

    expect(entry.name).toBe('plugin/main.php')
    expect(entry.content.toString('utf8')).toBe(source)
    expect(entry.uncompressedSize).toBe(Buffer.byteLength(source, 'utf8'))
  })

  it('guarda sin comprimir cuando comprimir no achica', () => {
    // Un contenido diminuto e incompresible: la cabecera DEFLATE pesaría
    // más que el ahorro, así que debe quedar almacenado tal cual.
    const zip = createZip([{ path: 'a.txt', content: 'x' }])
    expect(readFirstEntry(zip).method).toBe(0)
  })

  it('comprime cuando hay algo que ganar', () => {
    const zip = createZip([{ path: 'a.txt', content: 'a'.repeat(5000) }])
    const entry = readFirstEntry(zip)
    expect(entry.method).toBe(8)
    expect(entry.content.toString('utf8')).toBe('a'.repeat(5000))
  })

  it('es determinista: el mismo contenido da el mismo archivo', () => {
    const build = () => createZip([{ path: 'a.txt', content: 'contenido' }])
    expect(build().equals(build())).toBe(true)
  })
})
