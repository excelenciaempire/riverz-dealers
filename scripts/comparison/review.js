const pages = [['inbox', 'Bandeja', 'Inbox'], ['rules', 'Reglas', 'Rules'], ['documents', 'Documentos', 'Documents'], ['reports', 'Reportes', 'Reports'], ['flows', 'Flujos', 'Flows'], ['returns', 'Postventa', 'After-sales'], ['orders', 'Pedidos', 'Orders'], ['connections', 'HTTP propio', 'Custom HTTP'], ['templates', 'Plantillas', 'Templates'], ['campaigns', 'Campañas', 'Campaigns'], ['automations', 'Automatizaciones', 'Automations'], ['mobile', 'Móvil', 'Mobile'], ['release', 'Lanzamiento', 'Launch'], ['migrations','Migraciones','Migrations'],['help','Ayuda','Help'],['voice','Llamadas','Calls'],['voice-mailbox','Buzón','Voicemail'],['voice-whatsapp','Voz por WhatsApp','WhatsApp voice']];
const params = new URLSearchParams(location.search);
const page = document.getElementById('page'), locale = document.getElementById('locale');
locale.value = params.get('locale') === 'en' ? 'en' : 'es';
for (const [value, es, en] of pages) page.add(new Option(locale.value === 'es' ? es : en, value));
page.value = pages.some(item => item[0] === params.get('page')) ? params.get('page') : 'inbox';
function update() {
  const es = locale.value === 'es';
  document.documentElement.lang = locale.value;
  document.getElementById('title').textContent = es ? 'Riverz: actual y mejoras' : 'Riverz: current and improvements';
  document.getElementById('scope').textContent = es ? 'Comparación privada de controles reales con datos ficticios. No reproduce todas las pantallas completas. Campañas, plantillas, automatizaciones y precios se conservan. Envíos y operaciones externas bloqueados.' : 'Private comparison of real controls with fictional data. It does not reproduce every complete screen. Campaigns, templates, automations and pricing are preserved. Sending and external operations are blocked.';
  document.getElementById('page-label').textContent = es ? 'Sección' : 'Section';
  document.getElementById('current-title').textContent = es ? 'Actual · mejoras visuales apagadas' : 'Current · visual additions disabled';
  document.getElementById('new-title').textContent = es ? 'Mejoras · revisión privada' : 'Improvements · private review';
  document.getElementById('expand').textContent = es ? 'Abrir detalles nuevos' : 'Expand new details';
  const single = document.getElementById('single');single.textContent = es ? 'Ver mejoras a ancho completo' : 'View improvements at full width';
  single.href = '/?' + new URLSearchParams({ stage: 'comparison', locale: locale.value, page: page.value });
  for (const option of page.options) option.textContent = pages.find(item => item[0] === option.value)[es ? 1 : 2];
  for (const [id, stage] of [['current', 'current'], ['new', 'comparison']]) document.getElementById(id).src = '/?' + new URLSearchParams({ stage, locale: locale.value, page: page.value, embedded: '1' });
  history.replaceState(null, '', '/compare?' + new URLSearchParams({ locale: locale.value, page: page.value }));
}
page.addEventListener('change', update);locale.addEventListener('change', update);
document.getElementById('expand').addEventListener('click', () => document.getElementById('new').contentDocument?.querySelectorAll('main details').forEach(detail => { detail.open = true; }));
update();
