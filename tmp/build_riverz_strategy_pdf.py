from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.colors import HexColor
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'output', 'pdf', 'riverz_estrategia_comercial_accionable.pdf')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

NAVY = HexColor('#071A2B')
BLUE = HexColor('#1167B1')
CYAN = HexColor('#31C5D2')
INK = HexColor('#12212F')
MUTED = HexColor('#516170')
PALE = HexColor('#EDF5F8')
LINE = HexColor('#D7E4EA')
WHITE = colors.white
GREEN = HexColor('#17A673')
AMBER = HexColor('#C47E10')

font_regular = 'Helvetica'
font_bold = 'Helvetica-Bold'

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name='CoverEyebrow', fontName=font_bold, fontSize=10, leading=13,
    textColor=CYAN, spaceAfter=14, uppercase=True, tracking=1.2
))
styles.add(ParagraphStyle(
    name='CoverTitle', fontName=font_bold, fontSize=30, leading=34,
    textColor=WHITE, spaceAfter=16
))
styles.add(ParagraphStyle(
    name='CoverLead', fontName=font_regular, fontSize=13, leading=19,
    textColor=HexColor('#D5E6EE'), spaceAfter=20
))
styles.add(ParagraphStyle(
    name='H1R', fontName=font_bold, fontSize=21, leading=25,
    textColor=NAVY, spaceBefore=3, spaceAfter=10
))
styles.add(ParagraphStyle(
    name='H2R', fontName=font_bold, fontSize=13, leading=17,
    textColor=BLUE, spaceBefore=13, spaceAfter=6
))
styles.add(ParagraphStyle(
    name='BodyR', fontName=font_regular, fontSize=9.5, leading=14,
    textColor=INK, spaceAfter=7
))
styles.add(ParagraphStyle(
    name='SmallR', fontName=font_regular, fontSize=8, leading=11,
    textColor=MUTED, spaceAfter=5
))
styles.add(ParagraphStyle(
    name='QuoteR', fontName=font_bold, fontSize=13, leading=18,
    textColor=NAVY, leftIndent=12, rightIndent=12, spaceBefore=8, spaceAfter=11
))
styles.add(ParagraphStyle(
    name='CalloutR', fontName=font_bold, fontSize=10.5, leading=15,
    textColor=NAVY, spaceAfter=0
))
styles.add(ParagraphStyle(
    name='TableR', fontName=font_regular, fontSize=8.4, leading=11, textColor=INK
))
styles.add(ParagraphStyle(
    name='TableHeadR', fontName=font_bold, fontSize=8.4, leading=11, textColor=WHITE
))

def P(text, style='BodyR'):
    return Paragraph(text, styles[style])

def bullet(text):
    return Paragraph('• ' + text, ParagraphStyle(
        'BulletR', parent=styles['BodyR'], leftIndent=13, firstLineIndent=-9, spaceAfter=4
    ))

def section(title, subtitle=None):
    out = [P(title, 'H1R')]
    if subtitle:
        out.append(P(subtitle, 'SmallR'))
    out.append(HRFlowable(width='100%', thickness=1, color=LINE, spaceAfter=9))
    return out

def callout(text, accent=CYAN):
    box = Table([[P(text, 'CalloutR')]], colWidths=[16.7*cm])
    box.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), PALE),
        ('BOX', (0,0), (-1,-1), 0.6, LINE),
        ('LINEBEFORE', (0,0), (0,-1), 4, accent),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ]))
    return box

def table(headers, rows, widths):
    data = [[P(h, 'TableHeadR') for h in headers]] + [[P(c, 'TableR') for c in row] for row in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('TEXTCOLOR', (0,0), (-1,0), WHITE),
        ('GRID', (0,0), (-1,-1), 0.35, LINE),
        ('BACKGROUND', (0,1), (-1,-1), WHITE),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 7),
        ('RIGHTPADDING', (0,0), (-1,-1), 7),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    return t

def footer(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(1.6*cm, 1.25*cm, A4[0]-1.6*cm, 1.25*cm)
    canvas.setFillColor(MUTED)
    canvas.setFont(font_regular, 7.5)
    canvas.drawString(1.6*cm, 0.82*cm, 'RIVERZ  |  Estrategia comercial para e-commerce')
    canvas.drawRightString(A4[0]-1.6*cm, 0.82*cm, f'{page}')
    canvas.restoreState()

class StrategyDoc(BaseDocTemplate):
    pass

doc = StrategyDoc(
    OUT, pagesize=A4,
    leftMargin=1.6*cm, rightMargin=1.6*cm, topMargin=1.5*cm, bottomMargin=1.65*cm,
    title='Riverz - Estrategia comercial accionable', author='Riverz'
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='body')
doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=footer)])

story = []

# Cover
cover = Table([[P('ESTRATEGIA COMERCIAL ACCIONABLE', 'CoverEyebrow')],
               [P('Riverz: la IA que opera las ventas de tu e-commerce', 'CoverTitle')],
               [P('Posicionamiento, oferta, adquisición, pricing y fulfillment para instalar sin costo y cobrar cuando el cliente ya ve Riverz trabajando.', 'CoverLead')],
               [P('Documento de ejecución - Agosto 2026', 'SmallR')]],
              colWidths=[16.7*cm])
cover.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), NAVY),
    ('LEFTPADDING', (0,0), (-1,-1), 22), ('RIGHTPADDING', (0,0), (-1,-1), 22),
    ('TOPPADDING', (0,0), (-1,0), 36), ('TOPPADDING', (0,1), (-1,1), 4),
    ('TOPPADDING', (0,2), (-1,2), 10), ('BOTTOMPADDING', (0,2), (-1,2), 22),
    ('BOTTOMPADDING', (0,3), (-1,3), 36),
]))
story.extend([Spacer(1, 4.8*cm), cover, Spacer(1, 1.2*cm),
              callout('Objetivo: convertir el tráfico que la tienda ya paga en más checkouts, pedidos recuperados y recompras.', GREEN),
              Spacer(1, 0.5*cm),
              P('Uso interno. Este plan prioriza una oferta productizada: alto valor percibido para el cliente y bajo esfuerzo operativo para Riverz.', 'SmallR'),
              PageBreak()])

# 1 Positioning
story.extend(section('1. La posición que Riverz debe ocupar', 'No CRM. No chatbot. Sistema comercial autónomo para e-commerce.'))
story.append(P('Riverz no debe venderse como una herramienta que “responde mensajes”. Debe presentarse como la capa operativa que convierte conversaciones, leads, carritos y pagos pendientes en el siguiente paso comercial correcto.'))
story.append(callout('“Riverz es la plataforma de IA que opera el ciclo completo de ventas de tu e-commerce.”'))
story.extend([P('La idea central de toda comunicación:', 'H2R'),
              P('“No te falta tráfico. Te falta una IA que convierta el tráfico que ya pagaste en pedidos.”', 'QuoteR'),
              P('Mecanismo de valor:', 'H2R')])
for b in [
    '<b>Captura:</b> atiende WhatsApp, Instagram, Messenger, Gmail y los canales conectados desde un inbox.',
    '<b>Conversión:</b> conoce catálogo, responde dudas, recomienda productos, realiza upsells y genera checkout o pedido.',
    '<b>Recuperación:</b> activa seguimientos para leads sin compra, carritos abandonados, pagos pendientes y pagos rechazados.',
    '<b>Postventa:</b> confirma pedidos, envía guías, atiende consultas y reactiva clientes para recompra.',
    '<b>Control:</b> el equipo ve lo que la IA comunica en tiempo real desde computador o celular y toma el relevo cuando hace falta.',
]: story.append(bullet(b))
story.append(P('Diferenciación comunicable: la IA no solo conversa; ejecuta acciones conectadas a la operación de la tienda.', 'SmallR'))
story.append(PageBreak())

# 2 Avatar
story.extend(section('2. Avatar y problema económico', 'El comprador no compra software: compra menos pérdida, más control y una operación escalable.'))
story.append(P('<b>Perfil prioritario:</b> dueño/a o líder comercial de un e-commerce, normalmente entre 27 y 45 años, que invierte en Meta y vende por WhatsApp o Instagram. Tiene catálogo, Shopify, tráfico y un equipo que responde manualmente.'))
story.append(P('Sus dolores reales no son técnicos:'))
for b in [
    'Paga por tráfico y genera conversaciones que se enfrían antes de recibir respuesta.',
    'Pierde leads que dejaron datos, carritos abandonados y pagos pendientes por falta de seguimiento.',
    'Su equipo consume horas respondiendo disponibilidad, precio, envío, estado de pedido y preguntas repetitivas.',
    'No ve claramente qué conversación, campaña o seguimiento terminó en una venta.',
    'Le preocupa crecer porque más pedidos significan más chats, más estrés y más nómina.',
    'Ha visto bots rígidos y teme una experiencia robótica que no pueda vender ni proteger la marca.',
]: story.append(bullet(b))
story.append(callout('El enemigo no es Meta. El enemigo es la venta que muere después del clic.', AMBER))
story.extend([P('Mensaje de retorno', 'H2R'),
              P('“Cada carrito abandonado, cada pago pendiente y cada mensaje sin responder es dinero que tu tienda ya invirtió para conseguir.”', 'QuoteR'),
              P('No prometer ingresos garantizados. Prometer una operación que atiende, sigue, recupera y deja trazabilidad de las oportunidades.', 'SmallR'),
              PageBreak()])

# 3 offer
story.extend(section('3. Oferta comercial', 'Reducir el riesgo del cliente sin regalar consultoría ilimitada.'))
story.append(callout('“Te instalamos Riverz sin costo. Pagas la plataforma cuando ya esté funcionando en tu tienda.”', GREEN))
story.extend([P('La instalación base sin costo incluye:', 'H2R')])
for b in [
    'Conexión de Shopify y canales disponibles.',
    'Configuración del asistente con catálogo, políticas, preguntas frecuentes, envíos y tono de marca.',
    'Activación de cinco flujos esenciales: nuevo pedido, lead sin compra, carrito abandonado, pago pendiente/rechazado y guía/recompra.',
    'Pruebas de conversación, checkout y automatizaciones.',
    'Capacitación corta para supervisar inbox y escalaciones.',
]: story.append(bullet(b))
story.extend([P('Límites de la oferta gratuita', 'H2R')])
for b in [
    'No incluye integraciones a medida, migraciones manuales extensas, rediseño de tienda, copy ilimitado ni flujos hechos desde cero.',
    'Llamadas de IA, consumo avanzado y trabajo fuera del alcance se venden como add-on o bolsa de uso.',
    'La tienda debe entregar accesos y completar el onboarding antes de agendar implementación.',
]: story.append(bullet(b))
story.append(P('<b>Confianza:</b> comunicar que Riverz opera con integraciones oficiales de Meta y la API oficial de WhatsApp Business. Evitar asegurar que una cuenta “nunca” será suspendida.', 'SmallR'))
story.append(PageBreak())

# 4 scripts
story.extend(section('4. Mensaje de adquisición', 'La pieza corta debe vender el problema, el mecanismo y la oferta; no un listado de funcionalidades.'))
story.append(P('Hook principal', 'H2R'))
story.append(P('“Tus anuncios pueden estar funcionando y aun así tu e-commerce puede estar perdiendo dinero todos los días.”', 'QuoteR'))
story.append(P('Guion de anuncio - 45 a 60 segundos', 'H2R'))
script = [
    '“Si tienes un e-commerce, inviertes en publicidad y vendes por WhatsApp o Instagram, escucha esto:',
    'Tus anuncios pueden estar funcionando y aun así tu e-commerce puede estar perdiendo dinero todos los días.',
    'Porque pagas por tráfico, haces que las personas pregunten por tus productos y después la venta se pierde: nadie responde a tiempo, dejan sus datos sin comprar, abandonan el carrito o dejan un pago pendiente.',
    'Riverz es la plataforma con IA que se encarga de lo que pasa después del clic. Responde, recomienda productos, hace upsells, genera checkouts, recupera carritos, confirma pedidos, envía guías y reactiva clientes.',
    'Todo queda conectado en un solo lugar: WhatsApp, Instagram, Messenger, Gmail y Shopify. Tu equipo puede ver cada conversación en tiempo real y entrar solo cuando una venta necesita una decisión humana.',
    'Nosotros hacemos la configuración inicial sin costo. Conectamos tu tienda, catálogo, canales y automatizaciones principales. Primero ves Riverz trabajando; después decides si continúas.',
    'Escríbeme RIVERZ y revisamos si tu tienda aplica.”'
]
for s in script: story.append(P(s, 'BodyR'))
story.extend([P('Hooks alternativos', 'H2R')])
for b in [
    '“No estás perdiendo dinero por tus anuncios. Lo estás perdiendo después de que el cliente te escribe.”',
    '“Cada persona que deja sus datos y no recibe seguimiento es dinero que tu e-commerce ya pagó por conseguir.”',
    '“No necesitas más tráfico hasta que tengas un sistema capaz de convertir el tráfico que ya estás pagando.”',
]: story.append(bullet(b))
story.append(PageBreak())

# 5 funnel
story.extend(section('5. Funnel de adquisición y conversión', 'Usar el anuncio para crear tensión y una demo/VSL para explicar el sistema.'))
funnel_rows = [
    ['1. Anuncio corto', 'Contradicción económica: buenos anuncios, pero ventas perdidas después del clic.', 'Mensaje “RIVERZ” o formulario de aplicación.'],
    ['2. Filtro', 'Identificar tiendas con demanda, Shopify activo y responsable de accesos.', 'Aplicar / agendar diagnóstico.'],
    ['3. Demo o VSL', 'Mostrar el recorrido: pregunta -> recomendación -> checkout -> pedido -> guía -> recompra.', 'Aceptar implementación sin costo.'],
    ['4. Onboarding', 'El cliente entrega información y accesos antes de la sesión.', 'Implementación programada.'],
    ['5. Piloto', 'Riverz trabaja 14 días activos con métricas de actividad y recuperación.', 'Continuidad mensual.'],
]
story.append(table(['Etapa', 'Qué debe comunicar', 'Siguiente paso'], funnel_rows, [2.7*cm, 8.2*cm, 5.8*cm]))
story.extend([Spacer(1, 0.35*cm), P('VSL / demo: apertura recomendada', 'H2R'),
              P('“La mayoría de las tiendas no tienen un problema de tráfico. Tienen un problema de operación. En esta presentación vas a ver el sistema que atiende, vende, recupera y hace seguimiento 24/7 con IA.”', 'QuoteR'),
              P('La demo debe mostrar acciones reales, no diapositivas con iconos: conversación, catálogo, checkout, pedido, guía, recuperación y supervisión humana.', 'SmallR'),
              PageBreak()])

# 6 fulfillment
story.extend(section('6. Fulfillment rápido y sin estrés', 'La instalación gratis debe ser un producto, no una consultoría abierta.'))
story.append(callout('Regla operativa: la instalación estándar debe tomar menos de 60 minutos de trabajo humano directo.', GREEN))
fulfill_rows = [
    ['1. Aplicación', '2 minutos', 'URL de Shopify, volumen, canales, principal fuga y responsable de accesos.'],
    ['2. Onboarding', '10-15 minutos del cliente', 'Conectar Shopify/Meta, enviar FAQ, políticas, tono y transportadora. Sin esto no se agenda.'],
    ['3. Implementación', '45-60 minutos', 'Checklist fijo: canales, catálogo, agente, cinco flujos, QA y capacitación.'],
    ['4. Lanzamiento', 'Primera semana', 'Día 1 asistente + inbox; después pedidos/guías; luego recuperación y recompra.'],
    ['5. Prueba de valor', 'Días 3, 7, 12 y 14', 'Reporte de actividad, oportunidades, checkouts, pedidos y revisión de continuidad.'],
]
story.append(table(['Paso', 'Tiempo', 'Ejecución'], fulfill_rows, [3*cm, 3.5*cm, 10.2*cm]))
story.extend([Spacer(1, 0.35*cm), P('Para bajar esfuerzo interno', 'H2R')])
for b in [
    'Crear plantillas de agente por vertical: moda, belleza, suplementos, hogar, accesorios y ticket alto.',
    'Usar una checklist única y flujos prearmados; los cambios especiales entran como upgrade.',
    'No activar veinte funciones el primer día. La primera victoria debe ser visible y simple.',
    'Automatizar el seguimiento del piloto: día 1, 3, 7, 12 y 14.',
]: story.append(bullet(b))
story.append(PageBreak())

# 7 Pricing
story.extend(section('7. Pricing recomendado', 'Ingresos previsibles, margen protegido y transparencia de costos.'))
story.append(P('Modelo recomendado: <b>instalación gratuita + 14 días activos de piloto + suscripción mensual + costos variables transparentes.</b>'))
pricing_rows = [
    ['Instalación base', '$0 COP', 'Se elimina fricción inicial. Alcance estandarizado y cerrado.'],
    ['Piloto', '14 días activos', 'Empieza cuando Riverz está operativo, no cuando se firma.'],
    ['Riverz Growth', '$990.000 COP / mes', 'IA comercial, inbox, Shopify y automatizaciones esenciales.'],
    ['Fundadores', '$690.000 COP / mes por 3 meses', 'Solo para los primeros clientes con caso de estudio y feedback.'],
    ['Meta, IA intensiva y voz', 'Por uso', 'Separado y transparente. No prometer consumo ilimitado.'],
]
story.append(table(['Concepto', 'Precio', 'Regla'], pricing_rows, [3.4*cm, 4.1*cm, 9.2*cm]))
story.extend([Spacer(1, 0.35*cm), P('Por qué este modelo', 'H2R')])
for b in [
    'No cobrar solo por resultados: tráfico, inventario, precio y oferta también definen ventas; no deben convertir el servicio en trabajo gratis indefinido.',
    'No cobrar por usuario: Riverz libera al equipo; cobrar por cada persona contradice el beneficio.',
    'No esconder costos de Meta, IA y llamadas: proteger margen y evitar sorpresas al cliente.',
    'No bajar de $590.000 COP / mes para una oferta completa: atrae tiendas sin capacidad de pago y erosiona soporte.',
]: story.append(bullet(b))
story.append(callout('Cierre de precio: “La instalación no tiene costo. Cuando Riverz ya esté atendiendo y recuperando oportunidades en tu tienda, la plataforma vale $990.000 al mes, más consumos oficiales según uso.”', AMBER))
story.append(PageBreak())

# 8 plan
story.extend(section('8. Plan de acción de 30 días', 'Lanzar, aprender y convertir los primeros resultados en prueba de mercado.'))
action_rows = [
    ['Semana 1', 'Definir la oferta', 'Cerrar alcance de instalación, formulario de aplicación, checklist, contrato/política del piloto y pricing.'],
    ['Semana 2', 'Preparar activos', 'Grabar anuncio, crear landing/formulario, demo de Riverz, VSL corta y plantillas por vertical.'],
    ['Semana 3', 'Captar y filtrar', 'Lanzar anuncios o outreach. Aplicar filtros antes de agendar. Documentar objeciones y razones de no compra.'],
    ['Semana 4', 'Implementar y medir', 'Lanzar 3 a 5 pilotos. Reportar actividad a días 3 y 7. Convertir el primer cliente activo en caso de estudio.'],
]
story.append(table(['Periodo', 'Objetivo', 'Acción concreta'], action_rows, [2.5*cm, 3.7*cm, 10.5*cm]))
story.extend([Spacer(1, 0.35*cm), P('Indicadores que se revisan cada semana', 'H2R')])
for b in [
    'Aplicaciones recibidas, porcentaje que califica y porcentaje que agenda.',
    'Tiempo promedio de implementación y porcentaje que completa onboarding.',
    'Conversaciones atendidas por IA, escalaciones a humanos, leads seguidos y checkouts enviados.',
    'Carritos/pagos recuperados, pedidos creados o atribuidos, recompra activada.',
    'Conversión de piloto a pago y motivo de no continuidad.',
]: story.append(bullet(b))
story.append(callout('Prioridad absoluta: demostrar valor operativo rápido. La venta se cierra con evidencia de conversaciones atendidas y oportunidades recuperadas, no con una lista de funciones.', GREEN))
story.extend([Spacer(1, 0.5*cm), P('Decisión operativa final', 'H2R'),
              P('Vender Riverz como el sistema que protege y convierte la demanda existente del e-commerce. Instalar una versión estándar sin costo, probar actividad durante 14 días y cobrar una suscripción clara cuando el cliente ya puede ver la operación funcionando.', 'QuoteR')])

doc.build(story)
print(OUT)
