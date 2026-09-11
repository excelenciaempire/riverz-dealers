import type { Brand } from './data';
import type { PitchCase, PitchDraft } from './pitch-data';
import { proposedButtons, renderMessage, templatesForCase } from './pitch-data';
import type { CanvasGraph, MapNode } from './canvas-graph';
import { buildCanvas } from './canvas-graph';
import { automationSnapshot } from './canvas-snapshot';
import { NODE_WIDTH } from './horizontal-layout';
import { operationCatalog } from '@/lib/i18n/messages/pitch-operations';

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
  expanded: string[],
  routeChoices: Record<string, string> = {}
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
        (n.note ? 32 + lines(n.note, 34) * 20 : 0) +
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
  function operationTree(
    scenario: (typeof operationCatalog)[number],
    id: string,
    x: number,
    top: number,
    inline = false
  ): { trigger: MapNode; bottom: number; right: number } {
    const text = (field: string) =>
      renderMessage(
        t(
          `pitch.operation_${scenario.id}_${field}${field === 'reply' && ['recommend', 'care'].includes(scenario.id) ? `_${brand}` : ''}`
        ),
        values
      );
    const trigger = add({
      id,
      title: text('title'),
      body: text('customer'),
      caption: t('pitch.operationCustomer'),
      kind: inline ? 'inline_route' : 'scenario',
      status: 'proposal',
      x,
      y: top,
    });
    const reply = add({
      id: `${id}-reply`,
      title: t(
        scenario.id === 'silence'
          ? 'pitch.canvasNoMessage'
          : 'pitch.operationReply'
      ),
      body: text('reply'),
      caption: t('pitch.operationDesign'),
      kind: scenario.id === 'silence' ? 'wait' : 'send_message',
      status: 'proposal',
      x: x + 480,
      y: top,
    });
    const decision = add({
      id: `${id}-decision`,
      title: t('pitch.operationDecision'),
      caption: t('pitch.operationDesign'),
      kind: 'condition',
      routes: [
        'human',
        'silence',
        'topic',
        'media',
        'optout',
        'unknown',
        'failure',
        'identity',
      ]
        .filter((route) => route !== scenario.id)
        .map((route) => `operation-${route}`),
      x: x + 960,
      y: top,
    });
    graph.edges.push(
      { from: trigger.id, to: reply.id },
      { from: reply.id, to: decision.id }
    );
    const chosen = decision.routes?.includes(routeChoices[decision.id])
      ? operationCatalog.find(
          (s) => `operation-${s.id}` === routeChoices[decision.id]
        )
      : undefined;
    let bottom: number;
    let right: number;
    if (chosen) {
      const branch = operationTree(
        chosen,
        `${decision.id}-inline-${chosen.id}`,
        x + 1440,
        top,
        true
      );
      graph.edges.push({ from: decision.id, to: branch.trigger.id });
      bottom = branch.bottom;
      right = branch.right;
    } else {
      function outcome(field: string) {
        const content = text(field);
        const title = content.split('\n')[0];
        const message = content.match(/[«“]([\s\S]*?)[»”]/);
        return message
          ? {
              title,
              body: message[1],
              note: content
                .slice(content.indexOf(message[0]) + message[0].length)
                .trim(),
            }
          : {
              title,
              body: content.split('\n').slice(1).join('\n'),
              kind: 'end',
            };
      }
      const success = add({
        id: `${id}-success`,
        caption: t('pitch.operationDesign'),
        kind: 'send_message',
        status: 'proposal',
        x: x + 1440,
        y: top,
        ...outcome('success'),
      });
      const exception = add({
        id: `${id}-exception`,
        caption: t('pitch.operationDesign'),
        kind: 'send_message',
        status: 'proposal',
        x: x + 1440,
        y: top + success.height + 80,
        ...outcome('exception'),
      });
      decision.y = (success.y + exception.y) / 2;
      graph.edges.push(
        { from: decision.id, to: success.id },
        { from: decision.id, to: exception.id }
      );
      bottom = exception.y + exception.height;
      right = exception.x + NODE_WIDTH;
    }
    return {
      trigger,
      bottom: Math.max(
        bottom,
        ...[trigger, reply, decision].map((n) => n.y + n.height)
      ),
      right,
    };
  }
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
      const summaries = [
        ...new Set(
          branch.members.map(
            (c) =>
              `${t(c.title)}\n${t(`pitch.${c.source}`)}\n${c.path.map(t).join('\n')}`
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
      const exampleCases = isExpanded
        ? branch.members
        : originals.length
          ? []
          : [primary];
      for (const exampleCase of exampleCases.filter((c) => c.example)) {
        const example = exampleCase.example!;
        let message = shownMessages.get(example);
        if (!message) {
          message = add({
            id: `${entry.id}-example-${example}`,
            title: t(exampleCase.ai ? 'pitch.aiExample' : 'pitch.proposal'),
            body: renderMessage(
              draft.edits[exampleCase.id] ?? t(`pitch.msg_${example}`),
              values
            ),
            buttons: proposedButtons(example).map(t),
            kind: example === 'voice' ? 'voice_call' : 'send_message',
            status: exampleCase.source,
            x: 1520,
            y: messageBottom,
          });
          shownMessages.set(example, message);
          messageBottom += message.height + 70;
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
    if (expanded.includes(entry.id)) {
      for (const scenario of operationCatalog.filter(
        (s) =>
          s.journey === journey &&
          (!('models' in s) ||
            (s.models as readonly string[]).includes(draft.model))
      )) {
        const id = `operation-${scenario.id}`;
        const { trigger, bottom, right } = operationTree(scenario, id, 1040, y);
        graph.edges.push({ from: entry.id, to: trigger.id });
        anchors.push(trigger.y);
        graph.sections.push({
          id,
          title: `${entry.title} · ${trigger.title}`,
          x: 1000,
          y: y - 40,
          width: right - 1000 + 50,
          height: bottom - y + 80,
        });
        y = bottom + 180;
      }
    }
    entry.y = (anchors[0] + anchors[anchors.length - 1]) / 2;
    y = Math.max(y, entry.y + entry.height + 100);
    graph.sections.push({
      id: entry.id,
      title: entry.title,
      x: 520,
      y: start - 60,
      width: expanded.includes(entry.id) ? 2320 : 1360,
      height: y - start + 60,
    });
    y += 80;
  }
  // Keep the literal production/draft trees on the same full canvas. The sales
  // scenarios above are proposed conversation examples, not replacements for them.
  if (expanded.length) {
    const flows = automationSnapshot[brand] ?? [];
    const actual = buildCanvas(brand, [], draft, t, values);
    const flowNodes = actual.nodes.filter((n) =>
      flows.some((f) => n.id === f.id || n.id.startsWith(`${f.id}-`))
    );
    const ids = new Set(flowNodes.map((n) => n.id));
    graph.nodes.push(...flowNodes.map((n) => ({ ...n, y: n.y + y })));
    graph.edges.push(
      ...actual.edges.filter(
        (e) => ids.has(e.to) && (ids.has(e.from) || e.from === 'brand')
      )
    );
    graph.sections.push(
      ...actual.sections
        .filter((s) => flows.some((f) => f.id === s.id))
        .map((s) => ({ ...s, y: s.y + y }))
    );
  }
  graph.width = Math.max(...graph.nodes.map((n) => n.x + NODE_WIDTH)) + 100;
  graph.height = Math.max(...graph.nodes.map((n) => n.y + n.height)) + 100;
  return graph;
}
