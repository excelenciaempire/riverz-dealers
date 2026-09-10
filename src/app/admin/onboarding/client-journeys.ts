import type { Brand } from './data';
import type { PitchCase, PitchDraft } from './pitch-data';
import { proposedButtons, renderMessage, templatesForCase } from './pitch-data';
import type { CanvasGraph, MapNode } from './canvas-graph';
import { NODE_WIDTH } from './horizontal-layout';

export const journeyIds = [
  'advice',
  'social',
  'recovery',
  'orders',
  'delivery',
  'changes',
  'loyalty',
  'protection',
] as const;
export type JourneyId = (typeof journeyIds)[number];
const concepts: Record<string, JourneyId> = {
  catalog: 'advice',
  checkout: 'advice',
  health: 'advice',
  comments: 'social',
  cart: 'recovery',
  rejected: 'recovery',
  offer: 'recovery',
  order: 'orders',
  receipt: 'orders',
  voice: 'orders',
  address: 'orders',
  codpayment: 'orders',
  tracking: 'delivery',
  incident: 'delivery',
  pickup: 'delivery',
  refusal: 'delivery',
  collection: 'delivery',
  returns: 'changes',
  care: 'loyalty',
  satisfaction: 'loyalty',
  repeat: 'loyalty',
  silence: 'loyalty',
  handoff: 'protection',
  optout: 'protection',
  guard: 'protection',
  deliveryfailure: 'protection',
};
const auditConcepts = [
  'catalog',
  'checkout',
  'comments',
  'comments',
  'comments',
  'health',
  'cart',
  'cart',
  'rejected',
  'cart',
  'rejected',
  'rejected',
  'order',
  'order',
  'order',
  'order',
  'order',
  'order',
  'order',
  'order',
  'order',
  'tracking',
  'tracking',
  'incident',
  'receipt',
  'returns',
  'pickup',
  'silence',
  'care',
  'voice',
  'handoff',
  'optout',
  'guard',
  'deliveryfailure',
];
const designConcepts: Record<string, string> = {
  pending: 'order',
  benefit: 'order',
  confirm: 'order',
  change: 'returns',
};
export function conceptFor(c: PitchCase): string | null {
  // Activating drafts is an implementation task, not another customer situation.
  if (c.id === 'audit-35') return null;
  if (c.id.startsWith('audit-'))
    return auditConcepts[Number(c.id.slice(6)) - 1];
  const id = c.id.replace('design-', '');
  return designConcepts[id] ?? id;
}
export function journeyFor(c: PitchCase): JourneyId | null {
  const concept = conceptFor(c);
  return concept ? concepts[concept] : null;
}
export function groupJourneyCases(cases: PitchCase[], journey: JourneyId) {
  const groups = new Map<string, PitchCase[]>();
  for (const c of cases.filter((c) => journeyFor(c) === journey)) {
    const key = conceptFor(c)!;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([id, members]) => ({ id, members }));
}

type T = (key: string) => string;
export function buildClientCanvas(
  brand: Brand,
  cases: PitchCase[],
  draft: PitchDraft,
  t: T,
  values: Record<string, string>,
  expanded: string[]
): CanvasGraph {
  const graph: CanvasGraph = {
    nodes: [],
    edges: [],
    sections: [],
    width: 0,
    height: 0,
  };
  function add(n: Omit<MapNode, 'height'>) {
    const lines = (text: string, width: number) =>
      text
        .split('\n')
        .reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / width)), 0);
    const node = {
      ...n,
      height:
        135 +
        lines(n.title, 24) * 26 +
        (n.body ? lines(n.body, 30) * 23 : 0) +
        (n.buttons?.length ?? 0) * 38 +
        (n.template ? 48 : 0),
    };
    graph.nodes.push(node);
    return node;
  }
  const root = add({
    id: 'brand',
    title: draft.name,
    body: draft.site,
    kind: 'brand',
    x: 80,
    y: 0,
  });
  let y = 100;
  for (const journey of journeyIds) {
    const applicable = cases.filter(
      (c) =>
        !(draft.model === 'prepaid' && /^audit-(16|17|18|19|20|21)$/.test(c.id))
    );
    const groups = groupJourneyCases(applicable, journey);
    if (!groups.length) continue;
    const entry = add({
      id: `journey-${journey}`,
      title: t(`pitch.journey_${journey}`),
      body: t(`pitch.value_${journey}`),
      kind: 'journey',
      caption: t('pitch.clientGoal'),
      x: 560,
      y,
    });
    graph.edges.push({ from: root.id, to: entry.id, example: true });
    const start = y;
    // A template used by several outcomes is shown once per business journey.
    const shownMessages = new Map<string, MapNode>();
    const branches = expanded.includes(entry.id)
      ? groups
      : [{ id: journey, members: groups.flatMap((g) => g.members) }];
    const anchors: number[] = [];
    for (const branch of branches) {
      const primary =
        branch.members.find((c) => templatesForCase(brand, c).length) ??
        branch.members.find((c) => c.example) ??
        branch.members[0];
      const isExpanded = expanded.includes(entry.id);
      const audited = branch.members.filter((c) => c.source !== 'proposal');
      const summaries = [
        ...new Set(
          (audited.length ? audited : branch.members).map(
            (c) =>
              `${t(c.title)}\n${t(`pitch.${c.source}`)} · ${t(c.path[c.path.length - 1])}`
          )
        ),
      ];
      const action = add({
        id: `${entry.id}-${branch.id}`,
        title: isExpanded
          ? t(`pitch.concept_${branch.id}`)
          : t('pitch.clientAction'),
        body: isExpanded
          ? summaries.join('\n\n')
          : t(`pitch.action_${journey}`),
        kind: 'action',
        caption: t(
          isExpanded ? 'pitch.clientVariants' : 'pitch.clientBlueprint'
        ),
        x: 1040,
        y,
      });
      anchors.push(y);
      graph.edges.push({ from: entry.id, to: action.id });
      const templateCases = isExpanded ? branch.members : [primary];
      const originals = [
        ...new Map(
          templateCases.flatMap((c) =>
            templatesForCase(brand, c).map((m) => [m.id, { m, c }] as const)
          )
        ).values(),
      ];
      let messageBottom = y;
      for (const { m, c } of originals) {
        let message = shownMessages.get(m.id);
        if (!message) {
          const bound = { ...values };
          for (const [k, v] of Object.entries(m.variables))
            bound[k] = /tracking|checkout|url/.test(v)
              ? values.tracking
              : /order_name/.test(v)
                ? draft.order
                : /total_price/.test(v)
                  ? draft.amount
                  : /name/.test(v)
                    ? draft.customer
                    : v;
          message = add({
            id: `${entry.id}-${m.id}`,
            title: m.header || 'WhatsApp',
            template: m.name,
            body: renderMessage(
              [draft.edits[m.id] ?? m.body, m.footer]
                .filter(Boolean)
                .join('\n\n'),
              bound
            ),
            buttons: m.buttons.map((b) => b.text),
            kind: 'send_template',
            status: c.source,
            x: 1520,
            y: messageBottom,
          });
          shownMessages.set(m.id, message);
          messageBottom += message.height + 70;
        }
        graph.edges.push({
          from: action.id,
          to: message.id,
          label: 'example',
          example: true,
        });
      }
      if (!originals.length && primary.example) {
        const example = primary.example;
        let message = shownMessages.get(example);
        if (!message) {
          message = add({
            id: `${entry.id}-example-${example}`,
            title: t(primary.ai ? 'pitch.aiExample' : 'pitch.proposal'),
            body: renderMessage(
              draft.edits[primary.id] ?? t(`pitch.msg_${example}`),
              values
            ),
            buttons: proposedButtons(example).map(t),
            kind: example === 'voice' ? 'voice_call' : 'send_message',
            status: primary.source,
            x: 1520,
            y,
          });
          shownMessages.set(example, message);
          messageBottom = y + message.height;
        }
        graph.edges.push({
          from: action.id,
          to: message.id,
          label: 'example',
          example: true,
        });
      }
      y = Math.max(y + action.height, messageBottom) + 150;
    }
    entry.y = (anchors[0] + anchors[anchors.length - 1]) / 2;
    y = Math.max(y, entry.y + entry.height + 100);
    graph.sections.push({
      id: entry.id,
      title: entry.title,
      x: 520,
      y: start - 60,
      width: 1360,
      height: y - start + 60,
    });
    y += 80;
  }
  graph.width = Math.max(...graph.nodes.map((n) => n.x + NODE_WIDTH)) + 100;
  graph.height = Math.max(...graph.nodes.map((n) => n.y + n.height)) + 100;
  return graph;
}
