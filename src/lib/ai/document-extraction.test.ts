import { zipSync, strToU8 } from 'fflate';
import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { extractDocument } from './document-extraction';
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function office(text: string, extras: Record<string, Uint8Array> = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`), ...extras,
  });
}
function file(bytes: Uint8Array | string, name = 'source.docx', type = docxMime) {
  return new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes).buffer], name, { type });
}
function pdf(text?: string) {
  const stream = text ? `BT /F1 12 Tf 30 100 Td (${text}) Tj ET` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n';const offsets = [0];
  objects.forEach((object, index) => { offsets.push(body.length);body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = body.length;body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return body;
}
describe('local document extraction with real parsers', () => {
  it('preserves UTF-8 Word text and original file provenance', async () => {
    const result = await extractDocument(file(office('Envío y devolución: revisión humana.')));
    expect(result).toMatchObject({ format: 'docx', name: 'source.docx', text: 'Envío y devolución: revisión humana.' });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);expect(result.bytes).toBeGreaterThan(0);
  });
  it('extracts PDF text without a network service', async () => {
    expect(await extractDocument(file(pdf('Reviewed business policy'), 'policy.pdf', 'application/pdf'))).toMatchObject({ format: 'pdf', text: 'Reviewed business policy' });
  });
  it('rejects a PDF without readable text instead of reporting training success', async () => {
    await expect(extractDocument(file(pdf(), 'scan.pdf', 'application/pdf'))).rejects.toMatchObject({ code: 'document_no_text' });
  });
  it('extracts visible Excel values and omits hidden sheets', async () => {
    const book = new Workbook(), sheet = book.addWorksheet('Políticas');sheet.addRow(['Producto', 'Condición']);sheet.addRow(['Café', 'Sellado']);
    book.addWorksheet('Private', { state: 'hidden' }).addRow(['Do not include']);
    const result = await extractDocument(file(new Uint8Array(await book.xlsx.writeBuffer()), 'policies.xlsx', xlsxMime));
    expect(result.text).toContain('[Políticas]');expect(result.text).toContain('1: Café | 2: Sellado');expect(result.text).not.toContain('Do not include');
  });
  it('rejects Excel formulas even with a cached result, rather than treating it as a current value', async () => {
    const book = new Workbook();book.addWorksheet('Values').getCell('A1').value = { formula: '2+2', result: 4 };
    await expect(extractDocument(file(new Uint8Array(await book.xlsx.writeBuffer()), 'formula.xlsx', xlsxMime))).rejects.toMatchObject({ code: 'document_formulas' });
  });
  it.each([['fake.docx', docxMime], ['fake.pdf', 'application/pdf'], ['fake.xlsx', xlsxMime]])('rejects misleading extensions for %s', async (name, type) => {
    await expect(extractDocument(file('not a document', name, type))).rejects.toMatchObject({ code: 'document_unreadable' });
  });
  it.each([['legacy.doc', 'application/msword'], ['legacy.xls', 'application/vnd.ms-excel'], ['macro.xlsm', xlsxMime], ['../source.docx', docxMime], ['source.docx', 'text/html']])('rejects unsupported or unsafe metadata %s', async (name, type) => {
    await expect(extractDocument(file('bad', name, type))).rejects.toMatchObject({ code: 'document_invalid' });
  });
  it('rejects oversized and empty inputs before spawning a parser', async () => {
    await expect(extractDocument(file(new Uint8Array(5 * 1024 * 1024 + 1)))).rejects.toMatchObject({ code: 'document_too_large' });
    await expect(extractDocument(file(''))).rejects.toMatchObject({ code: 'document_too_large' });
  });
  it('rejects an expanded ZIP bomb using archive metadata before decompression', async () => {
    await expect(extractDocument(file(office('Safe', { 'huge.txt': new Uint8Array(33 * 1024 * 1024) })))).rejects.toMatchObject({ code: 'document_too_large' });
  });
  it('rejects macros, external workbook links and XML entity declarations', async () => {
    const archives: Array<Record<string, Uint8Array>> = [{ 'word/vbaProject.bin': strToU8('macro') }, { 'xl/externalLinks/externalLink1.xml': strToU8('link') }, { 'word/settings.xml': strToU8('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///private">]>') }];
    for (const extras of archives) {
      await expect(extractDocument(file(office('Safe', extras)))).rejects.toMatchObject({ code: 'document_unreadable' });
    }
  });
  it('rejects text beyond the cap without truncating the source silently', async () => {
    await expect(extractDocument(file(office('a'.repeat(32001))))).rejects.toMatchObject({ code: 'document_text_limit' });
  });
});
