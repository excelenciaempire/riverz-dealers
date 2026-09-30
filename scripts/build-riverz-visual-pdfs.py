"""Build Riverz's visual commercial PDF and complete branded Word companion.

Requires reportlab, Pillow and PyMuPDF. Source Word is preserved unchanged.
Illustrative conversations are examples, not evidence of customer results.
Run: py -X utf8 scripts/build-riverz-visual-pdfs.py
"""
from pathlib import Path
from io import BytesIO
import argparse, hashlib, json, re, zipfile
import xml.etree.ElementTree as ET
import pymupdf
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs/documentos-riverz'
ASSETS = DOCS / 'assets'
OUT = ROOT / 'output/pdf'
QA = ROOT / 'tmp/pdfs/riverz-visual'
SOURCE = DOCS / 'Riverzz ejemplos de automatizaciones y agentes de IA.docx'
W, H = 595.276, 841.89
BG, INK, MUTED, CARD, LINE, LIME = map(HexColor,
    ['#F3F0EB', '#12201F', '#53615A', '#FAF7F1', '#E8DECB', '#F7FF9E'])
PALE, WHITE = HexColor('#E8EDDD'), HexColor('#FFFFFF')
for alias, name in [('Sans','Sans-full.ttf'),('Semi','Semi-full.ttf'),
                    ('Serif','Serif-full.ttf'),('Logo','Logo.ttf')]:
    pdfmetrics.registerFont(TTFont(alias, str(ASSETS / 'fonts' / name)))
OUT.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)
NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with zipfile.ZipFile(SOURCE) as archive:
    doc = ET.fromstring(archive.read('word/document.xml'))
paras = [''.join(t.text or '' for t in p.findall('.//' + NS + 't')).strip()
         for p in doc.findall('.//' + NS + 'p')]
paras = [p.replace('Riverzz','Riverz') for p in paras if p]
def between(start, end):
    return paras[paras.index(start)+1:paras.index(end)]
def pairs(start,end):
    rows = [p for p in between(start,end) if p not in ['Automatización','Qué ocurre']]
    assert len(rows)%2 == 0
    return list(zip(rows[::2], rows[1::2]))
automation_groups = [
    ('Ventas antes de la compra',pairs('Ventas antes de la compra','Recuperación de compras')),
    ('Recuperación de compras',pairs('Recuperación de compras','Pedidos y logística')),
    ('Pedidos y logística',pairs('Pedidos y logística','Postventa y retención')),
    ('Postventa y retención',pairs('Postventa y retención','Escenarios de inteligencia artificial')),
]
assert sum(len(rows) for _,rows in automation_groups) == 22
agent_heads = ['Agente de ventas','Agente de recuperación','Agente de postventa',
               'Agente de retención','Agente general y supervisor']
agent_lists = [between(head, agent_heads[i+1] if i<4 else 'Escenarios completos')
               for i,head in enumerate(agent_heads)]
role_rows=between('Agentes principales','Ejemplos de automatizaciones')
role_rows=role_rows[role_rows.index('Límite')+1:]
agent_limits=[role_rows[i+2] for i in range(0,len(role_rows),3)]
assert len(agent_limits)==5
scenario_lines = between('Escenarios completos','Decisiones que deben conservar control humano')
scenarios=[]
for line in scenario_lines:
    if re.match(r'^\d\s',line): scenarios.append({'title':re.sub(r'^\d\s+','',line),'parts':[]})
    elif scenarios:
        match=re.match(r'^(Evento|Automatización|Agente de IA|Aprobación humana|Resultado)\s+(.*)',line)
        if match: scenarios[-1]['parts'].append((match[1],match[2]))
assert len(scenarios)==8 and all(len(s['parts'])==5 for s in scenarios)
rules = between('Decisiones que deben conservar control humano','Cómo decirlo en el video')
rules=rules[rules.index('Regla recomendada')+1:]
human_rules=list(zip(rules[::2],rules[1::2]))
assert len(human_rules)==6

AGENTS = [
 ('VENTAS','Ayuda a elegir', 'Antes de la compra',
  [('¿Cuál me recomiendas?','Compara opciones del catálogo.'),
   ('¿Hay stock en mi talla?','Consulta variantes y disponibilidad.'),
   ('¿Me armas el pedido?','Prepara la orden o el enlace permitido.')],
  [('client','Busco algo para regalar. ¿Qué opción me sirve?'),
   ('ai','¿Para quién es y qué presupuesto tienes? Así comparo las opciones del catálogo.')]),
 ('RECUPERACIÓN','Retoma la compra', 'Cuando una compra queda pendiente',
  [('El envío me parece caro','Explica costos y opciones aprobadas.'),
   ('Mi tarjeta fue rechazada','Ayuda a reintentar el pago.'),
   ('Pagué por transferencia','Recibe el comprobante para revisión.')],
  [('client','No terminé porque mi pago fue rechazado.'),
   ('ai','Revisemos el estado del pedido. Si sigue pendiente, te comparto cómo reintentar.')]),
 ('ATENCIÓN DE PEDIDOS','Resuelve la postventa', 'Después de la compra',
  [('¿Dónde está mi pedido?','Consulta el estado y la guía.'),
   ('Quiero cambiar la dirección','Recopila el cambio y verifica permisos.'),
   ('Quiero devolverlo','Prepara el caso según tu política.')],
  [('client','¿Dónde está mi pedido?'),
   ('ai','Compárteme el número de orden para consultar el estado y el seguimiento disponible.')]),
 ('RECOMPRAS','Ayuda a volver', 'Con clientes que ya te conocen',
  [('Quiero comprar de nuevo','Usa el historial para reponer.'),
   ('¿Qué más me puede servir?','Recomienda un complemento.'),
   ('¿Tengo algún descuento?','Aplica las ofertas autorizadas.')],
  [('client','Quiero pedir otra vez el mismo producto.'),
   ('ai','Reviso tu compra anterior. ¿Quieres mantener la misma cantidad?')]),
]
FAQS = [
 ('¿Qué incluye el plan?', 'Agentes, automatizaciones, ajustes e integraciones disponibles. Contactos ilimitados. El consumo de IA se paga con saldo aparte.'),
 ('¿Cuánto tarda en estar funcionando?', 'Revisamos las conexiones y ajustes de tu tienda. Confirmamos el plazo antes de empezar y probamos contigo antes de activar.'),
 ('¿Qué pago al comenzar?', 'Instalación y configuración gratis. Al aprobarlas, pagas US$259 el primer mes (35% OFF), más saldo. Después, US$399 al mes. El descuento no aplica a recargas.'),
 ('¿Cuánto pagaré además de la mensualidad?', 'Consumo de IA con saldo y mensajes de WhatsApp sujetos a cobro por Meta. En la reunión estimamos el uso según tu volumen, ventas y margen.'),
 ('¿Cómo funcionan los contactos ilimitados y el saldo?', 'No hay un cupo mensual de contactos. La IA descuenta lo que consume de tus recargas: contactos ilimitados no significa IA ilimitada.'),
 ('¿Qué pasa si mi tienda crece?', 'No subes de rango por atender más contactos. La mensualidad se mantiene; un mayor consumo de IA necesita más saldo.'),
 ('¿Qué pasa si el agente no sabe qué responder?', 'Usa tu catálogo, tus políticas y tus reglas. Si falta información o hay una decisión sensible, puede pasar a tu equipo. Probamos los límites contigo.'),
 ('¿Tengo que cambiar mi tienda o mis sistemas?', 'Revisamos las conexiones disponibles para tu operación. Si hace falta una integración personalizada, acordamos su viabilidad, alcance y plazo.'),
 ('¿Las llamadas están incluidas?', 'El agente de voz sí. El número y los minutos se pagan aparte y varían por país. Puedes fijar un límite mensual antes de escalar.'),
 ('¿Hay permanencia?', 'No. Cancelas cuando quieras y el plan sigue activo hasta el final del período pagado. Tus cuentas, conversaciones y clientes siguen siendo tuyos.'),
]

class PDF:
    def __init__(self,path,title,header_labels=True):
        self.path=path
        self.c=canvas.Canvas(str(path),pagesize=(W,H),pageCompression=1)
        self.c.setTitle(title);self.c.setAuthor('Riverz')
        self.bounds=[];self.page=0;self.label='';self.dark=False
        self.header_labels=header_labels
    def text(self,x,y,s,font='Sans',size=12,color=None,width=None):
        color=color or (CARD if self.dark else INK)
        tw=pdfmetrics.stringWidth(s,font,size)
        assert x+tw<=W-30 and x>=30,(self.page,s,tw)
        if width is not None: assert tw<=width+.2,(self.page,s,tw,width)
        assert 20<=y<=H-20,(self.page,y,s)
        self.c.setFillColor(color);self.c.setFont(font,size)
        self.c.drawString(x,H-y,s)
        self.bounds.append((self.page,x,y,tw,size,s))
    def lines(self,s,width,font,size):
        result=[]
        for para in s.split('\n'):
            line=''
            for word in para.split():
                trial=f'{line} {word}'.strip()
                if line and pdfmetrics.stringWidth(trial,font,size)>width:
                    result.append(line);line=word
                else:line=trial
            if line:result.append(line)
        return result
    def wrap(self,x,y,s,width=511,font='Sans',size=12,leading=17,color=None,max_lines=None):
        ls=self.lines(s,width,font,size)
        if max_lines: assert len(ls)<=max_lines,(self.page,s,ls,max_lines)
        for i,l in enumerate(ls):self.text(x,y+i*leading,l,font,size,color,width)
        return y+len(ls)*leading
    def box(self,x,y,w,h,fill=CARD,r=16,stroke=None):
        self.c.setFillColor(fill);self.c.setStrokeColor(stroke or fill)
        self.c.setLineWidth(.7);self.c.roundRect(x,H-y-h,w,h,r,fill=1,stroke=int(bool(stroke)))
    def line(self,x1,y1,x2,y2,color=LINE,weight=1):
        self.c.setStrokeColor(color);self.c.setLineWidth(weight)
        self.c.line(x1,H-y1,x2,H-y2)
    def image(self,path,x,y,w,h):
        self.c.drawImage(str(path),x,H-y-h,w,h,mask='auto',preserveAspectRatio=True,anchor='c')
    def circle(self,x,y,r,fill):
        self.c.setFillColor(fill);self.c.circle(x,H-y,r,fill=1,stroke=0)
    def icon(self,name,x,y,s=24):
        if name=='voice':
            self.c.saveState();self.c.translate(x,H-y-s);self.c.scale(s/24,s/24)
            self.c.setStrokeColor(INK);self.c.setLineWidth(1.5)
            handset=self.c.beginPath();handset.moveTo(5,20)
            handset.lineTo(8,22);handset.lineTo(12,16);handset.lineTo(10,14)
            handset.curveTo(11,11,13,9,15,8);handset.lineTo(17,10)
            handset.lineTo(23,6);handset.lineTo(21,3)
            handset.curveTo(19,1,13,4,9,8);handset.curveTo(5,12,2,18,5,20)
            handset.close();self.c.drawPath(handset,stroke=1,fill=0);self.c.restoreState()
            return
        path=ROOT/'public/channels'/f'{name}.svg'
        if path.exists():
            d=pymupdf.open(path);px=d[0].get_pixmap(matrix=pymupdf.Matrix(4,4),alpha=True)
            self.c.drawImage(ImageReader(BytesIO(px.tobytes('png'))),x,H-y-s,s,s,mask='auto');d.close()
    def pictogram(self,kind,x,y,s=34):
        self.box(x,y,s,s,LIME,10)
        cx=x+s/2;cy=y+s/2
        self.c.setStrokeColor(INK);self.c.setLineWidth(1.3)
        if kind=='clock':
            self.c.circle(cx,H-cy,8,fill=0,stroke=1)
            self.line(cx,cy,cx,cy-5,INK,1.3);self.line(cx,cy,cx+4,cy,INK,1.3)
        elif kind=='parcel':
            self.c.rect(cx-8,H-cy-7,16,14,fill=0,stroke=1)
            self.line(cx,cy-7,cx,cy+7,INK,1.3);self.line(cx-8,cy-3,cx+8,cy-3,INK,1.3)
        elif kind=='check':
            self.line(cx-7,cy,cx-2,cy+5,INK,1.7);self.line(cx-2,cy+5,cx+8,cy-6,INK,1.7)
        elif kind=='chat':
            self.c.roundRect(cx-9,H-cy-6,18,13,4,fill=0,stroke=1)
            self.line(cx-6,cy+6,cx-8,cy+10,INK,1.2)
        elif kind=='cart':
            self.line(cx-10,cy-8,cx-7,cy-8,INK,1.4)
            self.line(cx-7,cy-8,cx-4,cy+4,INK,1.4)
            self.line(cx-4,cy+4,cx+7,cy+4,INK,1.4)
            self.line(cx-6,cy-5,cx+9,cy-5,INK,1.4)
            self.line(cx+9,cy-5,cx+7,cy+4,INK,1.4)
            self.circle(cx-3,cy+8,1.7,INK);self.circle(cx+6,cy+8,1.7,INK)
        else:
            self.c.circle(cx,H-cy,8,fill=0,stroke=1)
            self.line(cx-3,cy-3,cx+4,cy+4,INK,1.3)
    def header(self,label,title,subtitle='',dark=False):
        self.page+=1;self.label=label;self.dark=dark
        self.c.setFillColor(INK if dark else BG);self.c.rect(0,0,W,H,fill=1,stroke=0)
        self.text(42,48,'riverz','Logo',24,LIME if dark else INK)
        if self.header_labels:
            self.text(380,44,label.upper(),'Semi',8.1,LIME if dark else MUTED,width=173)
        self.line(42,66,553,66,HexColor('#36433B') if dark else LINE)
        end=self.wrap(42,119,title,511,'Serif',36,40,max_lines=2)
        if subtitle:self.wrap(42,end-10,subtitle,511,size=12,leading=17,color=CARD if dark else MUTED,max_lines=2)
    def end(self):
        self.line(42,802,553,802,HexColor('#36433B') if self.dark else LINE)
        self.text(42,820,'riverz.co  |  '+self.label,'Sans',8,LIME if self.dark else MUTED)
        self.text(531,820,f'{self.page:02}','Semi',8,LIME if self.dark else MUTED)
        self.c.showPage()
    def finish(self):
        self.c.save()
        # Store actual binary streams: Git must never treat a PDF as CRLF text.
        source=pymupdf.open(self.path)
        for xref in range(1,source.xref_length()):
            if source.xref_is_stream(xref):
                source.update_stream(xref,source.xref_stream(xref),compress=True)
        binary=source.tobytes(garbage=4,deflate=True)
        normalized=pymupdf.open(stream=binary,filetype='pdf')
        assert len(source)==len(normalized)
        for a,b in zip(source,normalized):
            assert a.get_pixmap().samples==b.get_pixmap().samples
        source.close();normalized.close();self.path.write_bytes(binary)
    def chat(self,x,y,w,messages,title='Ejemplo de conversación',channel='whatsapp',size=11):
        # Intentionally illustrative: no fake revenue, metrics or live status.
        heights=[]
        for role,msg in messages:
            heights.append(20+len(self.lines(msg,w-65,'Sans',size))*15)
        h=53+sum(heights)+8*(len(messages)-1)+14
        self.box(x,y,w,h,CARD,16,LINE)
        self.icon(channel,x+15,y+14,20)
        self.text(x+44,y+28,title,'Semi',10,INK,width=w-59)
        yy=y+49
        for (role,msg),hh in zip(messages,heights):
            xx=x+14 if role=='client' else x+27
            fill=WHITE if role=='client' else PALE
            self.box(xx,yy,w-41,hh,fill,11)
            self.wrap(xx+12,yy+19,msg,w-65,size=size,leading=15,color=INK)
            yy+=hh+8
        return y+h
    def note(self,y,title,body,h=78):
        self.box(42,y,511,h,INK)
        self.text(60,y+29,title,'Serif',21,LIME)
        self.wrap(60,y+50,body,475,size=10.8,leading=15,color=CARD,max_lines=3)

def flow(p,y,steps):
    stepw=(511-12*(len(steps)-1))/len(steps)
    for i,(a,b) in enumerate(steps):
        x=42+i*(stepw+12);p.box(x,y,stepw,74,CARD,12)
        p.circle(x+17,y+19,9,LIME);p.text(x+14,y+22,str(i+1),'Semi',8,INK)
        p.text(x+32,y+22,a,'Semi',9.1,INK,width=stepw-40)
        p.wrap(x+12,y+43,b,stepw-24,size=10.5,leading=14,color=MUTED,max_lines=2)

def personalize(p):
    p.header('Personalización','La automatización activa.\nEl agente entiende y responde.',
             'Tu catálogo, tu tono y tus políticas. Nosotros configuramos los procesos y los permisos.')
    flow(p,224,[('Evento','Carrito pendiente'),('Regla','Espera y verifica'),('Agente','Resuelve la duda')])
    p.chat(42,320,511,[('client','No terminé la compra porque tengo una duda con el envío.'),
                      ('ai','Reviso las opciones de envío de tu tienda y te ayudo a retomar la compra.')],
           'El cliente responde; la IA continúa',size=12)
    for i,(title,body,kind) in enumerate([
        ('Automatización','Decide cuándo actuar y cuándo detener el seguimiento.','clock'),
        ('Agente de IA','Consulta información y responde con contexto.','chat'),
        ('Tu equipo','Aprueba excepciones y decisiones sensibles.','check')]):
        y=560+i*64;p.pictogram(kind,42,y,34)
        p.text(91,y+16,title,'Semi',12,INK)
        p.text(91,y+37,body,'Sans',11.4,INK,width=462)
    p.end()

def commercial():
    p=PDF(OUT/'riverz-propuesta-comercial.pdf','Riverz | Tu flota de IA para ecommerce')
    p.header('Tu flota de IA','Para vender y atender.\nNosotros lo dejamos listo.',
             'Agentes y automatizaciones adaptados a tu ecommerce. Sin diseñar los procesos desde cero.')
    p.image(ASSETS/'riverz-flota-original.png',42,220,511,341)
    for i,(label,title,when,examples,chat) in enumerate(AGENTS):
        x=42+(i%2)*263;y=579+(i//2)*91
        p.box(x,y,248,78);p.text(x+16,y+25,label,'Semi',8.6,MUTED)
        p.text(x+16,y+52,title,'Serif',22,INK)
    p.text(42,787,'Más conversaciones atendidas. Más tiempo para dirigir tu tienda.','Sans',11.1,MUTED)
    p.end();personalize(p)
    p.header('Automatizaciones','El seguimiento ocurre\nen el momento correcto.',
             'Estos son seis procesos que podemos configurar. Los tiempos y las condiciones se ajustan a tu marca.')
    recipes=[
      ('cart','Carrito abandonado','1 hora después','Verifica que siga pendiente. Retoma la compra y deja que la IA atienda las dudas.'),
      ('clock','Pago rechazado','10 minutos después','Comprueba que no haya un pago posterior y ofrece reintentar.'),
      ('check','Transferencia pendiente','Hasta confirmar','Recuerda el pago y recibe el comprobante. Tu equipo valida si hace falta.'),
      ('parcel','Pedido y guía','Al crear o despachar','Confirma la orden y comparte el seguimiento disponible.'),
      ('chat','Entrega confirmada','3 días después','Pregunta por la experiencia. Solicita reseña o abre soporte según la respuesta.'),
      ('cart','Recompra','En la fecha adecuada','Usa el historial para ofrecer reposición o un complemento.')]
    for i,(kind,title,when,body) in enumerate(recipes):
        x=42+(i%2)*263;y=224+(i//2)*158
        p.box(x,y,248,143);p.pictogram(kind,x+16,y+15,32)
        p.text(x+60,y+29,when,'Semi',9,MUTED,width=172)
        p.text(x+16,y+73,title,'Serif',20.5,INK,width=216)
        p.wrap(x+16,y+96,body,216,size=11.2,leading=15,max_lines=3)
    p.note(720,'Cada seguimiento tiene una regla de salida.',
           'Se detiene al comprar, resolver el caso o pedir no recibir mensajes.',65)
    p.end()
    p.header('Agentes de IA','Cuatro trabajos.\nEjemplos que reconocerás.',
             'Así responde cada especialista. Las acciones sobre pedidos dependen de la conexión y los permisos acordados.')
    for i,(label,title,when,examples,chat) in enumerate(AGENTS):
        x=42+(i%2)*263;y=224+(i//2)*265
        p.box(x,y,248,249);p.pictogram(['cart','clock','parcel','chat'][i],x+15,y+15,32)
        p.text(x+60,y+34,label,'Semi',8.1,MUTED,width=172)
        p.text(x+15,y+74,title,'Serif',22,INK,width=218)
        for j,(q,a) in enumerate(examples):
            yy=y+108+j*44
            p.text(x+15,yy,q,'Semi',10.8,INK,width=218)
            p.wrap(x+15,yy+16,a,218,size=10.5,leading=13,max_lines=2)
    p.text(42,782,'Los cuatro comparten el historial y pueden transferir el caso a una persona.','Sans',10.7,MUTED)
    p.end()
    p.header('Control humano','Delegas la atención.\nConservas las decisiones.',
             'Definimos contigo qué puede hacer la IA y qué necesita revisión de tu equipo.')
    p.image(ASSETS/'riverz-control-humano.png',42,215,511,341)
    for i,(title,body) in enumerate([
      ('Riverz atiende','Productos, preguntas de compra, pedidos y seguimiento.'),
      ('Tu equipo aprueba','Pagos sin verificar, reembolsos y excepciones que definas.'),
      ('Tú revisas','Conversaciones, acciones ejecutadas y casos pendientes.')]):
        y=574+i*68;p.box(42,y,511,58)
        p.circle(63,y+28,10,LIME);p.text(60,y+32,str(i+1),'Semi',10,INK)
        p.text(87,y+24,title,'Semi',12,INK)
        p.text(87,y+44,body,'Sans',11.1,INK,width=449)
    p.end()
    comparison(p)
    p.header('Canales y puesta en marcha','Tus canales. Tu tienda.\nUna sola bandeja.',
             'Mensajes y comentarios con el contexto de tu operación. Revisamos las conexiones disponibles para cada cuenta.')
    channels=[('whatsapp','WhatsApp'),('instagram','Instagram'),('messenger','Messenger'),('tiktok','TikTok'),('gmail','Correo')]
    for i,(icon,label) in enumerate(channels):
        x=42+i*105;p.box(x,220,91,70);p.icon(icon,x+34,231,24)
        p.text(x+12,276,label,'Semi',9.3,INK,width=72)
    inbox(p,311)
    flow(p,586,[('Conectamos','Tienda y canales'),('Adaptamos','Chats y políticas'),('Probamos','Tú apruebas')])
    p.note(689,'La reunión aterriza tu propia operación.',
           'Priorizamos los procesos, revisamos accesos e importación del historial disponible y acordamos alcance, costos y plazo.',91)
    p.end()
    price(p)
    for i in range(2):
        p.header('Preguntas frecuentes','Antes de empezar,\ntodo claro.',
                 'Respuestas de la landing, resumidas para leerlas rápido. Plan de US$399 al mes + saldo.')
        for j,(q,a) in enumerate(FAQS[i*5:i*5+5]):
            y=222+j*110;p.box(42,y,511,99)
            p.circle(65,y+26,11,LIME);p.text(61,y+30,str(i*5+j+1),'Semi',9,INK)
            qy=p.wrap(88,y+29,q,445,'Semi',11.7,15,max_lines=2)
            p.wrap(60,max(y+52,qy+10),a,475,size=11.1,leading=15,max_lines=3)
        p.text(42,792,'Oferta consultada en riverz.co el 29 de septiembre de 2026.' if i==0 else
               'Agenda tu reunión para definir la instalación en tu propia tienda.','Semi' if i==1 else 'Sans',9 if i==1 else 8.8,MUTED)
        p.c.linkURL('https://riverz.co',(42,H-799,420,H-777))
        p.end()
    p.finish();return p.path

def comparison(p):
    p.header('Riverz vs. otras opciones','Más trabajo resuelto.\nMenos trabajo para ti.',
             'La diferencia principal: nuestro equipo instala, prueba y ajusta la operación contigo.')
    widths=[105,153,153,100];xx=[42,147,300,453]
    p.box(42,222,511,50,INK,0)
    p.box(147,222,153,50,LIME,0)
    p.text(160,255,'riverz','Logo',22,INK)
    p.text(312,252,'Otras plataformas','Semi',9.7,CARD,width=133)
    p.text(463,252,'Solo personas','Semi',9.7,CARD,width=82)
    rows=[
      ('Empezar sin aprender flujos','Conectamos, configuramos y probamos por ti.','Flujos propios o implementación según proveedor.','Contratas y capacitas.'),
      ('Hacer ajustes','Nos dices qué cambiar; lo implementamos.','Tu equipo, un experto o un servicio contratado.','Explicas cambios y supervisas.'),
      ('Vender y recuperar','Asesoría, carritos, pagos pendientes y recompra.','Bots, campañas o agentes según plan y configuración.','Contactas cada oportunidad.'),
      ('Atender pedidos','Consulta, guía y acciones según la conexión.','Alcance operativo según integración y proveedor.','Buscas la orden y respondes.'),
      ('Controlar lo sensible','Permisos y aprobaciones definidos contigo.','Reglas de intervención y derivación configurables.','Cada persona sigue tus reglas.'),
      ('Crecer con costos claros','US$399/mes + saldo. Contactos ilimitados.','Cobros por contactos, usuarios o consumo según plan.','Nómina, herramientas y turnos.'),
      ('Unificar el trabajo','Agentes, automatizaciones y ajustes con un equipo.','Combinas herramientas y gestión según lo que necesitas.','Coordina tu equipo.')]
    for i,row in enumerate(rows):
        y=272+i*60
        p.box(42,y,511,60,CARD if i%2==0 else BG,0)
        p.box(147,y,153,60,HexColor('#EDF0D6'),0)
        for j,t in enumerate(row):p.wrap(xx[j]+10,y+19,t,widths[j]-20,'Semi' if j==0 else 'Sans',9.6,12.8,INK,max_lines=4)
        p.line(42,y+60,553,y+60,LINE,.7)
    p.text(42,723,'La flota, la configuración y los ajustes.','Serif',23,INK)
    p.text(42,749,'Un mismo equipo se encarga.','Serif',23,INK)
    p.wrap(42,772,'Referencias en LatAm: Manychat (contactos activos), Kommo (usuarios e IA), Leadsales (CRM e implementación guiada). El alcance varía por plan.',511,size=8.5,leading=11,max_lines=2)
    for x,title,url in [(42,'Manychat','https://manychat.com/pricing'),(110,'Kommo','https://www.kommo.com/es/precios/comparar-planes/'),(165,'Leadsales','https://leadsales.io/blog/leadsales-que-es-como-funciona/')]:
        p.c.linkURL(url,(x,H-798,x+62,H-765))
    p.end()

def inbox(p,y):
    p.box(42,y,511,248,INK,16)
    p.text(59,y+26,'riverz','Logo',16,LIME)
    p.text(380,y+25,'Vista ilustrativa','Sans',8.5,CARD)
    p.line(58,y+38,537,y+38,HexColor('#36433B'))
    names=[('whatsapp','Laura Gómez','¿Dónde está mi pedido?'),('instagram','Andrés Torres','¿Hay talla M?'),
           ('tiktok','Valentina Ruiz','¿Hacen envíos?'),('gmail','Daniel Rojas','Quiero pedir otra vez')]
    for i,(icon,name,msg) in enumerate(names):
        yy=y+49+i*44;p.box(55,yy,205,38,HexColor('#23342E'),8)
        p.icon(icon,64,yy+10,17);p.text(89,yy+15,name,'Semi',9.3,CARD)
        p.text(89,yy+30,msg,'Sans',8.5,CARD,width=161)
    p.text(280,y+67,'Laura Gómez','Semi',11,CARD)
    p.box(280,y+84,243,48,CARD,10)
    p.text(292,y+105,'¿Dónde está mi pedido?','Sans',10.8,INK)
    p.box(293,y+143,230,62,LIME,10)
    p.wrap(306,y+165,'Consulto el estado de tu orden y el seguimiento disponible.',203,size=10.8,leading=15,color=INK,max_lines=2)
    p.text(282,y+230,'Historial y acciones en un mismo lugar.','Sans',9,CARD)

def price(p):
    p.header('Plan y oferta','La instalación, por nosotros.\nTu aprobación para empezar.',
             'Instalación y configuración gratis. Revisas lo acordado antes de activar el plan.')
    p.box(42,222,511,204,LIME)
    p.text(64,253,'CONTACTOS ILIMITADOS','Semi',9,INK)
    p.text(64,285,'PRIMER MES · 35% OFF','Semi',12,INK)
    p.text(64,359,'US$259','Serif',66,INK)
    p.text(64,402,'Luego US$399 al mes + tu saldo','Semi',17,INK,width=467)
    for i,(kind,label,detail) in enumerate([
      ('chat','Toda la flota','Ventas, recuperación, atención y recompras.'),
      ('check','Operación y ajustes','Automatizaciones, permisos e integraciones disponibles.'),
      ('parcel','Canales y resultados','Chats, comentarios, chat web, voz y seguimiento.')]):
        y=449+i*70;p.pictogram(kind,42,y,34)
        p.text(91,y+16,label,'Semi',12,INK)
        p.text(91,y+37,detail,'Sans',11.3,INK,width=462)
    p.note(674,'Lo que se paga aparte',
           'El consumo de IA usa el saldo que recargas. Los mensajes de WhatsApp sujetos a cobro por Meta, el número y los minutos de llamadas van aparte. El descuento no aplica a recargas.',106)
    p.text(42,795,'Plan mensual, sin permanencia. Consulta la oferta en riverz.co.','Semi',10.3,MUTED)
    p.c.linkURL('https://riverz.co',(42,H-426,553,H-222));p.end()

GUIDE_AUTOMATIONS = [
    ('Ventas antes de la compra', [
        ('Respuesta a una consulta nueva', 'Recibe el mensaje y lo dirige al asistente que corresponde: productos, pedidos o condiciones de tu tienda.'),
        ('Seguimiento de una conversación', 'Retoma una consulta que quedó sin respuesta. Deja de insistir si la persona compra o no desea continuar.'),
        ('Producto nuevamente disponible', 'Avisa a quienes preguntaron por un producto cuando vuelve a estar disponible y les facilita la compra.'),
        ('Cotización pendiente', 'Recuerda una propuesta enviada y atiende nuevas preguntas hasta que el cliente decide.'),
        ('Carrito de alto valor', 'Da prioridad a compras que superan el monto que definas y puede avisar a un vendedor de tu equipo.'),
    ]),
    ('Recuperación de compras', [
        ('Carrito abandonado', 'Invita a retomar la compra y resolver dudas. Antes de escribir, comprueba que siga pendiente.'),
        ('Pago rechazado', 'Ofrece ayuda para reintentar el pago, después de comprobar que no se completó en otro intento.'),
        ('Pago por transferencia pendiente', 'Recuerda el pago y recibe el comprobante. Los recordatorios se detienen cuando se confirma.'),
        ('Pago pendiente en Mercado Pago', 'Acompaña pagos en efectivo o por transferencia hasta que se acreditan o vencen.'),
        ('Compra contra entrega', 'Confirma los datos antes del despacho y avisa a tu equipo si la respuesta requiere revisión.'),
    ]),
    ('Pedidos y logística', [
        ('Confirmación de pedido', 'Envía el número de orden, el total y la confirmación de que la tienda comenzó a prepararlo.'),
        ('Envío despachado', 'Comparte el número de guía y el enlace de seguimiento cuando el pedido sale.'),
        ('Demora de entrega', 'Informa una demora cuando aparece en el seguimiento y avisa a tu equipo si necesita atención.'),
        ('Dirección incompleta', 'Solicita los datos que faltan para entregar el pedido antes de continuar con el despacho.'),
        ('Pedido sin coincidencia', 'Si no encuentra la orden, entrega el caso a tu equipo con los datos que ya reunió.'),
    ]),
    ('Postventa y retención', [
        ('Encuesta después de la entrega', 'Pregunta cómo fue la experiencia y registra la respuesta del cliente.'),
        ('Solicitud de reseña', 'Invita a compartir la experiencia. Si hay un problema pendiente, primero ofrece atención.'),
        ('Acompañamiento de uso', 'Envía recomendaciones de uso en los días acordados y responde las dudas que surjan.'),
        ('Reposición', 'Recuerda reponer un producto cuando está por acabarse, según su duración y la última compra.'),
        ('Recompra', 'Invita a realizar otra compra con productos relacionados con lo que el cliente eligió.'),
        ('Reactivación de clientes', 'Retoma el contacto con quienes llevan tiempo sin comprar, usando su historial.'),
        ('Cambio o devolución', 'Recopila pedido y motivo para que tu equipo revise la solicitud según las condiciones de la tienda.'),
    ]),
]

GUIDE_ROLES = [
    ('Ventas', 'Asesora, recomienda complementos y ayuda a crear pedidos.', 'cart'),
    ('Recuperación', 'Resuelve lo que frenó una compra y facilita retomarla.', 'clock'),
    ('Postventa', 'Atiende consultas de pedidos, cambios, garantías y devoluciones.', 'parcel'),
    ('Retención y recompras', 'Usa el historial para proponer una nueva compra relevante.', 'chat'),
    ('General y supervisor', 'Dirige cada consulta y detecta cuándo necesita atención de tu equipo.', 'check'),
]

GUIDE_CHAT_CASES = [
    ('Elegir un producto', 'instagram', [
        ('client', 'Quiero un regalo sencillo para mi hermana.'),
        ('ai', 'El set de crema y limpiador puede encajar. Tiene empaque para regalo.'),
        ('client', 'Ese me sirve. ¿Cómo lo compro?'),
    ]),
    ('Producto disponible', 'whatsapp', [
        ('ai', 'La crema que buscabas volvió a estar disponible.'),
        ('client', '¿También tienen la presentación grande?'),
        ('ai', 'Sí, hay de 200 ml. Te comparto esa opción.'),
    ]),
    ('Cotización pendiente', 'gmail', [
        ('ai', '¿Pudiste revisar la cotización de los sets?'),
        ('client', 'Sí. ¿Se pueden pedir sin empaque de regalo?'),
        ('ai', 'Claro. Preparo la opción sin ese empaque.'),
    ]),
    ('Compra de varias unidades', 'whatsapp', [
        ('client', 'Necesito 40 sets para mi empresa.'),
        ('ai', 'Te paso con el equipo para revisar cantidad y fecha de entrega.'),
        ('client', 'Los necesito para el próximo viernes.'),
    ]),
    ('Carrito abandonado', 'whatsapp', [
        ('ai', 'Tu carrito sigue pendiente. ¿Te ayudo a terminarlo?'),
        ('client', 'No sé cuánto tarda el envío a Medellín.'),
        ('ai', 'De 2 a 3 días hábiles. Te comparto tu carrito.'),
    ]),
    ('Pago rechazado', 'instagram', [
        ('client', 'La tarjeta no pasó. ¿Puedo pagar de otra forma?'),
        ('ai', 'Sí, tu pedido permite transferencia. Te comparto los datos.'),
        ('client', 'Perfecto, voy a hacerlo así.'),
    ]),
    ('Transferencia pendiente', 'whatsapp', [
        ('ai', 'Tu pedido sigue pendiente de pago. ¿Necesitas ayuda?'),
        ('client', 'Ya transferí. Aquí está el comprobante.'),
        ('ai', 'Gracias. Lo envié al equipo para verificar el pago.'),
    ]),
    ('Compra contra entrega', 'whatsapp', [
        ('ai', '¿Confirmas que recibirás tu pedido y pagarás al recibirlo?'),
        ('client', 'Sí, pero llego después de las 3.'),
        ('ai', 'Anoto el horario para que el equipo revise la entrega.'),
    ]),
    ('Estado del pedido', 'whatsapp', [
        ('client', '¿Dónde está mi pedido 1048?'),
        ('ai', 'Ya fue despachado. Tu guía es 785421; te comparto el seguimiento.'),
        ('client', 'Gracias, ya puedo revisarlo.'),
    ]),
    ('Dirección incompleta', 'whatsapp', [
        ('ai', 'Nos falta el apartamento para enviar tu pedido.'),
        ('client', 'Es el 402, torre B.'),
        ('ai', 'Gracias. Paso el dato al equipo para completar el despacho.'),
    ]),
    ('Demora de entrega', 'gmail', [
        ('ai', 'El seguimiento muestra una demora en tu entrega.'),
        ('client', '¿Qué hago si no llega mañana?'),
        ('ai', 'Ya avisé al equipo para revisar el caso y darte respuesta.'),
    ]),
    ('Pedido no encontrado', 'instagram', [
        ('client', 'No encuentro la orden que hice ayer.'),
        ('ai', '¿Con qué correo compraste? Lo revisará el equipo.'),
        ('client', 'Con el mío. Te lo envío por aquí para que lo revisen.'),
    ]),
    ('Producto dañado', 'gmail', [
        ('client', 'El envase llegó roto. Adjunto una foto y el pedido 1048.'),
        ('ai', 'Lamento lo ocurrido. Envié los datos al equipo para revisar el reemplazo.'),
        ('client', 'Gracias, quedo pendiente.'),
    ]),
    ('Acompañamiento de uso', 'whatsapp', [
        ('ai', '¿Cómo te ha ido con el set que recibiste?'),
        ('client', '¿En qué orden uso los productos?'),
        ('ai', 'Primero el limpiador y después la crema, según las indicaciones del set.'),
    ]),
    ('Reposición', 'whatsapp', [
        ('ai', '¿Tu crema está por acabarse? Puedo ayudarte a pedirla de nuevo.'),
        ('client', 'Sí, esta vez quiero dos.'),
        ('ai', 'Claro, te comparto la opción para llevar dos.'),
    ]),
    ('Otra compra relevante', 'instagram', [
        ('client', 'Me gustó la crema. Busco algo para limpiar la piel.'),
        ('ai', 'El limpiador suave complementa esa crema. ¿Quieres ver la opción?'),
        ('client', 'Sí, muéstramelo.'),
    ]),
    ('Comentario en redes', 'instagram', [
        ('client', '¿Tienen el set de la publicación?'),
        ('ai', '¡Hola! Sí, está disponible. Escríbenos por privado y te ayudamos.'),
        ('client', 'Listo, ya les escribo.'),
    ]),
    ('Del comentario al privado', 'instagram', [
        ('client', 'Vengo del comentario. ¿Envían el set a Cali?'),
        ('ai', '¡Hola! Sí, enviamos a Cali. ¿Lo quieres para ti o para regalo?'),
        ('client', 'Para regalo, por favor.'),
    ]),
    ('Respuesta a una campaña', 'whatsapp', [
        ('ai', 'Llegó un nuevo set de cuidado diario. ¿Quieres conocerlo?'),
        ('client', '¿Tiene la misma crema que compré?'),
        ('ai', 'Sí, incluye esa crema y un limpiador. Te comparto los detalles.'),
    ]),
    ('Llamada de confirmación', 'voice', [
        ('ai', 'Hola, te llamo para confirmar la dirección de tu pedido.'),
        ('client', 'Es correcta, pero falta el apartamento 402.'),
        ('ai', 'Gracias. Dejo el dato para completar la entrega.'),
    ]),
]

GUIDE_CHAT_PAGES = [
    ('Ventas: ejemplos', (0,1,2,3), 4),
    ('Recuperación: ejemplos', (4,5,6,7), 6),
    ('Pedidos: ejemplos', (8,9,10,11), 8),
    ('Postventa: ejemplos', (12,13,14,15), 10),
    ('Canales: ejemplos', (16,17,18,19), 12),
]

GUIDE_SECTIONS = [
    ('El equipo de asistentes', 'Asistentes', 2, '02'),
    ('Ventas antes de la compra y ejemplos', 'Ventas', 3, '03-04'),
    ('Recuperación de compras y ejemplos', 'Recuperación', 5, '05-06'),
    ('Pedidos y logística: capacidades y ejemplos', 'Pedidos', 7, '07-08'),
    ('Postventa y retención: capacidades y ejemplos', 'Postventa', 9, '09-10'),
    ('Canales, campañas y llamadas: ejemplos', 'Canales', 11, '11-12'),
    ('Personalización y control', 'Personalización', 13, '13'),
]

def guide():
    p = PDF(OUT/'riverz-guia-detallada-automatizaciones-y-agentes.pdf',
            'Riverz | Automatizaciones y asistentes de IA para tu ecommerce',header_labels=False)
    def section(number):
        title, _, page, _ = GUIDE_SECTIONS[number]
        assert p.page + 1 == page, (title, p.page, page)
        p.c.bookmarkPage(f'guide-{number}')
        p.c.addOutlineEntry(title, f'guide-{number}', 0)

    # The cover contains only the title, description and branded illustration.
    p.page=1
    p.c.setFillColor(BG);p.c.rect(0,0,W,H,fill=1,stroke=0)
    p.wrap(42,125,'Automatizaciones y asistentes\npara tu ecommerce.',511,'Serif',36,40,max_lines=2)
    p.wrap(42,220,'Descubre cómo Riverz puede vender, recuperar compras y acompañar a tus clientes con conversaciones en lenguaje natural.',511,size=12,leading=17,color=MUTED,max_lines=2)
    p.image(ASSETS/'riverz-flota-original.png',42,310,511,341)
    p.c.showPage()

    section(0)
    p.header('Asistentes y automatizaciones','Cada asistente\ntiene un trabajo.',
             'El cliente conversa con sus propias palabras. Riverz responde según su intención y el contexto.')
    for i,(title,body,kind) in enumerate([
        ('Automatización','Escribe ante una compra pendiente, un pedido nuevo o una entrega.','clock'),
        ('Asistente de IA','Atiende preguntas, pide información y adapta la respuesta a la conversación.','chat')]):
        x=42+i*263;p.box(x,219,248,119);p.pictogram(kind,x+15,234,30)
        p.text(x+58,255,title,'Semi',11.4,INK,width=174)
        p.wrap(x+15,285,body,218,size=11.8,leading=16,max_lines=3)
    for i,(title,body,kind) in enumerate(GUIDE_ROLES):
        y=362+i*80;p.box(42,y,511,70);p.pictogram(kind,58,y+19,30)
        p.text(106,y+28,title,'Serif',21,INK)
        p.wrap(106,y+51,body,429,size=11.5,leading=15,max_lines=1)
    p.end()

    for group_index,(title,rows) in enumerate(GUIDE_AUTOMATIONS):
        section(group_index+1)
        p.header('Automatizaciones',title+'.',
                 ['Consultas, productos disponibles y oportunidades de venta.',
                  'Carritos y pagos que necesitan una nueva oportunidad.',
                  'Información útil para acompañar cada pedido.',
                  'Atención después de la entrega y relación con tus clientes.'][group_index])
        rowh = 103 if len(rows)==5 else 78
        for i,(name,body) in enumerate(rows):
            y=204+i*rowh;p.box(42,y,511,rowh-9)
            p.circle(59,y+23,8,LIME);p.text(56,y+26,str(i+1),'Semi',8,INK)
            p.text(77,y+27,name,'Serif',20 if len(rows)==5 else 18,INK,width=456)
            p.wrap(77,y+50,body,456,size=11.5,leading=15,max_lines=2)
        if group_index==0:
            p.wrap(42,751,'Definimos contigo cuándo escribir, a quién contactar y cuándo terminar el seguimiento. Los mensajes se adaptan al momento de cada cliente.',511,size=11,leading=15,color=MUTED,max_lines=2)
        p.end()
        client_conversations(p,group_index)

    section(5)
    p.header('Canales y alcance','Chats, comentarios,\ncampañas y llamadas.')
    for i,(title,body,channel) in enumerate([
        ('Chats y correo','WhatsApp, Instagram, Messenger, correo y chat web: asesoría, dudas de compra y atención de pedidos.','whatsapp'),
        ('Comentarios en redes','Precio, disponibilidad o envíos en Facebook, Instagram y TikTok. Los pedidos y datos personales se atienden por privado.','instagram'),
        ('Campañas a tu base de clientes','Novedades, promociones o reposición según el historial e interés. Si alguien responde, el asistente continúa la conversación.',None),
        ('Llamadas con un agente de voz','Conversaciones en lenguaje natural para confirmar pedidos, aclarar datos de entrega y hacer seguimiento.',None)]):
        y=213+i*130;p.box(42,y,511,117)
        if channel:p.icon(channel,59,y+19,22)
        else:p.pictogram('chat',58,y+17,28)
        p.text(99,y+29,title,'Serif',21,INK,width=434)
        p.wrap(99,y+53,body,434,size=11.3,leading=15,max_lines=3)
    p.end()
    client_conversations(p,4)

    section(6)
    p.header('Personalización y control','Tu marca define la atención.\nTu equipo conserva el control.',
             'Nosotros preparamos los asistentes y los seguimientos con la información de tu tienda.')
    p.image(ASSETS/'riverz-control-humano.png',42,210,236,157)
    for i,(title,body) in enumerate([
        ('Tu catálogo','Productos, variantes y disponibilidad.'),
        ('Tu manera de hablar','Tono, saludos y estilo de respuesta.'),
        ('Tus condiciones','Envíos, pagos, cambios y garantías.')]):
        y=226+i*47;p.text(299,y,title,'Semi',11.7,INK)
        p.wrap(299,y+19,body,254,size=10.8,leading=14,max_lines=2)
    p.text(42,404,'ACORDAMOS QUÉ RESUELVE LA IA Y QUÉ REVISA TU EQUIPO','Semi',9.1,MUTED)
    decisions=[
        ('Decisiones de tu tienda','Descuentos, cambios, cancelaciones y devoluciones siguen las condiciones que definas.'),
        ('Revisión de tu equipo','Tú eliges qué pagos, reembolsos y excepciones necesitan revisión. Si falta información o el cliente pide una persona, se entrega el caso con contexto.'),
        ('Preferencias del cliente','Si pide que no le escriban, se detiene el seguimiento.'),
    ]
    for i,(title,body) in enumerate(decisions):
        y=429+i*87;p.box(42,y,511,77)
        p.text(60,y+27,title,'Semi',12,INK)
        p.wrap(60,y+49,body,475,size=11.5,leading=16,max_lines=2)
    p.wrap(42,751,'Las acciones disponibles se acuerdan según los canales y herramientas que use tu tienda.',511,size=11,leading=15,color=MUTED,max_lines=2)
    p.end();p.finish();return p.path

def client_conversations(p,index):
    heading,case_indices,page=GUIDE_CHAT_PAGES[index]
    assert p.page+1==page
    p.header('Conversaciones',heading+'.')
    row_bottom=188
    for row in range(2):
        y=row_bottom
        for col in range(2):
            case_index=case_indices[row*2+col]
            title,channel,messages=GUIDE_CHAT_CASES[case_index]
            end=p.chat(42+col*263,y,248,messages,title=title,channel=channel,size=11.3)
            row_bottom=max(row_bottom,end+22)
    assert row_bottom<772,(heading,row_bottom)
    p.text(42,783,'Ejemplos ilustrativos; productos, pedidos y condiciones son ficticios.','Sans',10,MUTED)
    p.end()


def verify(path,expected):
    d=pymupdf.open(path);assert len(d)==expected,(path,len(d),expected)
    target=QA/path.stem;target.mkdir(exist_ok=True)
    alltext='\n'.join(pg.get_text() for pg in d)
    for i,pg in enumerate(d):
        for b in pg.get_text('dict')['blocks']:
            if b['type']==0:
                for l in b['lines']:
                    for s in l['spans']:
                        assert pg.rect.contains(pymupdf.Rect(s['bbox'])),(i,s)
                        assert not any(c in s['text'] for c in ['\ufffd','\x00'])
        pg.get_pixmap(matrix=pymupdf.Matrix(1.6,1.6),alpha=False).save(target/f'page-{i+1:02}.png')
    if expected==13:
        assert all(name in alltext for _,rows in automation_groups for name,_ in rows)
        assert all(body in alltext.replace('\n',' ') for _,rows in GUIDE_AUTOMATIONS for _,body in rows)
        assert [[name for name,_ in rows] for _,rows in GUIDE_AUTOMATIONS] == [[name for name,_ in rows] for _,rows in automation_groups]
        assert len(GUIDE_ROLES)==5 and all(title in alltext for title,_,_ in GUIDE_ROLES)
        assert len(GUIDE_CHAT_CASES)==20 and all(len(messages)==3 for _,_,messages in GUIDE_CHAT_CASES)
        assert all(body in alltext.replace('\n',' ') for _,_,messages in GUIDE_CHAT_CASES for _,body in messages)
        assert [case_index for _,indices,_ in GUIDE_CHAT_PAGES for case_index in indices]==list(range(20))
        for _,indices,page in GUIDE_CHAT_PAGES:
            assert len(indices)==4
            assert all(GUIDE_CHAT_CASES[i][0] in d[page-1].get_text() for i in indices)
            image_count=sum((ROOT/'public/channels'/f'{GUIDE_CHAT_CASES[i][1]}.svg').exists() for i in indices)
            assert len([b for b in d[page-1].get_text('dict')['blocks'] if b['type']==1])==image_count
        assert len(alltext.split())<2000
        cover=d[0].get_text().replace('\n',' ').strip()
        assert cover == ('Automatizaciones y asistentes para tu ecommerce. '
                         'Descubre cómo Riverz puede vender, recuperar compras y acompañar a tus clientes con conversaciones en lenguaje natural.')
        assert len([b for b in d[0].get_text('dict')['blocks'] if b['type']==1])==1
        assert all(pg.get_text(clip=pymupdf.Rect(0,0,W,66)).strip()=='riverz' for pg in list(d)[1:])
        # Every capability page is followed immediately by its four examples.
        expected_titles=['Cada asistente']
        for (title,_),(heading,_,_) in zip(GUIDE_AUTOMATIONS,GUIDE_CHAT_PAGES):
            expected_titles.extend([title,heading])
        expected_titles.extend(['Chats, comentarios,',GUIDE_CHAT_PAGES[4][0],'Tu marca define la atención.'])
        assert len(expected_titles)==len(d)-1
        assert all(title in pg.get_text() for title,pg in zip(expected_titles,list(d)[1:]))
        forbidden=['apoyo para el video','qué mostrar','documento original','promesa del anuncio',
                   'demostración','detalles técnicos','integración','flujo','webhook',
                    'Supabase','saldo','credenciales','US$','guion','Qué decir','Busca el problema',
                    'Guía de capacidades']
        assert not any(term.casefold() in alltext.casefold() for term in forbidden), [
            term for term in forbidden if term.casefold() in alltext.casefold()]
        assert not re.search(r'\b(?:demo|API)\b',alltext,re.IGNORECASE)
        assert all(term in alltext for term in ['lenguaje natural','Comentarios en redes',
            'Campañas a tu base de clientes','Llamadas con un agente de voz'])
        # Navigation remains available through bookmarks, outside the clean cover.
        toc=d.get_toc();assert len(toc)==len(GUIDE_SECTIONS)
        assert [entry[2] for entry in toc]==[row[2] for row in GUIDE_SECTIONS],toc
        assert not d[0].get_links()
    else:
        assert all(q in alltext.replace('\n',' ') for q,_ in FAQS)
        assert 'US$259' in alltext and 'US$399' in alltext and '35% OFF' in alltext
    for start in range(0,len(d),4):
        sheet=Image.new('RGB',(1190,1688),'#d7d6d3');dr=ImageDraw.Draw(sheet)
        for j in range(min(4,len(d)-start)):
            im=Image.open(target/f'page-{start+j+1:02}.png');im.thumbnail((580,820))
            x=10+(j%2)*595;y=22+(j//2)*844;sheet.paste(im,(x,y));dr.text((x,y-17),f'Página {start+j+1}',fill='#12201f')
        sheet.save(target/f'contact-{start+1:02}.png')
    (DOCS/path.name).write_bytes(path.read_bytes())
    return {'file':str(path),'pages':len(d),'words':len(alltext.split()),
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'copies_identical':path.read_bytes()==(DOCS/path.name).read_bytes()}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--guide-only',action='store_true',help='Update the client guide without rewriting the commercial proposal.')
    args=parser.parse_args()
    report={}
    if not args.guide_only:
        report['commercial']=verify(commercial(),10)
    report.update({'guide':verify(guide(),13),'recipes':22,'chat_examples':20,'chat_pages':5,'agent_roles':5,
            'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
            'audience':'Clientes de ecommerce; sin instrucciones internas ni notas de grabación.',
            'illustrations':['riverz-flota-original.png','riverz-control-humano.png']})
    (QA/('guide-validation.json' if args.guide_only else 'validation.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
