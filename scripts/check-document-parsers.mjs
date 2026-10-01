// Synthetic local fixtures only: verify the same isolated worker used by imports.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import exceljs from 'exceljs';
const { Workbook } = exceljs;

function parse(format, bytes) {
  return new Promise((accept, reject) => {
    const child = execFile(process.execPath, ['--max-old-space-size=192', resolve('scripts/extract-ai-document.mjs')],
      { timeout: 20_000, maxBuffer: 512_000, windowsHide: true, env: { NODE_ENV: 'production' } },
      (error, stdout) => {
        if (error) { reject(new Error(`Document worker unavailable (${format})`)); return; }
        try { accept(JSON.parse(stdout)); } catch { reject(new Error(`Document worker invalid response (${format})`)); }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ format, data: Buffer.from(bytes).toString('base64') }));
  });
}
function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 30 100 Td (${text}) Tj ET` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = body.length;
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body);
}
const wordText = 'Envío y devolución: revisión humana.';
const word = zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${wordText}</w:t></w:r></w:p></w:body></w:document>`),
});
const workbook = new Workbook();
workbook.addWorksheet('Políticas').addRow(['Café', 'Sellado']);
workbook.addWorksheet('Hidden', { state: 'hidden' }).addRow(['must_not_include']);
const formula = new Workbook();
formula.addWorksheet('Values').getCell('A1').value = { formula: '2+2', result: 4 };
const cases = [
  ['pdf', pdf('Reviewed policy'), value => value.ok === true && value.text === 'Reviewed policy'],
  ['docx', word, value => value.ok === true && value.text === wordText],
  ['xlsx', await workbook.xlsx.writeBuffer(), value => value.ok === true && value.text.includes('Café') && value.text.includes('Políticas') && !value.text.includes('must_not_include')],
  ['pdf', pdf(), value => value.ok === false && value.code === 'document_no_text'],
  ['xlsx', await formula.xlsx.writeBuffer(), value => value.ok === false && value.code === 'document_formulas'],
];
for (const [format, bytes, valid] of cases) {
  if (!valid(await parse(format, bytes))) throw new Error(`Document parser acceptance failed (${format})`);
}
console.log(`Document parser acceptance passed: PDF, Word, Excel, UTF-8 and rejection checks (${process.platform}, Node ${process.versions.node}).`);
