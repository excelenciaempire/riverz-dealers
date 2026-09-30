"""Build the three-page Riverz client summary from the preserved Revitaly audit.

Run from the repo: py -X utf8 scripts/build-revitaly-audit-pdf.py
Requires reportlab and PyMuPDF. Source customer records remain in ignored output/.
"""
from pathlib import Path
from collections import Counter
import json
import re
import unicodedata
import pymupdf
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'output/reevitaly-audit'
ASSETS = ROOT / 'docs/documentos-riverz/assets'
OUT = ROOT / 'output/pdf/riverz-revitaly-resumen-y-plan.pdf'
QA = ROOT / 'tmp/pdfs/revitaly-three-pages'
W, H = 595.276, 841.89
BG, INK, MUTED, CARD, LINE, LIME, PALE = map(HexColor, [
    '#F3F0EB', '#12201F', '#53615A', '#FAF7F1', '#E8DECB', '#F7FF9E', '#E8EDDD',
])
for alias, name in [('Sans', 'Sans-full.ttf'), ('Semi', 'Semi-full.ttf'),
                    ('Serif', 'Serif-full.ttf'), ('Logo', 'Logo.ttf')]:
    pdfmetrics.registerFont(TTFont(alias, str(ASSETS / 'fonts' / name)))

def read(name):
    return json.loads((DATA / f'{name}.json').read_text(encoding='utf-8'))

metrics, cases = read('metrics'), read('escalamientos')
assert metrics['all']['total'] == 2098
assert metrics['customer_service']['total'] == 559
assert (metrics['all']['missed_reply'], metrics['all']['premature']) == (53, 10)
assert (metrics['sinceSept26']['total'], metrics['sinceSept26']['ai_only_period'],
        metrics['sinceSept26']['human_required_in_period']) == (204, 135, 43)
assert len(cases) == 135

REASONS = [
    ('Demora o disputa de entrega', 'Entregas demoradas o disputadas', 36,
     'Plazo vencido, entrega negada o seguimiento contradictorio.'),
    ('Cambio de dirección, entrega o datos', 'Cambios de pedido o dirección', 26,
     'Modificar una compra exige comprobar si ya fue despachada.'),
    ('Cancelación o reembolso', 'Cancelaciones y reembolsos', 23,
     'Hay que validar las condiciones y ejecutar la devolución.'),
    ('Producto dañado, distinto o faltante', 'Productos dañados o faltantes', 18,
     'Requiere comprobar lo recibido y resolver una reposición.'),
    ('Acreditación o cobro', 'Pagos y cobros por verificar', 13,
     'El comprobante debe contrastarse con el dinero recibido.'),
    ('Dato o decisión no verificada', 'Información o decisión comercial', 11,
     'Falta confirmar un dato o autorizar una excepción comercial.'),
    ('Reclamo legal', 'Reclamos legales', 6,
     'Una persona responsable debe evaluar y responder el reclamo.'),
    ('Factura', 'Facturas', 2,
     'Se necesita el sistema del comercio para obtener la factura.'),
]
assert Counter(c['category'] for c in cases) == Counter({r[0]: r[2] for r in REASONS})

def clean(value):
    return unicodedata.normalize('NFC', str(value)).replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')

class PDF:
    def __init__(self):
        OUT.parent.mkdir(parents=True, exist_ok=True)
        QA.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
        self.c.setTitle('Revitaly | Resumen de auditoría y plan de trabajo | Riverz')
        self.c.setAuthor('Riverz')
        self.c.setSubject('Escalamientos reales, mejoras publicadas y propuestas en tres páginas')
        self.page = 0

    def text(self, x, y, text, font='Sans', size=13, color=INK, width=511):
        text = clean(text)
        tw = pdfmetrics.stringWidth(text, font, size)
        assert x >= 30 and x + tw <= W - 30 and tw <= width + .1, (self.page, text, tw)
        assert 20 <= y <= 823
        glyphs = pdfmetrics.getFont(font).face.charToGlyph
        assert all(ord(c) in glyphs for c in text), text
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        self.c.drawString(x, H-y, text)

    def wrap(self, x, y, text, width=511, size=13, leading=18, font='Sans', color=INK):
        lines = []
        for paragraph in clean(text).split('\n'):
            line = ''
            for word in paragraph.split():
                trial = f'{line} {word}'.strip()
                if line and pdfmetrics.stringWidth(trial, font, size) > width:
                    lines.append(line)
                    line = word
                else:
                    line = trial
            if line:
                lines.append(line)
        for line in lines:
            self.text(x, y, line, font, size, color, width)
            y += leading
        return y

    def box(self, x, y, w, h, fill=CARD, radius=14):
        self.c.setFillColor(fill)
        self.c.roundRect(x, H-y-h, w, h, radius, fill=1, stroke=0)

    def line(self, y):
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(.7)
        self.c.line(42, H-y, 553, H-y)

    def header(self, label, title, subtitle):
        self.page += 1
        self.c.setFillColor(BG)
        self.c.rect(0, 0, W, H, fill=1, stroke=0)
        self.text(42, 47, 'riverz', 'Logo', 24)
        self.text(356, 44, label.upper(), 'Semi', 10, INK, 197)
        self.line(65)
        end = self.wrap(42, 118, title, size=34, leading=39, font='Serif')
        self.wrap(42, end-8, subtitle, size=13, leading=18)
        key = f'page-{self.page}'
        self.c.bookmarkPage(key)
        self.c.addOutlineEntry(title, key, level=0)

    def end(self):
        self.line(802)
        self.text(42, 820, 'riverz.co  |  Revitaly  |  30 septiembre 2026', size=9, color=MUTED)
        self.text(523, 820, f'{self.page:02}', 'Semi', 9, MUTED)
        self.c.showPage()

    def simple(self, y, title, body, height=65):
        self.box(42, y, 511, height)
        self.text(60, y+23, title, 'Semi', 15)
        end = self.wrap(60, y+47, body, 475)
        assert end-18+4 <= y+height-8, (self.page, title, end, y+height)

    def proposal(self, y, number, title, body, height=140):
        self.box(42, y, 511, height)
        self.box(60, y+12, 27, 27, LIME, 8)
        self.text(69, y+31, str(number), 'Semi', 12.5)
        self.text(99, y+31, title, 'Semi', 15, width=436)
        end = self.wrap(60, y+54, body, 475)
        assert end-18+4 <= y+height-8, (self.page, title, end, y+height)

p = PDF()

# 1. Results and only the three confirmed, published fixes.
p.header('Resultados', 'Revitaly. Resultados y mejoras.', 'Qué encontramos y qué corregimos en la atención con IA.')
for x, rate, label, count in [
    (42, '66,2%', 'Atención solo con IA', '135 de 204 consultas'),
    (304, '21,1%', 'Intervención necesaria', '43 de 204 consultas'),
]:
    p.box(x, 182, 249, 114, PALE if x == 42 else CARD)
    p.text(x+17, 226, rate, 'Serif', 42)
    p.text(x+17, 254, label, 'Semi', 12.5)
    p.text(x+17, 278, count)
end = p.wrap(42, 315, 'Se revisaron 2.098 hilos: 559 de atención al cliente. Los porcentajes usan 204 consultas del 26 al 30 de septiembre, con corte a las 12:04 de Argentina.')
assert end-18+4 < 369
end = p.wrap(42, 379, '«Solo con IA» no prueba resolución: no hubo respuesta humana registrada en el período. Los porcentajes pueden coincidir en un mismo hilo.', size=12.5)
assert end-18+4 < 430
p.simple(430, '53 hilos con respuesta insuficiente',
         'Además, 10 bloqueos evitables. Se corrigieron tres causas.', 67)
p.text(42, 530, 'Tres mejoras ya publicadas', 'Serif', 27)
p.simple(549, 'Transferencias',
         'Envía titular, CVU y alias cuando el cliente los solicita.')
p.simple(623, 'Consultas por correo',
         'Responde a preguntas en el asunto, aunque el cuerpo esté vacío.')
p.simple(697, 'Capturas de pantalla',
         'No confunde botones de una captura con pedidos de reembolso.')
p.text(42, 787, 'Publicado y validado: 76 pruebas y comprobación en producción.', size=12.5)
p.end()

# 2. The complete escalation analysis, grouped instead of listing customers.
p.header('Escalamientos reales', 'Por qué se necesita al equipo.', '135 hilos históricos, agrupados por su motivo principal.')
for i, (category, title, count, why) in enumerate(REASONS):
    y = 182+i*70
    p.box(42, y, 511, 63, CARD, 11)
    p.text(60, y+22, title, 'Semi', 15, width=443)
    p.text(520, y+24, str(count), 'Serif', 25)
    end = p.wrap(60, y+47, why, 475)
    assert end-18+4 <= y+63-8, (title, end, y+63)
p.wrap(42, 764, 'Los 135 hilos no son pendientes actuales: incluyen casos resueltos y reclamos repetidos en distintos canales.', size=12.5)
p.end()

# 3. Four plain-language work packages covering every escalation category.
p.header('Plan propuesto', 'Plan de trabajo.', 'Qué conectar y qué hacer para automatizar más consultas.')
plan = [
    ('Información y seguimiento',
     'Conectar los pedidos de Shopify con el seguimiento real de Andreani. Mantener precios, stock, cupones y guías actualizados. La IA debe recibir el correo, pedido o foto que solicitó antes de pausar la conversación.'),
    ('Cambios y reposiciones',
     'Permitir cambios antes del despacho y gestionar los posteriores con el transportista. Definir qué fotos y condiciones permiten reponer productos dañados o faltantes. Habilitar esas acciones en la tienda.'),
    ('Pagos, facturas y devoluciones',
     'Conectar banco o billetera para verificar el dinero recibido y el sistema de facturación para obtener o emitir facturas. Acordar las reglas para cancelar pedidos o devolver dinero y habilitar esas gestiones en la tienda y el medio de pago.'),
    ('Excepciones y activación',
     'Asignar una persona para reclamos legales y excepciones comerciales. Acordar las reglas con el cliente, probar cada conexión con casos reales y activar por etapas. Medir lo resuelto y los motivos que siguen requiriendo al equipo.'),
]
for i, (title, body) in enumerate(plan):
    p.proposal(182+i*146, i+1, title, body)
p.text(42, 786, 'Estas conexiones son propuestas; las tres correcciones ya están publicadas.', size=12.5)
p.end()
p.c.save()

# Validate the brief's scope, pagination, readable text and page geometry.
doc = pymupdf.open(OUT)
assert len(doc) == p.page == 3
assert len(doc.get_toc()) == 3
text = '\n'.join(page.get_text() for page in doc)
assert all(token in text for token in ['66,2%', '21,1%', '135 hilos', '53 hilos', '10 bloqueos', '76 pruebas'])
assert not re.search(r'\b[0-9a-f]{8}-[0-9a-f]{4}-', text)
assert 'Anexo' not in text and '\ufffd' not in text
bad_bounds = []
small_body = []
for i, page in enumerate(doc, 1):
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                x0, y0, x1, y1 = span['bbox']
                if x0 < 29 or x1 > W-29 or y0 < 15 or y1 > H-12:
                    bad_bounds.append((i, span['text'], span['bbox']))
                if 75 <= y0 <= 792 and span['size'] < 12.5:
                    small_body.append((i, span['text'], span['size']))
    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(str(QA / f'page-{i:02}.png'))
assert not bad_bounds, bad_bounds
assert not small_body, small_body
proof = {'file': str(OUT), 'pages': len(doc), 'historicalEscalations': 135,
         'escalationCategories': 8, 'individualCasesListed': False, 'appendices': False,
         'bodyFontPoints': 13, 'minimumSupportingTextPoints': 12.5,
         'undersizedBodyText': small_body,
         'outOfPageTextSpans': bad_bounds, 'bytes': OUT.stat().st_size}
(QA / 'validation.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
doc.close()
print(json.dumps(proof, ensure_ascii=False))
