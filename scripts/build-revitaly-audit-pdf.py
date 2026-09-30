"""Build the five-page Riverz client summary from the preserved Revitaly audit.

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
QA = ROOT / 'tmp/pdfs/revitaly-five-pages'
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
     'El plazo venció, el cliente no recibió el paquete o el seguimiento no coincide. Hay que comprobarlo y gestionar con logística.'),
    ('Cambio de dirección, entrega o datos', 'Cambios de pedido o dirección', 26,
     'Hay que modificar una compra existente y verificar si ya salió. Hoy la IA no ejecuta esos cambios.'),
    ('Cancelación o reembolso', 'Cancelaciones y reembolsos', 23,
     'Hay que comprobar las condiciones de devolución y ejecutar una operación sobre dinero o un pedido.'),
    ('Producto dañado, distinto o faltante', 'Productos dañados o faltantes', 18,
     'Hay que verificar lo recibido y decidir una reposición o compensación según la política del comercio.'),
    ('Acreditación o cobro', 'Pagos y cobros por verificar', 13,
     'Un comprobante no demuestra que el dinero ingresó. Hay que revisar la transacción y posibles diferencias o duplicados.'),
    ('Dato o decisión no verificada', 'Información o decisión comercial', 11,
     'Falta confirmar un dato de stock, cupón o condiciones, o decidir una excepción o un canje comercial.'),
    ('Reclamo legal', 'Reclamos legales', 6,
     'Necesitan una persona responsable que evalúe el reclamo y decida la respuesta final.'),
    ('Factura', 'Facturas', 2,
     'La IA todavía no tiene una conexión habilitada para recuperar o emitir la factura del comercio.'),
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
        self.c.setSubject('Escalamientos reales, mejoras publicadas y propuestas en cinco páginas')
        self.page = 0

    def text(self, x, y, text, font='Sans', size=11.5, color=INK, width=511):
        text = clean(text)
        tw = pdfmetrics.stringWidth(text, font, size)
        assert x >= 30 and x + tw <= W - 30 and tw <= width + .1, (self.page, text, tw)
        assert 20 <= y <= 823
        glyphs = pdfmetrics.getFont(font).face.charToGlyph
        assert all(ord(c) in glyphs for c in text), text
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        self.c.drawString(x, H-y, text)

    def wrap(self, x, y, text, width=511, size=11.5, leading=16, font='Sans', color=INK):
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
        self.text(356, 44, label.upper(), 'Semi', 8.1, MUTED, 197)
        self.line(65)
        end = self.wrap(42, 118, title, size=34, leading=39, font='Serif')
        self.wrap(42, end-8, subtitle, size=11.2, leading=16, color=MUTED)
        key = f'page-{self.page}'
        self.c.bookmarkPage(key)
        self.c.addOutlineEntry(title, key, level=0)

    def end(self):
        self.line(802)
        self.text(42, 820, 'riverz.co  |  Revitaly  |  30 septiembre 2026', size=8, color=MUTED)
        self.text(523, 820, f'{self.page:02}', 'Semi', 8, MUTED)
        self.c.showPage()

    def simple(self, y, title, body, height=70):
        self.box(42, y, 511, height)
        self.text(60, y+23, title, 'Semi', 12)
        end = self.wrap(60, y+45, body, 475, size=11.2, leading=15, color=MUTED)
        assert end-15+4 <= y+height-5, (self.page, title, end, y+height)

    def proposal(self, y, number, title, body, height=130):
        self.box(42, y, 511, height)
        self.box(60, y+17, 27, 27, LIME, 8)
        self.text(69, y+36, str(number), 'Semi', 11)
        self.text(99, y+37, title, 'Serif', 22, width=436)
        end = self.wrap(60, y+65, body, 475, size=11.5, leading=16, color=MUTED)
        assert end-16+4 <= y+height-10, (self.page, title, end, y+height)

    def note(self, y, title, body, height=108):
        self.box(42, y, 511, height, INK)
        self.text(60, y+31, title, 'Serif', 23, LIME, 475)
        end = self.wrap(60, y+56, body, 475, size=11.2, leading=16, color=CARD)
        assert end-16+4 <= y+height-10, (self.page, title, end, y+height)

p = PDF()

# 1. One clear denominator, concise findings and the three published fixes.
p.header('Resumen', 'Revitaly. Auditoría y plan.', 'Qué encontramos, qué corregimos y cómo ampliar la automatización.')
for x, rate, label, count in [
    (42, '66,2%', 'IA sin respuesta humana', '135 de 204 consultas recientes'),
    (304, '21,1%', 'Intervención justificada', '43 de 204 consultas recientes'),
]:
    p.box(x, 189, 249, 113, PALE if x == 42 else CARD)
    p.text(x+17, 231, rate, 'Serif', 37)
    p.text(x+17, 258, label, 'Semi', 10.4)
    p.text(x+17, 281, count, size=9.6, color=MUTED)
p.wrap(42, 330, 'Revisamos 2.098 hilos del historial; 559 son consultas reales. Los porcentajes de arriba corresponden a las 204 consultas del 26 al 30 de septiembre, hasta las 12:04 de Argentina.', size=11.2, leading=16, color=MUTED)
p.wrap(42, 390, 'La atención por IA no equivale a resolución completa. Un hilo puede recibir respuestas de IA y luego necesitar una intervención humana.', size=10.6, leading=15, color=MUTED)
p.simple(432, '53 hilos con respuesta insuficiente. 10 bloqueos evitables.',
         'Se observaron omisiones, demoras y respuestas incompletas. Se corrigieron tres causas concretas; las demás mejoras forman parte del plan.', 78)
p.text(42, 543, 'Tres mejoras ya publicadas', 'Serif', 26)
p.simple(563, 'Transferencias',
         'La IA entrega el titular, CVU y alias configurados cuando el cliente los solicita.', 62)
p.simple(636, 'Consultas por correo',
         'Reconoce preguntas escritas en el asunto, aunque el cuerpo esté vacío o sea una firma.', 62)
p.simple(709, 'Capturas de pantalla',
         'Un botón de reembolso visible en una captura ya no se interpreta como una petición del cliente.', 70)
p.end()

# 2. The complete escalation analysis, grouped instead of listing customers.
p.header('Escalamientos reales', 'Cuándo necesita a tu equipo.', '135 hilos históricos justificaron intervención. Cada uno cuenta en un motivo principal.')
for i, (category, title, count, why) in enumerate(REASONS):
    y = 192+i*68
    p.box(42, y, 511, 62, CARD, 11)
    p.text(60, y+21, title, 'Semi', 11.6, width=443)
    p.text(520, y+23, str(count), 'Serif', 22)
    end = p.wrap(60, y+41, why, 475, size=10.5, leading=14, color=MUTED)
    assert end-14+3 <= y+62-4, (title, end, y+62)
p.wrap(42, 763, 'Son motivos encontrados en el historial, no 135 pendientes actuales. Algunos casos ya se resolvieron o repiten un reclamo en otro canal.', size=10.3, leading=14, color=MUTED)
p.end()

# 3. Plain language: information sources, invoicing and accountable escalation.
p.header('Plan propuesto / Conexiones', 'Conectar la información correcta.', 'Qué necesitamos conectar o definir para resolver más consultas automáticamente.')
connections = [
    ('Entregas y seguimiento',
     'Aprovechar los pedidos de Shopify y completar la conexión con el seguimiento real de Andreani. La IA podrá explicar dónde está el paquete y detectar demoras. Los destinos incorrectos o las entregas disputadas pasarán a gestión logística.'),
    ('Información comercial y guías',
     'Centralizar precios, stock, promociones, condiciones de compra y enlaces de las guías. El equipo mantendrá esa información actualizada. La IA podrá responder preguntas habituales y reenviar el material que corresponda a cada compra.'),
    ('Facturas',
     'Conectar el sistema que utiliza el comercio para facturar. La IA podrá localizar y reenviar facturas existentes. Para emitirlas, se definirán los datos necesarios y las condiciones que debe cumplir.'),
    ('Reclamos legales',
     'Definir una persona responsable y cómo se le entrega el caso. La IA recopilará el pedido y los antecedentes para evitar preguntas repetidas. La evaluación y la respuesta final seguirán a cargo de esa persona.'),
]
for i, (title, body) in enumerate(connections):
    p.proposal(195+i*144, i+1, title, body)
p.end()

# 4. The four operational capabilities and their business rules.
p.header('Plan propuesto / Gestiones', 'Habilitar acciones sobre pedidos.', 'La IA ejecutará únicamente las operaciones permitidas por las reglas acordadas.')
operations = [
    ('Cambios de dirección o entrega',
     'Habilitar la modificación de pedidos y definir hasta cuándo se permiten cambios. La IA comprobará si el pedido ya salió, confirmará el nuevo destino con el cliente y hará los cambios permitidos. Después del despacho, se gestionará con el transportista.'),
    ('Productos dañados o faltantes',
     'Definir la política de reposición y conectar la gestión de esos envíos. La IA pedirá fotos, comprobará lo comprado y preparará o ejecutará la reposición dentro de las condiciones acordadas.'),
    ('Transferencias y cobros',
     'Conectar la fuente donde el comercio verifica el dinero recibido: banco, billetera o sistema de cobros. La IA comparará el pago con el pedido y confirmará solo coincidencias verificadas. Las diferencias o duplicados tendrán revisión humana.'),
    ('Cancelaciones y reembolsos',
     'Definir las condiciones de devolución y habilitar su gestión en la tienda y el medio de pago. La IA comprobará si el caso cumple esas condiciones y preparará la devolución. La ejecución automática seguirá las reglas acordadas.'),
]
for i, (title, body) in enumerate(operations):
    p.proposal(195+i*144, i+5, title, body)
p.end()

# 5. A concrete sequence without a speculative timeline or extra technical detail.
p.header('Orden de trabajo', 'Cómo lo pondremos en marcha.', 'Las tres correcciones anteriores ya están publicadas. Las conexiones siguientes son propuestas.')
p.proposal(196, 1, 'Confirmar sistemas y reglas',
           'El cliente confirma cómo verifica transferencias y cómo emite facturas. También definimos las condiciones de cambios, reposiciones y devoluciones, y quién aprueba las excepciones.', 123)
p.proposal(331, 2, 'Conectar consultas y habilitar gestiones',
           'Primero completamos la información de pedidos, seguimiento y condiciones comerciales. Después habilitamos las operaciones permitidas y dejamos registro de cada acción, evitando duplicados.', 123)
p.proposal(466, 3, 'Probar con casos reales y activar',
           'Comprobamos que la IA consulte el pedido correcto, responda y ejecute solo lo autorizado. Tras activar cada flujo, medimos las consultas resueltas y los motivos que siguen necesitando al equipo.', 123)
p.note(615, 'Primera prioridad: completar la conversación',
       'Si la IA pide correo, número de pedido o foto, debe poder recibirlos antes de pausar. Así el equipo recibirá un caso identificado y el cliente evitará repetir su explicación.', 116)
p.wrap(42, 759, 'Validación de lo publicado: 76 pruebas aprobadas y comprobación en producción de la transferencia y de una respuesta generativa.', size=10.5, leading=15, color=MUTED)
p.end()
p.c.save()

# Validate the brief's scope, pagination, readable text and page geometry.
doc = pymupdf.open(OUT)
assert len(doc) == p.page == 5
assert len(doc.get_toc()) == 5
text = '\n'.join(page.get_text() for page in doc)
assert all(token in text for token in ['66,2%', '21,1%', '135 hilos', '53 hilos', '10 bloqueos', '76 pruebas'])
assert not re.search(r'\b[0-9a-f]{8}-[0-9a-f]{4}-', text)
assert 'Anexo' not in text and '\ufffd' not in text
bad_bounds = []
for i, page in enumerate(doc, 1):
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                x0, y0, x1, y1 = span['bbox']
                if x0 < 29 or x1 > W-29 or y0 < 15 or y1 > H-12:
                    bad_bounds.append((i, span['text'], span['bbox']))
    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(str(QA / f'page-{i:02}.png'))
assert not bad_bounds, bad_bounds
proof = {'file': str(OUT), 'pages': len(doc), 'historicalEscalations': 135,
         'escalationCategories': 8, 'individualCasesListed': False, 'appendices': False,
         'outOfPageTextSpans': bad_bounds, 'bytes': OUT.stat().st_size}
(QA / 'validation.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
doc.close()
print(json.dumps(proof, ensure_ascii=False))
