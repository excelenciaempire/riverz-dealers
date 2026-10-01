"""Build the four-page Riverz client summary from the preserved Revitaly audit.

Run from the repo: py -X utf8 scripts/build-revitaly-audit-pdf.py
Requires reportlab and PyMuPDF. Source customer records remain in ignored output/.
"""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import json
import re
import unicodedata
from io import BytesIO
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

metrics, historical_cases = read('metrics'), read('escalamientos')
source = read('source')
reviewed = read('reviewed-conversations')
assert source['capturedAt'] == metrics['capturedAt']
assert metrics['all']['total'] == 2098
assert metrics['customer_service']['total'] == 559
assert (metrics['all']['missed_reply'], metrics['all']['premature']) == (53, 10)
assert len(historical_cases) == 135

# The user selected September 26-30. Use local Argentine calendar days, not
# the old all-history totals or the prior audit's UTC-midnight denominator.
START = datetime(2026, 9, 26, 3, tzinfo=timezone.utc)
END = datetime.fromisoformat(source['capturedAt'].replace('Z', '+00:00'))
period_messages = [m for m in source['messages']
                   if START <= datetime.fromisoformat(m['created_at']) <= END]
active_ids = {m['conversation_id'] for m in period_messages}
incoming_ids = {m['conversation_id'] for m in period_messages if m['sender_type'] == 'customer'}
customer_ids = {c['id'] for c in reviewed if c['kind'] == 'customer_service' and c['id'] in incoming_ids}
period_message_ids = {m['id'] for m in period_messages}
cases = [{**c, 'periodEvidence': [e for e in c['evidence'] if e['message_id'] in period_message_ids]}
         for c in historical_cases if c['id'] in customer_ids
         and any(e['message_id'] in period_message_ids for e in c['evidence'])]
assert (len(active_ids), len(incoming_ids), len(customer_ids), len(cases)) == (425, 345, 199, 43)
assert sum(metrics['kinds'].values()) == len(source['conversations'])
human_rate = 100 * len(cases) / len(customer_ids)
inbox_rate = 100 * len(cases) / len(active_ids)
# Meta inserts an explanatory comment card as sender=agent. It is channel UI,
# not a human answer; retain the audit's distinction when counting automation.
def channel_notice(message):
    return message['origin'] is None and bool(re.fullmatch(
        r'Estás respondiendo el comentario de un usuario en una publicación de tu página\. Ver comentario\(https://facebook\.com/[^\s]+\)',
        (message['content_text'] or '').strip()))

successful_responses = [m for m in period_messages
                        if m['sender_type'] in {'agent', 'bot'}
                        and m['status'] in {'sent', 'delivered', 'read'}
                        and not channel_notice(m)]
ai_answered_ids = {m['conversation_id'] for m in successful_responses
                   if m['origin'] in {'ai_agent', 'comment_ai'}} & customer_ids
human_answered_ids = {m['conversation_id'] for m in successful_responses
                      if m['sender_type'] == 'agent'
                      and m['origin'] not in {'ai_agent', 'comment_ai', 'automation'}} & customer_ids
automated_ids = ai_answered_ids - human_answered_ids
assert (len(ai_answered_ids), len(human_answered_ids), len(automated_ids)) == (151, 27, 133)
assert automated_ids == {c['id'] for c in reviewed if c['id'] in customer_ids
                          and c['has_ai_period'] and not c['has_human_period']}
automation_rate = 100 * len(automated_ids) / len(customer_ids)
response_issues = sum(any(e.get('message_id') in period_message_ids for e in c['missed_reply']) for c in reviewed)
avoidable_blocks = sum(any(e.get('message_id') in period_message_ids for e in c['premature']) for c in reviewed)
assert (response_issues, avoidable_blocks) == (50, 10)
# Count readable incoming comments separately from deleted platform records.
# Replies can be saved as either text or comment; the social thread channel
# and origin establish which inbox they belong to. A reply is not a resolution.
conversation_by_id = {c['id']: c for c in source['conversations']}
comment_messages = [m for m in period_messages
                    if conversation_by_id[m['conversation_id']]['channel'] in {'fb_comment', 'ig_comment'}
                    and m['sender_type'] == 'customer'
                    and (m['content_text'] or '').strip() not in {'', '[deleted]'}]
comment_ids = {m['conversation_id'] for m in comment_messages}
comment_channels = Counter(conversation_by_id[m['conversation_id']]['channel'] for m in comment_messages)
comment_ai_ids = {m['conversation_id'] for m in successful_responses
                  if m['origin'] == 'comment_ai'} & comment_ids
comment_human_ids = human_answered_ids & comment_ids
comment_unanswered_ids = comment_ids - comment_ai_ids - comment_human_ids
assert (len(comment_messages), len(comment_ids), len(comment_ai_ids),
        len(comment_human_ids), len(comment_unanswered_ids)) == (38, 34, 22, 1, 11)
assert comment_channels == Counter({'fb_comment': 33, 'ig_comment': 5})
# One primary topic per readable inbound comment; mixed purchase/skepticism
# comments are classified by their actionable buying question.
purchase_comment_ids = {
    '33d7eb69-0468-4f05-ad4b-6af93de6f1fb', '32abbfcc-a656-4c1c-bc83-29aefa1b1616',
    'e3df36a6-f297-4b7d-a500-ab45006e80fb', '718c271a-b736-4cbf-99df-e3329c4dcae8',
    '460c770f-e801-4063-ac40-07cbb6e7b561', 'ffdf5ab3-1f06-4e72-8ca3-880c0564d5b9',
    '30846626-d40a-4b38-a31c-17c78839274c', 'adc8d481-6318-4805-9fc3-49b2e46b1c99',
    '09fb1f91-23cb-4945-82db-00d4b59a0cc5', '69522e80-ea45-4737-aa1f-73c65a995cd1',
}
delivery_comment_ids = {
    'a539805c-9884-47c7-b1b0-23a0ed449172', '513440fe-1fb4-464b-84c2-7ce0acd24c58',
}
assert (purchase_comment_ids | delivery_comment_ids) <= {m['id'] for m in comment_messages}
comment_topics = Counter('compra_uso' if m['id'] in purchase_comment_ids else
                         'entrega' if m['id'] in delivery_comment_ids else 'publicidad'
                         for m in comment_messages)
assert comment_topics == Counter({'publicidad': 26, 'compra_uso': 10, 'entrega': 2})
period_comment_logs = [r for r in source['replies']
                       if r['conversation_id'] in comment_unanswered_ids
                       and START <= datetime.fromisoformat(r['created_at']) <= END]
comment_block_groups = {
    name: {r['conversation_id'] for r in period_comment_logs if r['skip_reason'] in reasons}
    for name, reasons in {
        'saldo': {'comment_sin_saldo'},
        'error': {'comment_error', 'comment_no_se_pudo_publicar'},
        'filtro': {'comment_afirma_lo_que_no_sabe', 'comment_spam'},
    }.items()
}
assert [len(comment_block_groups[k]) for k in ['saldo', 'error', 'filtro']] == [5, 4, 2]
assert set.union(*comment_block_groups.values()) == comment_unanswered_ids
hidden_unanswered_comments = sum(conversation_by_id[i]['last_message_hidden'] for i in comment_unanswered_ids)
assert hidden_unanswered_comments == 7
rate = lambda value: f'{value:.1f}%'.replace('.', ',')

# Read all 38 source comments. Assign one primary tone; sarcasm without a
# clear judgment remains ambiguous. Tone is not product satisfaction.
ambiguous_comment_ids = {
    '1fcd661f-e315-4506-81e0-6a1a748e1faa', '06a44601-353f-486a-a85f-8e034bf8153e',
    'ec90aaef-4c42-4a44-a97f-373161d9a9fe', '97806e39-dfa0-4e25-84b1-e4dd5441e311',
    'a3f5ad76-2ddc-427c-9571-bce23c83d3a8', '4b8dc1ac-5c7d-4288-ad80-52577b6df2e7',
    'dbc2ea4c-25a6-4c88-a366-a5eed858ca6b', 'acaff299-461d-449e-a2da-6a86a15733ed',
}
interest_comment_ids = {'33d7eb69-0468-4f05-ad4b-6af93de6f1fb', 'de16a9ea-a32b-48ba-b3a6-3c628d62977b'}
neutral_comment_ids = purchase_comment_ids - interest_comment_ids
negative_comment_ids = {m['id'] for m in comment_messages} - ambiguous_comment_ids - interest_comment_ids - neutral_comment_ids
sentiment_groups = [
    ('Crítica o frustración', negative_comment_ids, '#B87360'),
    ('Consulta neutral', neutral_comment_ids, '#7D938B'),
    ('Humor o tono ambiguo', ambiguous_comment_ids, '#CAB795'),
    ('Interés o elogio', interest_comment_ids, '#B8CB69'),
]
assert [len(ids) for _, ids, _ in sentiment_groups] == [19, 9, 8, 2]
assert sum(len(ids) for _, ids, _ in sentiment_groups) == len(comment_messages)
assert all(a.isdisjoint(b) for i, (_, a, _) in enumerate(sentiment_groups)
           for _, b, _ in sentiment_groups[i+1:])
recovery = read('comment-recovery')
recovered_comments = {r['inboundId'] for r in recovery['evidence'] if r['outcome'] == 'sent_verified'}
assert len(recovered_comments) == 5
assert len(recovered_comments & {m['id'] for m in comment_messages if m['conversation_id'] in comment_block_groups['error']}) == 4
remaining_visibility = read('remaining-comment-visibility')['evidence']
assert len(remaining_visibility) == 6 and all(r['http'] == 200 and r['hidden'] is True for r in remaining_visibility)

def sentiment_image():
    """Generate a sharp chart image from the classified source comments."""
    QA.mkdir(parents=True, exist_ok=True)
    stream = BytesIO()
    chart = canvas.Canvas(stream, pagesize=(150, 150))
    chart.setFillColor(CARD)
    chart.rect(0, 0, 150, 150, fill=1, stroke=0)
    angle = 90
    for _, ids, color in sentiment_groups:
        extent = 360 * len(ids) / len(comment_messages)
        chart.setStrokeColor(HexColor(color))
        chart.setLineWidth(21)
        chart.arc(18, 18, 132, 132, angle-extent, extent)
        angle -= extent
    chart.save()
    chart_doc = pymupdf.open(stream=stream.getvalue(), filetype='pdf')
    path = QA / 'sentimiento-comentarios.png'
    chart_doc[0].get_pixmap(matrix=pymupdf.Matrix(4, 4)).save(str(path))
    chart_doc.close()
    return path

REASONS = [
    ('Demora o disputa de entrega', 'Entregas demoradas o disputadas', 15,
     'Reclamaron pedidos que no llegaron, falta de guía y demoras de despacho. Un pedido figuraba enviado, pero Andreani no lo registraba.'),
    ('Dato o decisión no verificada', 'Información o decisión comercial', 10,
     'Hubo consultas sobre descuentos, stock, uso del producto, puntos de retiro y propuestas de canje que la IA no pudo confirmar.'),
    ('Cancelación o reembolso', 'Cancelaciones y reembolsos', 5,
     'Pidieron cancelar o recuperar dinero por pedidos sin envío y direcciones incorrectas. Algunos insistieron tras ser enviados a WhatsApp.'),
    ('Acreditación o cobro', 'Pagos y cobros por verificar', 5,
     'Enviaron comprobantes de transferencia y hubo una tarjeta cobrada sin compra localizable. La IA no podía confirmar la acreditación.'),
    ('Producto dañado, distinto o faltante', 'Productos dañados o faltantes', 4,
     'Reclamaron menos unidades que las compradas, un envase rajado con pérdida y un reenvío prometido que no podían localizar.'),
    ('Cambio de dirección, entrega o datos', 'Cambios de pedido o dirección', 3,
     'Pidieron pasar de retiro en Punto Andreani a entrega a domicilio. Un pedido ya estaba en sucursal y la IA no podía modificarlo.'),
    ('Reclamo legal', 'Reclamos legales', 1,
     'Tras insistir por una dirección incorrecta y no recibir respuesta por WhatsApp, un cliente sospechó una estafa y mencionó acudir a la justicia.'),
]
assert Counter(c['category'] for c in cases) == Counter({r[0]: r[2] for r in REASONS})

def clean(value):
    return unicodedata.normalize('NFC', str(value)).replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')

class PDF:
    def __init__(self):
        OUT.parent.mkdir(parents=True, exist_ok=True)
        QA.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
        self.c.setTitle('Revitaly | Reporte de atención y plan de acción | Riverz')
        self.c.setAuthor('Riverz')
        self.c.setSubject('Análisis de conversaciones y escalamientos del 26 al 30 de septiembre de 2026 y plan de acción')
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

    def image(self, path, x, y, width, height):
        self.c.drawImage(str(path), x, H-y-height, width=width, height=height,
                         preserveAspectRatio=True, anchor='c', mask='auto')

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

    def proposal(self, y, number, title, body, height=94):
        self.box(42, y, 511, height)
        self.box(60, y+10, 25, 25, LIME, 8)
        self.text(68, y+28, str(number), 'Semi', 12.5)
        self.text(97, y+28, title, 'Semi', 15, width=438)
        end = self.wrap(60, y+49, body, 475)
        assert end-18+4 <= y+height-5, (self.page, title, end, y+height)

p = PDF()

# 1. All attention rates use customer consultations as their denominator.
p.header('Revitaly. Reporte de atención.', '26 al 30 de septiembre de 2026, hasta las 12:04 de Argentina.')
p.text(42, 179, 'Atención al cliente', 'Serif', 27)
for i, (value, percentage, label, detail) in enumerate([
    (len(customer_ids), '100%', 'Conversaciones con consultas', 'Base de los porcentajes'),
    (len(automated_ids), rate(automation_rate), 'Automatizadas: respondidas solo por IA', 'Sin respuesta humana registrada en el período'),
    (len(cases), rate(human_rate), 'Escalamientos justificados', 'Casos que necesitaron intervención humana'),
]):
    y = 205+i*176
    p.box(42, y, 511, 157, PALE if i == 1 else CARD)
    p.text(62, y+101, str(value), 'Serif', 64, width=140)
    end = p.wrap(225, y+43, label, 304, size=18, leading=22, font='Semi')
    assert end <= y+89
    p.text(225, y+101, percentage, 'Semi', 30, width=230)
    p.text(225, y+133, detail, 'Sans', 12.5, width=304)
end = p.wrap(42, 754, 'Hubo 425 hilos con actividad, incluidos avisos y mensajes salientes. Las 199 conversaciones con consultas son la base de estos porcentajes.', size=13, leading=17)
assert end-18+4 <= 791
p.end()

# 2. The complete escalation analysis, grouped instead of listing customers.
p.header('Por qué se escala a humano', 'Lo ocurrido en 43 casos del 26 al 30 de septiembre.')
for i, (category, title, count, why) in enumerate(REASONS):
    y = 174+i*84
    p.box(42, y, 511, 76, CARD, 11)
    p.text(60, y+22, title, 'Semi', 15, width=443)
    p.text(520, y+24, str(count), 'Serif', 25)
    end = p.wrap(60, y+44, why, 475, leading=17)
    assert end-17+4 <= y+76-5, (title, end, y+76)
p.wrap(42, 791, 'Casos del período; no todos siguen pendientes y puede haber reclamos repetidos.', size=12.5)
p.end()

# 3. Six concrete customer-facing capabilities, covering all eight reasons.
p.header('Plan de acción', 'Qué puede resolver Riverz y cómo habilitarlo.')
plan = [
    ('Editar direcciones de pedidos',
     'Sí, antes del despacho. Habilitar a la IA para actualizar Shopify tras confirmar la dirección con el cliente. Una vez despachado, no se modifica la dirección.'),
    ('Seguimiento y avisos de demora',
     'Sí, con seguimiento real de Andreani. Riverz informa el estado y avisa demoras. Si el cliente niega la entrega, logística debe investigar.'),
    ('Resolver faltantes y daños',
     'Parcialmente. Riverz reúne fotos y registra el reclamo. Para preparar un reemplazo en Shopify, hay que habilitar el flujo y acordar la política; el despacho queda en logística.'),
    ('Verificar transferencias y cobros',
     'Puede automatizarse al conectar el banco o la billetera. Riverz compara el dinero recibido con el pedido; las diferencias o los cobros sin compra identificada pasan al equipo.'),
    ('Cancelar pedidos y devolver dinero',
     'Parcialmente: al habilitar la gestión, Riverz prepara pedido, monto y motivo. Una persona aprueba la cancelación o el reembolso; la IA no devuelve dinero por su cuenta.'),
    ('Responder con datos verificados',
     'Sí, habilitando la consulta de precios, stock y cupones en Shopify. Riverz explica por qué un código no aplica y deriva excepciones comerciales con un resumen. Los reclamos legales los decide una persona.'),
]
for i, (title, body) in enumerate(plan):
    p.proposal(184+i*98, i+1, title, body)
p.text(42, 786, 'Probar cada acción con casos reales antes de activarla.', size=12.5)
p.end()

# 4. All comment content belongs on this last page. No recovery/incident block.
p.header('Análisis de comentarios', '26 al 30 de septiembre, hasta las 12:04 de Argentina.')
p.image(ASSETS / 'riverz-control-humano.png', 42, 174, 135, 80)
p.text(197, 192, '38 comentarios con texto, en 34 hilos.', 'Semi', 14, width=356)
p.text(197, 216, '33 en Facebook y 5 en Instagram.', width=356)
p.text(197, 240, '22 hilos con respuesta de IA y 1 humana.', width=356)
p.text(42, 279, 'Sentimiento', 'Serif', 25)
p.box(42, 294, 511, 154)
p.image(sentiment_image(), 57, 303, 135, 135)
p.text(108, 379, '38', 'Serif', 32, width=58)
for i, (label, ids, color) in enumerate(sentiment_groups):
    y = 323+i*34
    p.box(232, y-10, 10, 10, HexColor(color), 3)
    p.text(252, y, label, 'Sans', 13, width=202)
    p.text(473, y, f'{len(ids)} · {round(100*len(ids)/38)}%', 'Semi', 13, width=66)
end = p.wrap(42, 472, 'Las críticas se concentran en la publicidad y su credibilidad. El tono no mide satisfacción tras usar el producto; las bromas ambiguas se clasifican aparte.', leading=17)
assert end <= 529
comment_analysis = [
    ('26 · Publicidad', 'Cuestionaron anuncios hechos con IA y promesas de crecimiento. Hubo ironías y acusaciones de engaño.'),
    ('10 · Compra y uso', 'Consultaron precio, farmacias, pago contra entrega y uso en mujeres. También preguntaron por grasa y foliculitis.'),
    ('2 · Entregas', 'Dos compradores esperaban 7 y 20 días. Uno mencionó una promesa de entrega en 24 horas.'),
]
for i, (title, body) in enumerate(comment_analysis):
    x, y = 42+i*173, 535
    p.box(x, y, 165, 159)
    p.text(x+12, y+25, title, 'Semi', 14, width=141)
    end = p.wrap(x+12, y+49, body, 141, leading=17)
    assert end-17+4 <= y+159-6, (title, end)
p.text(42, 727, 'Cómo respondió la IA', 'Serif', 25)
end = p.wrap(42, 749, 'Respondió precios y canales de compra, pero algunas respuestas fueron genéricas o solo anunciaron un privado. Conviene resolver dudas en público y llevar pedidos y datos personales a privado.', leading=17)
assert end-17+4 <= 791
p.end()
p.c.save()

# Validate the brief's scope, pagination, readable text and page geometry.
doc = pymupdf.open(OUT)
assert len(doc) == p.page == 4
assert len(doc.get_toc()) == 4
text = '\n'.join(page.get_text() for page in doc)
normalized_text = re.sub(r'\s+', ' ', text)
assert all(token in normalized_text for token in ['425', '199', '43', '133', '21,6%', '66,8%', '26 al 30 de septiembre', 'Por qué se escala a humano', 'Plan de acción', 'Editar direcciones', 'preparar un reemplazo en Shopify', 'Una vez despachado, no se modifica la dirección.', 'Análisis de comentarios', '38 comentarios con texto', '34 hilos'])
assert all(removed not in normalized_text for removed in ['Sin motivo de escalamiento', 'Sin escalamiento identificado', '78,4%', '10,1%', 'Qué ocurrió'])
assert all(token in normalized_text for token in ['Sentimiento', '26 · Publicidad', '10 · Compra y uso', '2 · Entregas', 'Cómo respondió la IA', 'no mide satisfacción'])
assert all(token not in normalized_text for token in ['5 respuestas recuperadas', 'Corregido el envío', 'Recuperación automática', 'Al corte: 11', 'sin respuesta al corte', 'recuperados después'])
assert 'comentari' not in doc[0].get_text().lower()
assert all('Análisis de comentarios' not in page.get_text() for page in list(doc)[:-1])
assert 'Análisis de comentarios' in doc[-1].get_text()
assert all(token in normalized_text for token in ['Parcialmente', 'Puede automatizarse al conectar el banco', 'Una persona aprueba la cancelación o el reembolso', 'la IA no devuelve dinero por su cuenta'])
assert all(token in normalized_text for token in ['consultas sobre descuentos', 'envase rajado con pérdida', 'IA no podía modificarlo', 'foliculitis'])
assert 'CARRITO25' not in normalized_text
assert 'Por qué se necesita al equipo' not in text and 'pedir el cambio al transportista' not in text
assert all(removed not in normalized_text for removed in ['mejoras', 'Mejoras', 'Validado en producción', 'RESULTADOS', 'ESCALAMIENTOS REALES', 'PLAN PROPUESTO', 'GUÍA DE CAPACIDADES', 'riverz.co |', '135 casos', '2.098', '24,2%'])
assert '66,2%' not in text and '21,1%' not in text
assert round(human_rate, 1) == 21.6 and round(inbox_rate, 1) == 10.1
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
proof = {'file': str(OUT), 'pages': len(doc), 'periodEscalations': len(cases),
         'dataCapturedAt': source['capturedAt'], 'periodStartUTC': START.isoformat(),
         'timezone': 'America/Argentina/Buenos_Aires', 'activeConversations': len(active_ids),
         'receivedConversations': len(incoming_ids), 'customerConversations': len(customer_ids),
         'AIAnsweredConversations': len(ai_answered_ids), 'humanAnsweredConversations': len(human_answered_ids),
         'AIOnlyConversations': len(automated_ids), 'AIOnlyPercent': round(automation_rate, 1),
         'excludedChannelNotices': sum(channel_notice(m) for m in period_messages if m['conversation_id'] in customer_ids),
         'genuineInterventionDenominator': len(customer_ids),
         'responseIssueConversations': response_issues, 'avoidableBlockConversations': avoidable_blocks,
         'genuineInterventionInboxPercent': round(inbox_rate, 1),
         'genuineInterventionPercent': round(human_rate, 1), 'proposedCapabilities': len(plan),
         'readableIncomingComments': len(comment_messages), 'incomingCommentThreads': len(comment_ids),
         'AIAnsweredCommentThreads': len(comment_ai_ids), 'humanAnsweredCommentThreads': len(comment_human_ids),
         'unansweredCommentThreadsAtCutoff': len(comment_unanswered_ids), 'commentChannelCounts': dict(comment_channels),
         'commentTopics': dict(comment_topics), 'unansweredCommentCauses': {k: len(v) for k, v in comment_block_groups.items()},
         'commentTone': {label: {'count': len(ids), 'percent': round(100*len(ids)/38, 1), 'messageIds': sorted(ids)} for label, ids, _ in sentiment_groups},
         'recoveredCommentsAfterCutoff': len(recovered_comments), 'recoveryVerifiedAt': recovery['capturedAt'],
         'remainingUnansweredThreadsVerifiedHidden': len(remaining_visibility),
         'embeddedImages': sum(len(page.get_images()) for page in doc),
         'hiddenUnansweredCommentThreads': hidden_unanswered_comments,
         'escalationCategories': len(REASONS), 'individualCasesListed': False, 'appendices': False,
         'bodyFontPoints': 13, 'minimumSupportingTextPoints': 12.5,
         'undersizedBodyText': small_body,
         'outOfPageTextSpans': bad_bounds, 'bytes': OUT.stat().st_size}
(QA / 'validation.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
doc.close()
print(json.dumps(proof, ensure_ascii=False))
