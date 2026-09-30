"""Build a Riverz-branded client report from the preserved Revitaly audit.

Run: py -X utf8 scripts/build-revitaly-audit-pdf.py
Requires reportlab, Pillow and PyMuPDF. Customer records stay in ignored output/.
The source audit is preserved; the PDF distinguishes observed results from proposals.
"""
from pathlib import Path
from collections import Counter
import json
import re
import unicodedata
import pymupdf
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'output/reevitaly-audit'
ASSETS = ROOT / 'docs/documentos-riverz/assets'
OUT = ROOT / 'output/pdf/riverz-auditoria-y-plan-revitaly.pdf'
QA = ROOT / 'tmp/pdfs/revitaly-audit'
W, H = 595.276, 841.89
BG, INK, MUTED, CARD, LINE, LIME, PALE, WHITE = map(HexColor, [
    '#F3F0EB', '#12201F', '#53615A', '#FAF7F1', '#E8DECB',
    '#F7FF9E', '#E8EDDD', '#FFFFFF',
])
for alias, name in [('Sans', 'Sans-full.ttf'), ('Semi', 'Semi-full.ttf'),
                    ('Serif', 'Serif-full.ttf'), ('Logo', 'Logo.ttf')]:
    pdfmetrics.registerFont(TTFont(alias, str(ASSETS / 'fonts' / name)))

def read(name):
    return json.loads((DATA / f'{name}.json').read_text(encoding='utf-8'))

ROWS, HUMAN, METRICS = read('reviewed-conversations'), read('escalamientos'), read('metrics')
BY_ID = {r['id']: r for r in ROWS}
assert len(ROWS) == 2098 and len(HUMAN) == 135
assert len({r['id'] for r in HUMAN}) == 135
assert sum(bool(r['premature']) for r in ROWS) == 10
assert sum(bool(r['missed_reply']) for r in ROWS) == 53
assert sum(r['active_period'] and r['current_human'] for r in ROWS) == 36
assert (METRICS['all']['ai_only'], METRICS['all']['human_required_ever']) == (173, 135)
assert (METRICS['customer_service']['total'], METRICS['customer_service']['ai_only']) == (559, 167)
assert (METRICS['sinceSept26']['total'], METRICS['sinceSept26']['ai_only_period'],
        METRICS['sinceSept26']['human_required_in_period']) == (204, 135, 43)
assert sum(r['currentlyUnresolvedInThread'] for r in HUMAN) == 101

CHANNELS = {'whatsapp': 'WhatsApp', 'gmail': 'Correo', 'mercadolibre': 'Mercado Libre',
            'instagram': 'Instagram', 'messenger': 'Messenger',
            'fb_comment': 'Comentario en Facebook', 'ig_comment': 'Comentario en Instagram'}
CATEGORY = {
    'Demora o disputa de entrega': ('Entregas', 36, 'Consultar pedido y recorrido real del paquete; gestionar con logística si hay demora o disputa. Referencia: plan de entregas.'),
    'Cambio de dirección, entrega o datos': ('Cambios de pedido', 26, 'Verificar si salió y confirmar el cambio; modificar antes del despacho o coordinar con logística. Referencia: plan de cambios.'),
    'Cancelación o reembolso': ('Cancelaciones y reembolsos', 23, 'Verificar pedido, pago y condiciones de devolución; preparar la operación según la política aprobada. Referencia: plan de reembolsos.'),
    'Producto dañado, distinto o faltante': ('Productos dañados o faltantes', 18, 'Recopilar fotos y comprobar cantidades y variantes; preparar una reposición o compensación autorizada. Referencia: plan de reposiciones.'),
    'Acreditación o cobro': ('Pagos y cobros', 13, 'Comprobar el dinero en el canal de cobro y vincularlo con el pedido; revisar diferencias y duplicados. Referencia: plan de pagos.'),
    'Dato o decisión no verificada': ('Información o decisión comercial', 11, 'Confirmar el dato o decisión con el responsable e incorporar la fuente aprobada; resolver consultas e identificar excepciones. Referencia: información comercial.'),
    'Reclamo legal': ('Reclamos legales', 6, 'Reunir antecedentes y asignar responsable del comercio; conservar decisión y respuesta final humanas. Referencia: atención de excepciones.'),
    'Factura': ('Facturas', 2, 'Verificar pedido y datos fiscales; recuperar o emitir el comprobante mediante el sistema del comercio. Referencia: plan de facturación.'),
}
assert Counter(r['category'] for r in HUMAN) == Counter({k: v[1] for k, v in CATEGORY.items()})

def clean(s, name=False):
    s = unicodedata.normalize('NFC', str(s or ''))
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')
    # Display names can contain emoji outside the brand font's glyph coverage.
    glyphs = pdfmetrics.getFont('Sans').face.charToGlyph
    s = ''.join(c for c in s if ord(c) in glyphs or c.isspace())
    if name and (not s or not any(c.isalnum() for c in s)):
        return 'Sin nombre visible'
    return s

def natural(s):
    s = clean(s)
    for a, b in [('ai_disabled_for_conversation', 'IA pausada en la conversación'),
                 ('comment_afirma_lo_que_no_sabe', 'filtro de afirmaciones sin respaldo'),
                 ('comment_sin_saldo', 'falta de saldo para responder comentarios'),
                 ('comment_spam', 'contenido no deseado'), ('motor_apagado', 'motor de IA apagado'),
                 ('ai_replies', 'registro de respuestas'), ('sin_agente', 'sin agente asignado'),
                 ('sin_pagar', 'bloqueo de facturación'), ('skipped', 'respuesta omitida'),
                 ('skip', 'omisión'), ('lookup', 'búsqueda del pedido'), ('OCR', 'lectura de la imagen'),
                 ('tracking', 'seguimiento'), ('answer_gap', 'información faltante'),
                 ('trigger', 'activación del flujo')]:
        s = s.replace(a, b)
    return s

class PDF:
    def __init__(self):
        OUT.parent.mkdir(parents=True, exist_ok=True)
        QA.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
        self.c.setTitle('Revitaly | Auditoría y plan de automatización | Riverz')
        self.c.setAuthor('Riverz')
        self.c.setSubject('Resultados verificados, mejoras publicadas y escalamientos reales')
        self.page = 0
        self.bounds = []
        self.sections = []
        self.case_pages = {}

    def text(self, x, y, text, font='Sans', size=11, color=INK, width=None):
        text = clean(text)
        tw = pdfmetrics.stringWidth(text, font, size)
        assert x >= 30 and x + tw <= W - 30, (self.page, text, x, tw)
        assert 22 <= y <= 823, (self.page, text, y)
        if width is not None:
            assert tw <= width + .2, (self.page, text, tw, width)
        self.c.setFillColor(color)
        self.c.setFont(font, size)
        self.c.drawString(x, H - y, text)
        self.bounds.append((self.page, x, y, tw, size, text))

    def lines(self, text, width, size=11, font='Sans'):
        result = []
        for paragraph in str(text).split('\n'):
            line = ''
            for word in clean(paragraph).split():
                trial = f'{line} {word}'.strip()
                if line and pdfmetrics.stringWidth(trial, font, size) > width:
                    result.append(line)
                    line = word
                else:
                    line = trial
            if line:
                result.append(line)
        return result

    def wrap(self, x, y, text, width=511, size=11, leading=16, font='Sans', color=INK):
        for line in self.lines(text, width, size, font):
            self.text(x, y, line, font, size, color, width)
            y += leading
        return y

    def box(self, x, y, width, height, fill=CARD, radius=15):
        self.c.setFillColor(fill)
        self.c.roundRect(x, H - y - height, width, height, radius, fill=1, stroke=0)

    def line(self, x1, y1, x2, y2, color=LINE):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(.7)
        self.c.line(x1, H - y1, x2, H - y2)

    def header(self, label, title, subtitle='', compact=False, dark=False):
        self.page += 1
        self.label, self.dark = label, dark
        self.c.setFillColor(INK if dark else BG)
        self.c.rect(0, 0, W, H, fill=1, stroke=0)
        self.text(42, 47, 'riverz', 'Logo', 24, LIME if dark else INK)
        self.text(356, 44, label.upper(), 'Semi', 8, LIME if dark else MUTED, 197)
        self.line(42, 65, 553, 65, HexColor('#36433B') if dark else LINE)
        size, lead = (29, 33) if compact else (36, 40)
        end = self.wrap(42, 118, title, size=size, leading=lead, font='Serif', color=LIME if dark else INK)
        if subtitle:
            self.wrap(42, end - 9, subtitle, size=11.2, leading=16, color=CARD if dark else MUTED)
        self.sections.append({'page': self.page, 'label': label, 'title': title.replace('\n', ' ')})
        key = f'page-{self.page}'
        self.c.bookmarkPage(key)
        if 'Continuación' not in title:
            self.c.addOutlineEntry(title.replace('\n', ' '), key, level=0)

    def end(self):
        self.line(42, 802, 553, 802, HexColor('#36433B') if self.dark else LINE)
        color = LIME if self.dark else MUTED
        self.text(42, 820, 'riverz.co  |  Revitaly  |  Uso operativo', size=8, color=color)
        self.text(523, 820, f'{self.page:02}', font='Semi', size=8, color=color)
        self.c.showPage()

    def card(self, y, title, body, height=110, label=None):
        self.box(42, y, 511, height)
        yy = y + 24
        if label:
            self.text(60, yy, label.upper(), 'Semi', 8.4, MUTED)
            yy += 28
        self.text(60, yy, title, 'Serif', 23)
        bottom = self.wrap(60, yy + 25, body, 475, size=11, leading=16, color=MUTED)
        assert bottom <= y + height, (self.page, title, bottom, y + height)

    def note(self, y, title, body, height=94):
        self.box(42, y, 511, height, INK)
        self.text(60, y + 30, title, 'Serif', 22, LIME)
        end = self.wrap(60, y + 53, body, 475, size=10.5, leading=15, color=CARD)
        assert end <= y + height, (self.page, title, end)

    def plan(self, y, number, title, connection, result, height=160):
        self.box(42, y, 511, height)
        self.box(60, y + 16, 27, 27, LIME, 8)
        self.text(69, y + 35, str(number), 'Semi', 11)
        self.text(98, y + 36, title, 'Serif', 22)
        yy = self.wrap(60, y + 63, 'Qué haremos. ' + connection, 475, size=10.7, leading=15, color=INK)
        yy = self.wrap(60, yy + 8, 'Resultado esperado. ' + result, 475, size=10.7, leading=15, color=MUTED)
        assert yy <= y + height, (self.page, title, yy, y + height)

    def record(self, y, code, name, meta, why, action, key):
        name_lines = self.lines(f'{code}  {clean(name, name=True)}', 475, 11.2, 'Semi')
        why_lines = self.lines('Motivo. ' + natural(why), 475, 10.2)
        action_lines = self.lines('Acción propuesta. ' + natural(action), 475, 10.2)
        meta_lines = self.lines(meta, 475, 8.4)
        height = 18 + 15 * len(name_lines) + 12 * len(meta_lines) + 7 + 14 * len(why_lines) + 5 + 14 * len(action_lines) + 12
        if y + height > 782:
            return None, height
        self.box(42, y, 511, height, CARD, 12)
        yy = y + 21
        for line in name_lines:
            self.text(60, yy, line, 'Semi', 11.2)
            yy += 15
        for line in meta_lines:
            self.text(60, yy, line, size=8.4, color=MUTED)
            yy += 12
        yy += 7
        for line in why_lines:
            self.text(60, yy, line, size=10.2)
            yy += 14
        yy += 5
        for line in action_lines:
            self.text(60, yy, line, size=10.2, color=MUTED)
            yy += 14
        assert yy <= y + height - 5
        self.case_pages[key] = {'page': self.page, 'code': code}
        return y + height + 10, height

    def finish(self):
        self.c.save()
        return self

p = PDF()

# 01: The same typography, palette and illustration family as the supplied PDF.
p.header('Auditoría y plan', 'Revitaly.\nAtención que mejora.', 'Resultados verificados y próximos pasos de automatización.')
p.c.drawImage(str(ASSETS / 'riverz-flota-original.png'), 42, H - 224 - 311, 511, 311,
              mask='auto', preserveAspectRatio=True, anchor='c')
for x, value, title, body in [
    (42, '66,2%', 'IA sin respuesta humana', '135 de 204 consultas recientes.'),
    (304, '21,1%', 'Intervención justificada', '43 de 204 consultas recientes.'),
]:
    p.box(x, 556, 249, 116, PALE if x == 42 else CARD)
    p.text(x + 17, 598, value, 'Serif', 37)
    p.text(x + 17, 626, title, 'Semi', 10.3)
    p.text(x + 17, 649, body, size=9.5, color=MUTED)
p.wrap(42, 704, '2.098 conversaciones revisadas  |  6.192 mensajes', size=12, font='Semi')
p.wrap(42, 732, 'Corte: 30 de septiembre de 2026, 12:04 Argentina. Las tasas miden respuestas registradas, no resolución completa.', size=10.5, leading=15, color=MUTED)
p.end()

# 02: Executive summary and accurate status separation.
p.header('Resumen ejecutivo', 'Qué encontramos.\nQué ya funciona.', 'Revisión completa del historial disponible, de junio a septiembre de 2026.')
p.card(216, '53 conversaciones con respuesta insuficiente',
       'Incluyen respuestas omitidas, demoradas o incompletas. Hay pausas, límites operativos y activaciones ausentes; no todos los silencios prueban un fallo de razonamiento.', 119)
p.card(348, '10 bloqueos o derivaciones evitables',
       'La IA podía responder o recopilar datos antes de suspender el hilo. Dos casos son comentarios públicos bloqueados por filtros, no transferencias a una persona.', 119)
p.card(480, 'Tres correcciones publicadas',
       'Datos de transferencia, consultas en el asunto del correo y separación entre lo que dice el cliente y los botones visibles en una captura.', 108)
p.note(608, 'Un plan para ampliar la autonomía',
       'Las conexiones de pagos, logística, cambios, reposiciones y facturas son propuestas. No se presentan como implementadas ni como compromisos de plazo.', 110)
p.wrap(42, 746, 'El anexo A reúne los 135 escalamientos reales. Los anexos B y C detallan los bloqueos evitables y las respuestas insuficientes.', size=10.5, leading=15, color=MUTED)
p.end()

# 03: Denominators, overlaps and current visibility.
p.header('Medición', 'Cuánto se automatiza.\nCuánto necesita al equipo.', 'Separar consultas reales del resto de la bandeja permite interpretar los resultados.')
table_y = 217
p.box(42, table_y, 511, 54, INK, 12)
p.text(59, table_y + 29, 'Universo', 'Semi', 10.5, LIME)
p.wrap(283, table_y + 21, 'IA sin respuesta\nhumana', 125, 10, 14, 'Semi', LIME)
p.wrap(425, table_y + 21, 'Intervención\njustificada', 110, 10, 14, 'Semi', LIME)
for i, (label, n, ai, human, ai_rate, human_rate) in enumerate([
    ('Toda la bandeja', 2098, 173, 135, '8,2%', '6,4%'),
    ('Consultas reales a la tienda', 559, 167, 135, '29,9%', '24,2%'),
    ('Consultas del 26/09 al corte', 204, 135, 43, '66,2%', '21,1%'),
]):
    y = table_y + 66 + i * 81
    p.box(42, y, 511, 71, PALE if i == 2 else CARD, 12)
    p.text(59, y + 25, label, 'Semi', 10.5)
    p.text(59, y + 48, f'{n:,} hilos'.replace(',', '.'), size=10, color=MUTED)
    for x, rate, count in [(283, ai_rate, ai), (425, human_rate, human)]:
        p.text(x, y + 28, rate, 'Serif', 23)
        p.text(x, y + 49, f'{count} de {n:,}'.replace(',', '.'), size=9.5, color=MUTED)
p.wrap(42, 553, 'Definición. Al menos una respuesta atribuible a IA y ninguna respuesta humana registrada en la ventana indicada. Las plantillas de pedido por sí solas no cuentan como IA.', size=10.5, leading=15, color=MUTED)
p.wrap(42, 618, 'Las columnas se solapan: un hilo puede tener respuestas de IA y después requerir una aprobación humana. En el período reciente se cuentan solo respuestas y motivos ocurridos desde el 26/09.', size=10.5, leading=15, color=MUTED)
p.note(694, '36 hilos recientes para revisar',
       'No tienen resolución humana visible al corte. Pueden estar resueltos en otro canal; no equivalen a 36 pendientes confirmados.', 88)
p.end()

# 04: Already implemented, not an assertion that all identified issues were fixed.
p.header('Mejoras publicadas', 'Tres correcciones.\nComprobadas y publicadas.', 'Se mantuvieron las restricciones de canal, la revisión de pagos y el control humano.')
p.card(216, 'La transferencia recibe una respuesta directa',
       'Cuando el cliente solicita alias, CVU o titular, la IA entrega los datos de la regla vigente. No exige elegir un pack ni dar una dirección para compartirlos. Los comprobantes siguen necesitando verificación.', 135, '01 / Transferencias')
p.card(364, 'El asunto del correo también se entiende',
       'Una consulta explícita en el asunto se reconoce aunque el cuerpo esté vacío o contenga una firma. Se conservan los filtros de autorespuestas y los casos que requieren revisión.', 125, '02 / Correo')
p.card(502, 'Los botones de una captura no son una petición',
       'Un botón de reembolso visible en una imagen ya no activa por sí solo una solicitud literal de devolución. La captura sigue disponible para entender problemas reales.', 125, '03 / Imágenes')
p.note(650, '76 pruebas y comprobación en producción',
       'El caso de Eduardo devuelve los datos correctos sin bloqueo. También pasó una respuesta generativa normal. Publicación confirmada el 30/09/2026.', 104)
p.end()

# 05: Exhaustive mutually-exclusive primary categories.
p.header('Escalamientos reales', 'Por qué interviene\nuna persona.', '135 hilos históricos, clasificados por un motivo principal sin contarlos dos veces.')
for i, (category, (label, count, action)) in enumerate(CATEGORY.items()):
    y = 219 + i * 54
    p.box(42, y, 511, 46, CARD, 10)
    p.text(59, y + 20, label, 'Semi', 10.8)
    p.text(520, y + 28, str(count), 'Serif', 23)
    p.box(59, y + 30, 401, 4, LINE, 2)
    p.box(59, y + 30, 401 * count / 36, 4, INK, 2)
p.note(670, 'Necesidad histórica, no lista de pendientes',
       'Algunos casos se resolvieron o repiten un reclamo en otro canal. El anexo distingue los recientes de los antiguos y explica cada motivo.', 100)
p.end()

# 06-08: Natural-language implementation plan, including all eight causes.
p.header('Plan / Etapa 1', 'Responder con\ninformación completa.', 'Propuesto: ampliar consultas y mantener la conversación activa mientras se recopilan datos.')
p.plan(216, 1, 'Entregas y seguimiento',
       'Aprovechar los pedidos de la tienda y completar la conexión con el recorrido real de Andreani o el canal de venta.',
       'Explicar dónde está el paquete y detectar demoras. Gestionar discrepancias con logística, sin confundir una etiqueta creada con un paquete recibido.')
p.plan(388, 2, 'Información comercial y guías',
       'Centralizar precios, stock, promociones, condiciones de compra, sucursales y enlaces de las guías; definir quién mantiene cada dato.',
       'Responder con información vigente y reenviar el material que corresponda a una compra, sin inventar condiciones ni descuentos.')
p.plan(560, 3, 'Completar los datos antes de pausar',
       'Ajustar el flujo para que la IA reciba el correo, número de pedido o foto que acaba de solicitar y vincule el reclamo entre canales.',
       'Entregar al equipo un caso identificado. Respetar la toma humana, la petición de hablar con una persona y las excepciones sensibles.')
p.end()

p.header('Plan / Etapa 2', 'Resolver gestiones\nsobre pedidos.', 'Propuesto: habilitar acciones concretas con las condiciones acordadas con Revitaly.')
p.plan(216, 4, 'Cambios de dirección o entrega',
       'Habilitar la modificación de pedidos y acordar qué cambios se permiten antes y después del despacho.',
       'Comprobar si salió, confirmar el destino con el cliente y ejecutar cambios permitidos. Después del despacho, coordinar con el transportista.')
p.plan(388, 5, 'Productos dañados o faltantes',
       'Definir la política de reposición y conectar la creación y seguimiento de esos envíos.',
       'Pedir fotos, verificar cantidades y variantes y preparar o ejecutar la reposición autorizada. Separar un regalo digital de una unidad física faltante.')
p.plan(560, 6, 'Facturas',
       'Conectar el sistema que utiliza el comercio para facturar y definir los datos fiscales necesarios.',
       'Localizar y reenviar facturas existentes. Emitir una nueva solo dentro de las reglas y permisos acordados, evitando duplicados.')
p.end()

p.header('Plan / Etapa 3', 'Verificar el dinero.\nAtender las excepciones.', 'Propuesto: conectar comprobaciones reales y definir quién decide cada operación.')
p.plan(216, 7, 'Transferencias y cobros',
       'Conectar la fuente donde se verifica el dinero recibido: banco, billetera o sistema de cobros; relacionarlo con cada pedido.',
       'Confirmar únicamente coincidencias verificadas de transacción, monto y pedido. Revisar diferencias o duplicados; una foto no acredita un pago.')
p.plan(388, 8, 'Cancelaciones y reembolsos',
       'Definir condiciones de devolución y habilitar su gestión en la tienda y en el medio de pago correspondiente.',
       'Comprobar elegibilidad y preparar la devolución. Ejecutarla automáticamente solo bajo reglas acordadas; elevar las excepciones.')
p.plan(560, 9, 'Reclamos legales',
       'Asignar un responsable del comercio y un circuito para reunir antecedentes, pedido y comunicaciones previas.',
       'La IA prepara el resumen y evita repetir preguntas. La evaluación, decisión y respuesta final quedan a cargo de la persona responsable.')
p.end()

# 09: Important findings from the original audit not silently omitted.
p.header('Calidad operativa', 'Ajustes que evitan\nnuevos silencios.', 'Propuestas adicionales basadas en las conversaciones y plantillas revisadas.')
quality = [
    ('Precios y envío con una fuente única', 'Unificar tarifas y su vigencia. En Eduardo aparecen $2.500 manuales y $1.990 en la regla; la auditoría no cambió arbitrariamente el costo.'),
    ('El pack debe salir del producto real', 'Las confirmaciones #1771 y #1775 cuentan mal el tratamiento cuando hay envío prioritario como artículo. Calcular por variante física, no por todas las líneas.'),
    ('Límites que permitan un acuse seguro', 'Separar montos de comprobantes de nuevas cotizaciones y revisar el límite de 20 burbujas. Mantener control de precios y volumen sin bloquear respuestas necesarias.'),
    ('Correo, formularios y comentarios', 'Convertir consultas de formularios en hilos del cliente; filtrar avisos internos, tratar críticas con una respuesta adecuada y reintentar fallos transitorios sin duplicar.'),
    ('Afirmaciones comerciales aprobadas', 'Revisar mensajes que prometen resultados individuales o plazos de crecimiento. Responder con el conocimiento aprobado y sin garantías que no estén verificadas.'),
]
for i, (title, body) in enumerate(quality):
    y = 216 + i * 110
    p.box(42, y, 511, 98)
    p.text(60, y + 25, title, 'Semi', 12)
    end = p.wrap(60, y + 48, body, 475, size=10.5, leading=15, color=MUTED)
    assert end <= y + 98 - 5
p.end()

# 10: Concrete work plan, no invented schedule or guaranteed uplift.
p.header('Plan de ejecución', 'Qué necesitamos.\nCómo se valida.', 'El alcance y el plazo de cada conexión dependen del sistema disponible y sus permisos.')
p.card(216, '1. Confirmar sistemas y políticas',
       'Revitaly identifica dónde verifica transferencias y dónde emite facturas. Acordamos condiciones de cambios, reposiciones y devoluciones, responsables y fuentes comerciales vigentes.', 120)
p.card(349, '2. Activar consultas antes de operaciones',
       'Riverz completa la lectura de pedidos, seguimiento e información comercial. Primero se prueba que la IA identifique el caso, consulte la fuente correcta y reciba los datos solicitados.', 120)
p.card(482, '3. Habilitar las acciones permitidas',
       'Se configuran cambios, reposiciones, facturas y devoluciones dentro de las reglas acordadas. Deben quedar registrados, evitar duplicados y permitir revisión de excepciones.', 120)
p.note(622, '4. Probar, publicar y medir',
       'Repetir casos reales, comprobar cambios ejecutados y verificar que no se silencie al cliente. Medir IA, intervención justificada y resolución con el mismo criterio.', 111)
p.wrap(42, 761, 'No se promete un porcentaje futuro de automatización antes de validar estas conexiones.', size=10.3, leading=15, color=MUTED)
p.end()

# 11: Methodology and appendix map.
p.header('Método y anexos', 'Cómo leer\neste informe.', 'Evidencia conservada y resultados referidos al corte del 30/09/2026, 12:04 Argentina.')
p.card(216, 'Cobertura y revisión',
       '2.098 hilos y 6.192 mensajes, del 24/06 al 30/09. Se realizaron 1.994 revisiones asistidas y 104 manuales, además de comprobar los casos señalados y sus referencias. Dos hilos tienen contenido eliminado.', 123)
p.card(352, 'Qué significa cada cifra',
       '559 consultas reales; además hay 1.145 notificaciones, 40 mensajes comerciales o spam, 325 hilos solo salientes y 27 vacíos. Los porcentajes cuentan hilos, no personas únicas ni pedidos resueltos.', 123)
p.card(488, 'Qué significa la revisión humana',
       '101 hilos históricos no tienen resolución visible; 36 son recientes. Puede existir una solución en otro canal. Un estado del hilo o una reserva de respuesta no demuestra que se haya enviado un mensaje.', 123)
p.box(42, 628, 511, 143, INK)
p.text(60, 658, 'Anexos de casos', 'Serif', 23, LIME)
p.wrap(60, 682, 'A. Los 135 escalamientos reales: motivo y acción propuesta.\nB. Los 10 bloqueos o derivaciones evitables.\nC. Las 53 conversaciones con respuesta insuficiente.', 475, size=10.6, leading=18, color=CARD)
for yy, destination in [(682, 'appendix-a'), (700, 'appendix-b'), (718, 'appendix-c')]:
    p.c.linkAbsolute('', destination, Rect=(60, H-yy-5, 535, H-yy+12), thickness=0)
p.wrap(60, 745, 'Los grupos pueden solaparse. Las propuestas no equivalen a cambios ya publicados.', 475, size=9.5, leading=14, color=LIME)
p.end()

# Detailed records: preserve every case, use original IDs, never truncate reasons.
def appendix_header(label, title, subtitle):
    p.header(label, title, subtitle, compact=True)

humans_sorted = sorted(HUMAN, key=lambda r: (
    not BY_ID[r['id']]['active_period'], not r['currentlyUnresolvedInThread'],
    -int(re.sub(r'\D', '', BY_ID[r['id']]['last_at'][:10]) or 0), r['id']))
appendix_header('Anexo A / Escalamientos', 'Escalamientos reales. Caso por caso.',
                'Los primeros 36 son recientes sin resolución visible. No son pendientes confirmados.')
p.c.bookmarkPage('appendix-a')
y = 186
for i, row in enumerate(humans_sorted, 1):
    recent = BY_ID[row['id']]['active_period']
    state = 'Sin resolución visible' if row['currentlyUnresolvedInThread'] else 'Sin acción humana actual identificada'
    meta = f"{CHANNELS.get(row['channel'], row['channel'])} | {'Reciente' if recent else 'Histórico'} | {state}\nHilo: {row['id']} | {CATEGORY[row['category']][0]}"
    why = ' '.join(event['reason'] for event in row['evidence'])
    action = CATEGORY[row['category']][2]
    next_y, height = p.record(y, f'A-{i:03}', row['name'], meta, why, action, row['id'])
    if next_y is None:
        p.end()
        appendix_header('Anexo A / Escalamientos', 'Escalamientos reales. Continuación.',
                        'Motivo histórico por hilo y acción propuesta. La revisión se refiere al corte de la auditoría.')
        y = 186
        next_y, height = p.record(y, f'A-{i:03}', row['name'], meta, why, action, row['id'])
    assert next_y is not None, (row['id'], height)
    y = next_y
p.end()

AVOID_ACTION = {
    'ocr_ui_as_intent': 'Publicado: distinguir el texto del cliente de los controles visibles en una captura.',
    'known_transfer_details': 'Publicado: enviar los datos bancarios de la regla vigente ante la solicitud.',
    'email_subject': 'Publicado: reconocer la consulta explícita en el asunto del correo.',
    'other_product_and_missing_lookup': 'Propuesto: aclarar la comparación e identificar el pedido antes de derivar.',
    'comment_afirma_lo_que_no_sabe': 'Propuesto: permitir una respuesta breve basada en información aprobada.',
    'derivacion_innecesaria': 'Propuesto: informar el proceso de seguimiento y verificar si existe una demora real.',
    'comment_spam_mal_clasificado': 'Propuesto: distinguir una crítica comercial de spam y responder de forma adecuada.',
    'premature_handoff': 'Propuesto: recoger los datos o ubicar la guía antes de suspender la conversación.',
    'clarify_before_change': 'Propuesto: confirmar si el cliente quiere modificar la entrega antes de derivar el cambio.',
}
avoid = [r for r in ROWS if r['premature']]
appendix_header('Anexo B / Evitables', 'Bloqueos y derivaciones evitables.',
                '10 hilos. Incluyen dos comentarios públicos filtrados; no todos fueron transferidos a una persona.')
p.c.bookmarkPage('appendix-b')
y = 186
for i, row in enumerate(avoid, 1):
    why = ' '.join(event['reason'] for event in row['premature'])
    action = ' '.join(dict.fromkeys(AVOID_ACTION[e['category']] for e in row['premature']))
    meta = f"{CHANNELS.get(row['channel'], row['channel'])} | Hilo: {row['id']}"
    next_y, height = p.record(y, f'B-{i:02}', row['name'], meta, why, action, 'avoidable-' + row['id'])
    if next_y is None:
        p.end()
        appendix_header('Anexo B / Evitables', 'Bloqueos evitables. Continuación.',
                        'Se distingue lo ya publicado de los ajustes propuestos para cada caso.')
        y = 186
        next_y, height = p.record(y, f'B-{i:02}', row['name'], meta, why, action, 'avoidable-' + row['id'])
    assert next_y is not None
    y = next_y
p.end()

def missed_action(row):
    cats = {e['category'] for e in row['missed_reply']}
    if 'known_transfer_details' in cats:
        return 'Publicado: respuesta directa con los datos bancarios de la regla vigente.'
    if 'email_subject' in cats:
        return 'Publicado: reconocer la consulta del asunto; completar los datos del pedido antes de derivar.'
    if any('disabled' in cat or cat == 'manual_pause' for cat in cats):
        return 'Revisar quién tomó el hilo y si hubo respuesta humana. Ajustar recopilación y avisos, sin reactivar indiscriminadamente conversaciones pausadas.'
    if any(cat in {'contact_form_no_trigger', 'historical_or_no_trigger', 'sin_agente'} for cat in cats):
        return 'Comprobar asignación y activación del canal; convertir formularios en consultas del cliente y evitar responder al remitente automático.'
    if any('comment' in cat or cat == 'public_comment_unanswered' for cat in cats):
        return 'Comprobar el motivo del filtro o del fallo de publicación; responder según la política y reintentar solo errores transitorios sin duplicar.'
    if any(cat in {'reply_burst_guard', 'stale_context'} for cat in cats):
        return 'Revisar límites y contexto reciente; permitir una respuesta segura sin repetir montos no verificados ni duplicar mensajes.'
    if any('block' in cat or 'bloqueo' in cat or 'billing' in cat for cat in cats):
        return 'Verificar el bloqueo operativo registrado y alertar al responsable. Confirmar que la ruta real de atención esté disponible antes de reintentar.'
    return 'Completar la consulta o búsqueda con la fuente autorizada; reunir los datos pendientes antes de pausar y revisar si ya se respondió por otro canal.'

missed = sorted((r for r in ROWS if r['missed_reply']), key=lambda r: (not r['current_human'], r['id']))
appendix_header('Anexo C / Respuestas', 'Respuestas omitidas o insuficientes.',
                '53 hilos recientes. Se incluyen demoras y respuestas incompletas; no todos prueban un fallo de IA.')
p.c.bookmarkPage('appendix-c')
y = 186
for i, row in enumerate(missed, 1):
    # Avoid leaving just one record on the final page of this appendix.
    on_page = sum(v['page'] == p.page and v['code'].startswith('C-') for v in p.case_pages.values())
    if i == len(missed)-1 and on_page >= 3:
        p.end()
        appendix_header('Anexo C / Respuestas', 'Respuestas insuficientes. Continuación.',
                        'Las acciones son propuestas salvo las correcciones de transferencia y asunto del correo.')
        y = 186
    why = ' '.join(event['reason'] for event in row['missed_reply'])
    meta = f"{CHANNELS.get(row['channel'], row['channel'])} | Hilo: {row['id']}"
    next_y, height = p.record(y, f'C-{i:02}', row['name'], meta, why, missed_action(row), 'missed-' + row['id'])
    if next_y is None:
        p.end()
        appendix_header('Anexo C / Respuestas', 'Respuestas insuficientes. Continuación.',
                        'Las acciones son propuestas salvo las correcciones de transferencia y asunto del correo.')
        y = 186
        next_y, height = p.record(y, f'C-{i:02}', row['name'], meta, why, missed_action(row), 'missed-' + row['id'])
    assert next_y is not None
    y = next_y
p.end()
p.finish()

# Reopen, verify coverage and geometry, render every page and make QA contact sheets.
doc = pymupdf.open(OUT)
assert len(doc) == p.page
assert len(doc.get_toc()) == 14
annex_navigation = [link.get('page') for link in doc[10].get_links()]
assert annex_navigation == ['12', '46', '49']
all_text = '\n'.join(page.get_text() for page in doc)
for row in HUMAN:
    assert row['id'] in all_text
for i in range(1, 136):
    assert f'A-{i:03}' in all_text
for i in range(1, 11):
    assert f'B-{i:02}' in all_text
for i in range(1, 54):
    assert f'C-{i:02}' in all_text
assert '\ufffd' not in all_text
bad_bounds = []
for i, page in enumerate(doc, 1):
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                x0, y0, x1, y1 = span['bbox']
                if x0 < 29 or x1 > W-29 or y0 < 15 or y1 > H-12:
                    bad_bounds.append((i, span['text'], span['bbox']))
    page.get_pixmap(matrix=pymupdf.Matrix(1.35, 1.35)).save(str(QA / f'final-{i:02}.png'))
assert not bad_bounds, bad_bounds
thumb_w, thumb_h = 298, 422
for start in range(0, len(doc), 8):
    sheet = Image.new('RGB', (4*(thumb_w+12)+12, 2*(thumb_h+30)+12), '#d8d5cf')
    draw = ImageDraw.Draw(sheet)
    for j in range(min(8, len(doc)-start)):
        im = Image.open(QA / f'final-{start+j+1:02}.png').convert('RGB')
        im.thumbnail((thumb_w, thumb_h))
        x, y = 12+(j%4)*(thumb_w+12), 12+(j//4)*(thumb_h+30)
        sheet.paste(im, (x,y))
        draw.text((x,y+thumb_h+3), f'Página {start+j+1}', fill='#12201f')
    sheet.save(QA / f'contact-{start//8+1:02}.png')
proof = {'file': str(OUT), 'pages': len(doc), 'historicalEscalations': 135,
         'recentWithoutVisibleResolution': 36, 'avoidableCases': 10,
         'insufficientReplyCases': 53, 'outOfPageTextSpans': bad_bounds,
         'annexNavigationPages': annex_navigation,
         'sections': p.sections, 'casePages': p.case_pages}
(QA / 'validation.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
doc.close()
print(json.dumps({k:v for k,v in proof.items() if k not in {'sections','casePages'}}, ensure_ascii=False))
