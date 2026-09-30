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
source = read('source')
assert source['capturedAt'] == metrics['capturedAt']
assert metrics['all']['total'] == 2098
assert metrics['customer_service']['total'] == 559
assert (metrics['all']['missed_reply'], metrics['all']['premature']) == (53, 10)
assert (metrics['sinceSept26']['total'], metrics['sinceSept26']['ai_only_period'],
        metrics['sinceSept26']['human_required_in_period']) == (204, 135, 43)
assert len(cases) == 135

# Count recorded successful AI sends, not attempts or manual/outbound campaigns.
# Comment-generated private replies belong to conversations, not public replies.
channels = {c['id']: c['channel'] for c in source['conversations']}
sent = [m for m in source['messages']
        if m['sender_type'] in {'agent', 'bot'}
        and m['origin'] in {'ai_agent', 'comment_ai'}
        and m['status'] in {'sent', 'delivered', 'read'}]
public = [m for m in sent if channels[m['conversation_id']] in {'fb_comment', 'ig_comment'}]
private = [m for m in sent if channels[m['conversation_id']] not in {'fb_comment', 'ig_comment'}]
answered = len({m['conversation_id'] for m in private})
public_threads = len({m['conversation_id'] for m in public})
assert (answered, len(private), len(public), public_threads) == (186, 838, 27, 26)
human_rate = 100 * len(cases) / metrics['customer_service']['total']
inbox_rate = 100 * len(cases) / metrics['all']['total']
rate = lambda value: f'{value:.1f}%'.replace('.', ',')

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

    def header(self, title, subtitle):
        self.page += 1
        self.c.setFillColor(BG)
        self.c.rect(0, 0, W, H, fill=1, stroke=0)
        self.text(42, 47, 'riverz', 'Logo', 24)
        self.line(65)
        end = self.wrap(42, 118, title, size=34, leading=39, font='Serif')
        self.wrap(42, end-8, subtitle, size=13, leading=18)
        key = f'page-{self.page}'
        self.c.bookmarkPage(key)
        self.c.addOutlineEntry(title, key, level=0)

    def end(self):
        self.line(802)
        self.text(523, 820, f'{self.page:02}', 'Semi', 9, MUTED)
        self.c.showPage()

    def simple(self, y, title, body, height=65):
        self.box(42, y, 511, height)
        self.text(60, y+23, title, 'Semi', 15)
        end = self.wrap(60, y+47, body, 475)
        assert end-18+4 <= y+height-8, (self.page, title, end, y+height)

    def proposal(self, y, number, title, body, height=94):
        self.box(42, y, 511, height)
        self.box(60, y+10, 25, 25, LIME, 8)
        self.text(68, y+28, str(number), 'Semi', 12.5)
        self.text(97, y+28, title, 'Semi', 15, width=438)
        end = self.wrap(60, y+49, body, 475)
        assert end-18+4 <= y+height-5, (self.page, title, end, y+height)

p = PDF()

# 1. Cumulative recorded responses, genuine intervention and published fixes.
p.header('Revitaly. Atención y mejoras.', '')
for x, value, label, detail in [
    (42, str(answered), 'Conversaciones\nrespondidas', f'{len(private)} respuestas de IA'),
    (216, str(len(public)), 'Respuestas a\ncomentarios', f'En {public_threads} conversaciones'),
    (390, rate(human_rate), 'Intervención\njustificada', '135 de 559 consultas'),
]:
    p.box(x, 182, 163, 137, PALE if x == 42 else CARD)
    p.text(x+16, 226, value, 'Serif', 42, width=131)
    end = p.wrap(x+16, 255, label, 131, size=12.5, leading=17, font='Semi')
    assert end <= 289
    p.text(x+16, 298, detail, size=12.5, width=131)
p.text(42, 345, 'Corte: 30 de septiembre, 12:04 de Argentina.', size=12.5)
end = p.wrap(42, 378, '2.098 conversaciones revisadas. El porcentaje considera solo consultas de clientes.')
assert end-18+4 < 457
p.text(42, 466, 'Tres mejoras ya publicadas', 'Serif', 27)
p.simple(486, 'Transferencias',
         'Envía titular, CVU y alias sin exigir pack ni dirección.', 87)
p.simple(582, 'Consultas por correo',
         'Responde preguntas del asunto aunque el correo no tenga texto.', 87)
p.simple(678, 'Capturas de pantalla',
         'Un botón de reembolso en una captura no provoca un escalamiento.', 87)
p.end()

# 2. The complete escalation analysis, grouped instead of listing customers.
p.header('Por qué se escala a humano', '135 casos históricos, por motivo principal.')
for i, (category, title, count, why) in enumerate(REASONS):
    y = 182+i*70
    p.box(42, y, 511, 63, CARD, 11)
    p.text(60, y+22, title, 'Semi', 15, width=443)
    p.text(520, y+24, str(count), 'Serif', 25)
    end = p.wrap(60, y+47, why, 475)
    assert end-18+4 <= y+63-8, (title, end, y+63)
p.wrap(42, 764, 'Histórico, no pendientes actuales. Puede incluir reclamos repetidos entre canales.', size=12.5)
p.end()

# 3. Six concrete customer-facing capabilities, covering all eight reasons.
p.header('Plan de acción', 'Acciones a habilitar según las reglas del comercio.')
plan = [
    ('Editar direcciones de pedidos',
     'En Shopify, cambiar calle, número, piso o código postal tras confirmar los datos con el cliente. Una vez despachado, no se modifica la dirección.'),
    ('Seguimiento y avisos de demora',
     'Consultar Andreani, avisar demoras y explicar dónde está el pedido. Si la entrega se disputa, reunir los datos y escalar.'),
    ('Resolver faltantes y daños',
     'Verificar fotos y pedido. Si la política de reposición lo permite, crear el pedido de reemplazo y enviar su seguimiento.'),
    ('Confirmar pagos y enviar facturas',
     'Conectar banco o billetera para verificar el pago y asociarlo al pedido. Conectar el sistema de facturación para emitir o reenviar la factura.'),
    ('Cancelar pedidos y devolver dinero',
     'Conectar la tienda y el medio de pago. Cancelar o reembolsar según las condiciones del comercio; pedir aprobación para excepciones.'),
    ('Responder más y escalar mejor',
     'Usar precios, stock, promociones y guías actualizados. Recibir los datos solicitados antes de pausar. Enviar al equipo un resumen de excepciones o reclamos legales.'),
]
for i, (title, body) in enumerate(plan):
    p.proposal(184+i*98, i+1, title, body)
p.text(42, 786, 'Probar cada acción con casos reales antes de activarla.', size=12.5)
p.end()
p.c.save()

# Validate the brief's scope, pagination, readable text and page geometry.
doc = pymupdf.open(OUT)
assert len(doc) == p.page == 3
assert len(doc.get_toc()) == 3
text = '\n'.join(page.get_text() for page in doc)
normalized_text = re.sub(r'\s+', ' ', text)
assert all(token in normalized_text for token in ['186', '27', '838 respuestas de IA', '24,2%', '135 casos', 'Por qué se escala a humano', 'Plan de acción', 'Editar direcciones', 'crear el pedido de reemplazo', 'Una vez despachado, no se modifica la dirección.'])
assert 'Por qué se necesita al equipo' not in text and 'pedir el cambio al transportista' not in text
assert all(removed not in normalized_text for removed in ['Validado en producción', 'RESULTADOS', 'ESCALAMIENTOS REALES', 'PLAN PROPUESTO', 'GUÍA DE CAPACIDADES', 'riverz.co |'])
assert '66,2%' not in text and '21,1%' not in text
assert round(human_rate, 1) == 24.2 and round(inbox_rate, 1) == 6.4
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
                if y0 < 75:
                    assert span['text'] == 'riverz', (i, span['text'])
    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(str(QA / f'page-{i:02}.png'))
assert not bad_bounds, bad_bounds
assert not small_body, small_body
proof = {'file': str(OUT), 'pages': len(doc), 'historicalEscalations': 135,
         'dataCapturedAt': source['capturedAt'], 'AIAnsweredConversations': answered,
         'AIConversationMessages': len(private), 'publicCommentReplies': len(public),
         'publicCommentThreads': public_threads, 'genuineInterventionDenominator': 559,
         'genuineInterventionPercent': round(human_rate, 1), 'proposedCapabilities': len(plan),
         'escalationCategories': 8, 'individualCasesListed': False, 'appendices': False,
         'bodyFontPoints': 13, 'minimumSupportingTextPoints': 12.5,
         'undersizedBodyText': small_body,
         'outOfPageTextSpans': bad_bounds, 'bytes': OUT.stat().st_size}
(QA / 'validation.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
doc.close()
print(json.dumps(proof, ensure_ascii=False))
