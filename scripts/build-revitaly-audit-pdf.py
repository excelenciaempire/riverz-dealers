"""Build the three-page Riverz client summary from the preserved Revitaly audit.

Run from the repo: py -X utf8 scripts/build-revitaly-audit-pdf.py
Requires reportlab and PyMuPDF. Source customer records remain in ignored output/.
"""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
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
rate = lambda value: f'{value:.1f}%'.replace('.', ',')

REASONS = [
    ('Demora o disputa de entrega', 'Entregas demoradas o disputadas', 15,
     'Reclamaron pedidos que no llegaron, falta de guía y demoras de despacho. Un pedido figuraba enviado, pero Andreani no lo registraba.'),
    ('Dato o decisión no verificada', 'Información o decisión comercial', 10,
     'CARRITO25 no funcionó y la web mostró falta de stock. Hubo dudas sobre el producto, puntos de retiro y propuestas de canje.'),
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
for x, value, percentage, label, detail in [
    (42, str(len(customer_ids)), '100%', 'Conversaciones con\nconsultas', 'Base de los porcentajes'),
    (304, str(len(cases)), rate(human_rate), 'Escalamientos\njustificados', 'Necesitaron intervención'),
]:
    p.box(x, 182, 249, 138, PALE if x == 42 else CARD)
    p.text(x+17, 226, value, 'Serif', 42, width=145)
    p.text(x+164, 223, percentage, 'Semi', 20, width=68)
    end = p.wrap(x+17, 262, label, 215, size=15, leading=19, font='Semi')
    assert end <= 300
    p.text(x+17, 307, detail, width=215)
end = p.wrap(42, 352, 'Hubo 425 hilos con actividad, incluidos avisos y mensajes salientes. Las 199 conversaciones con consultas son la base de los porcentajes de atención.')
assert end-18+4 < 411
p.text(42, 422, 'Atención al cliente', 'Serif', 27)
p.box(42, 448, 511, 144)
for i, (label, count, percentage) in enumerate([
    ('Conversaciones con consultas', len(customer_ids), '100%'),
    ('Automatizadas: respondidas solo por IA', len(automated_ids), rate(automation_rate)),
    ('Con escalamiento justificado', len(cases), rate(human_rate)),
]):
    baseline = 478+i*48
    p.text(60, baseline, label, 'Sans', 13, width=355)
    p.text(436, baseline, str(count), 'Semi', 14, width=35)
    p.text(485, baseline, percentage, 'Semi', 14, width=51)
    if i < 2:
        p.line(496+i*48)
p.text(42, 633, 'Análisis de comentarios', 'Serif', 27)
end = p.wrap(42, 664, '38 comentarios con texto: 33 en Facebook y 5 en Instagram, en 34 hilos. En 22 respondió la IA y en 1 una persona; 11 no tenían respuesta al corte.')
assert end <= 720
end = p.wrap(42, 736, 'Hubo consultas de precio y uso, reclamos de entrega y críticas a la publicidad. Algunas se frenaron por saldo o fallos; otras recibieron solo «Te escribí por privado».')
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
    ('Responder más y escalar mejor',
     'Sí, con información vigente y recibiendo datos antes de pausar. Riverz responde precios, stock y guías; resume las excepciones comerciales y los reclamos legales, que decide el equipo.'),
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
assert all(token in normalized_text for token in ['425', '199', '43', '133', '21,6%', '66,8%', '26 al 30 de septiembre', 'Por qué se escala a humano', 'Plan de acción', 'Editar direcciones', 'preparar un reemplazo en Shopify', 'Una vez despachado, no se modifica la dirección.', 'Análisis de comentarios', '38 comentarios con texto', '34 hilos', '11 no tenían respuesta al corte'])
assert all(removed not in normalized_text for removed in ['Sin motivo de escalamiento', 'Sin escalamiento identificado', '78,4%', '10,1%', 'Qué ocurrió'])
assert all(token in normalized_text for token in ['Parcialmente', 'Puede automatizarse al conectar el banco', 'Una persona aprueba la cancelación o el reembolso', 'la IA no devuelve dinero por su cuenta'])
assert all(token in normalized_text for token in ['CARRITO25 no funcionó', 'envase rajado con pérdida', 'IA no podía modificarlo'])
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
         'escalationCategories': len(REASONS), 'individualCasesListed': False, 'appendices': False,
         'bodyFontPoints': 13, 'minimumSupportingTextPoints': 12.5,
         'undersizedBodyText': small_body,
         'outOfPageTextSpans': bad_bounds, 'bytes': OUT.stat().st_size}
(QA / 'validation.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
doc.close()
print(json.dumps(proof, ensure_ascii=False))
