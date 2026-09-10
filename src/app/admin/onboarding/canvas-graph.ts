import type { Brand } from './data';
import type { PitchCase, PitchDraft } from './pitch-data';
import { renderMessage, templatesForCase, proposedButtons } from './pitch-data';
import { originals, type OriginalTemplate } from './original-templates';
import { automationSnapshot } from './canvas-snapshot';

export interface SnapshotStep {
  id: string;
  parent: string | null;
  branch: string | null;
  position: number;
  type: string;
  config: Record<string, unknown>;
}
export interface SnapshotFlow {
  id: string;
  title: string;
  trigger: string;
  status: string;
  stopOnReply: boolean;
  steps: SnapshotStep[];
}
export interface MapNode {
  id: string;
  title: string;
  body?: string;
  kind: string;
  status?: string;
  buttons?: string[];
  template?: string;
  x: number;
  y: number;
  height: number;
}
export interface MapEdge {
  from: string;
  to: string;
  label?: string;
  example?: boolean;
}
export interface MapSection {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CanvasGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  sections: MapSection[];
  width: number;
  height: number;
}
export const NODE_WIDTH = 320;
type T = (key: string) => string;

function heightFor(
  n: Pick<MapNode, 'title' | 'body' | 'buttons' | 'template'>
) {
  // Deliberately generous: messages are never clipped or internally scrolled.
  const lines = (s: string, width: number) =>
    s
      .split('\n')
      .reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / width)), 0);
  return (
    105 +
    lines(n.title, 24) * 26 +
    (n.body ? lines(n.body, 30) * 23 + 30 : 0) +
    (n.buttons?.length ?? 0) * 38 +
    (n.template ? 48 : 0)
  );
}

function messageData(
  m: OriginalTemplate,
  draft: PitchDraft,
  values: Record<string, string>,
  bindings = m.variables
) {
  const bound = { ...values };
  for (const [key, binding] of Object.entries(bindings)) {
    bound[key] = /tracking|checkout|url/.test(binding)
      ? values.tracking
      : /order_name/.test(binding)
        ? draft.order
        : /total_price/.test(binding)
          ? draft.amount
          : /name/.test(binding)
            ? draft.customer
            : binding;
  }
  return {
    title: m.header || 'WhatsApp',
    template: m.name,
    body: renderMessage(
      [m.header ? '' : null, draft.edits[m.id] ?? m.body, m.footer]
        .filter(Boolean)
        .join('\n\n'),
      bound
    ),
    buttons: m.buttons.map((b) => b.text),
  };
}

function stepTitle(s: SnapshotStep, t: T): string {
  const c = s.config;
  if (s.type === 'wait')
    return `${t('pitch.canvasWait')} ${c.amount} ${t(`pitch.canvas_${c.unit}`)}`;
  if (s.type === 'condition') {
    if (c.subject === 'context_var') return t(`pitch.canvas_${c.value}`);
    return `${t(`pitch.canvas_${c.subject}_${c.value}`)}${c.operand && c.operand !== 'since_trigger' ? ` · ${c.operand}` : ''}`;
  }
  if (s.type === 'set_context')
    return `${t('pitch.canvasBenefit')} ${((c.values ?? {}) as Record<string, number>).benefit_percent}%`;
  return t(`pitch.canvas_${s.type}`);
}

/** Snapshot trees become a DAG, including both empty branches and their continuation.
 * No graph edge is inferred from message wording or from a template button. */
export function flowEdges(flow: SnapshotFlow): MapEdge[] {
  const edges: MapEdge[] = [];
  const scope = (
    parent: string | null,
    branch: string | null,
    continuation: string
  ): string => {
    const steps = flow.steps
      .filter((s) => s.parent === parent && s.branch === branch)
      .sort((a, b) => a.position - b.position);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i],
        next = steps[i + 1]?.id ?? continuation;
      if (s.type === 'condition') {
        for (const b of ['yes', 'no'])
          edges.push({ from: s.id, to: scope(s.id, b, next), label: b });
      } else edges.push({ from: s.id, to: next });
    }
    return steps[0]?.id ?? continuation;
  };
  edges.push({ from: flow.id, to: scope(null, null, `${flow.id}-end`) });
  return edges;
}

export function buildCanvas(
  brand: Brand,
  cases: PitchCase[],
  draft: PitchDraft,
  t: T,
  values: Record<string, string>
): CanvasGraph {
  const graph: CanvasGraph = {
    nodes: [],
    edges: [],
    sections: [],
    width: 0,
    height: 0,
  };
  const add = (n: Omit<MapNode, 'height'>) => {
    const node = { ...n, height: heightFor(n) };
    graph.nodes.push(node);
    return node;
  };
  const root = add({
    id: 'brand',
    title: draft.name,
    body: draft.site,
    kind: 'brand',
    x: 80,
    y: 40,
  });
  let rowY = root.y + root.height + 150;
  let columnX = 80,
    rowHeight = 0;
  const flows = [...(automationSnapshot[brand] ?? [])].sort(
    (a, b) => Number(b.status === 'active') - Number(a.status === 'active')
  );
  // Each automation occupies its own bounded lane, with its real step tree.
  for (const [flowIndex, flow] of flows.entries()) {
    const local: MapNode[] = [];
    const make = (n: Omit<MapNode, 'height' | 'x' | 'y'>) => {
      const node = { ...n, x: 0, y: 0, height: heightFor(n) };
      local.push(node);
      return node;
    };
    make({
      id: flow.id,
      title: t(flow.title),
      body: `${t(`pitch.canvas_${flow.trigger}`)}${flow.stopOnReply ? `\n${t('pitch.canvasStopReply')}` : ''}`,
      kind: 'trigger',
      status: flow.status,
    });
    for (const step of flow.steps) {
      const template =
        (originals[brand] ?? []).find(
          (m) =>
            m.name === step.config.template_name &&
            m.buttons.some((b) => b.urlVariable)
        ) ??
        (originals[brand] ?? []).find(
          (m) => m.name === step.config.template_name
        );
      make({
        id: step.id,
        title: stepTitle(step, t),
        kind: step.type,
        status: flow.status,
        ...(template
          ? messageData(
              template,
              draft,
              values,
              step.config.variables as Record<string, string>
            )
          : {}),
      });
    }
    make({ id: `${flow.id}-end`, title: t('pitch.canvasEnd'), kind: 'end' });
    const edges = flowEdges(flow);
    const ranks = new Map(local.map((n) => [n.id, 0]));
    // Longest path puts joins AFTER both branches. Snapshots are acyclic trees.
    for (let i = 0; i < local.length; i++)
      for (const e of edges)
        ranks.set(
          e.to,
          Math.max(ranks.get(e.to) ?? 0, (ranks.get(e.from) ?? 0) + 1)
        );
    const layers = [...new Set(ranks.values())]
      .sort((a, b) => a - b)
      .map((rank) => local.filter((n) => ranks.get(n.id) === rank));
    const width = Math.max(...layers.map((l) => l.length)) * 380 + 80;
    if (flowIndex && flowIndex % 3 === 0) {
      rowY += rowHeight + 130;
      columnX = 80;
      rowHeight = 0;
    }
    let y = rowY + 90;
    for (const layer of layers) {
      layer.forEach((n, i) => {
        n.x = columnX + (width - layer.length * 380) / 2 + i * 380;
        n.y = y;
      });
      y += Math.max(...layer.map((n) => n.height)) + 85;
    }
    const section = {
      id: flow.id,
      title: t(flow.title),
      x: columnX,
      y: rowY,
      width,
      height: y - rowY + 20,
    };
    graph.sections.push(section);
    graph.nodes.push(...local);
    graph.edges.push(...edges, { from: root.id, to: flow.id, example: true });
    rowHeight = Math.max(rowHeight, section.height);
    columnX += width + 90;
  }
  rowY += rowHeight + (flows.length ? 180 : 0);
  // Scenario branches remain visible together. Dashed connectors identify examples,
  // not extra sends secretly appended to the production automation.
  for (let group = 0; group < 5; group++) {
    const groupCases = cases.filter((c) => c.group === group);
    const x = 80 + group * 1160;
    const hub = add({
      id: `group-${group}`,
      title: t(`onboarding.step${group}`),
      kind: 'hub',
      x,
      y: rowY + 80,
    });
    graph.edges.push({ from: root.id, to: hub.id, example: true });
    let y = hub.y + hub.height + 110;
    for (const c of groupCases) {
      const startY = y;
      const entry = add({
        id: c.id,
        title: t(c.title),
        kind: c.ai ? 'ai' : 'scenario',
        status: c.source,
        x,
        y,
      });
      graph.edges.push({ from: hub.id, to: entry.id, example: true });
      y += entry.height + 70;
      let previous = entry.id;
      c.path.forEach((key, i) => {
        const n = add({
          id: `${c.id}-path-${i}`,
          title: t(key),
          kind:
            i === 0 ? 'trigger' : i === c.path.length - 1 ? 'end' : 'action',
          x,
          y,
        });
        graph.edges.push({ from: previous, to: n.id });
        previous = n.id;
        y += n.height + 65;
      });
      let messageY = startY;
      const templates = templatesForCase(brand, c);
      const exampleNodes = templates.map((m) => ({
        ...messageData(m, draft, values),
        key: m.id,
        kind: 'send_template',
      }));
      if (!templates.length && c.example)
        exampleNodes.push({
          title: t(c.ai ? 'pitch.aiExample' : 'pitch.proposal'),
          body: renderMessage(
            draft.edits[c.id] ?? t(`pitch.msg_${c.example}`),
            values
          ),
          buttons: proposedButtons(c.example).map(t),
          template: '',
          key: c.id,
          kind: c.example === 'voice' ? 'voice_call' : 'send_message',
        });
      for (const [i, m] of exampleNodes.entries()) {
        const n = add({
          id: `${c.id}-message-${i}`,
          title: m.title,
          body: m.body,
          buttons: m.buttons,
          template: m.template,
          kind: m.kind,
          status: c.source,
          x: x + 460,
          y: messageY,
        });
        graph.edges.push({
          from: entry.id,
          to: n.id,
          label: 'example',
          example: true,
        });
        messageY += n.height + 50;
      }
      if (!exampleNodes.length) {
        const n = add({
          id: `${c.id}-silent`,
          title: t('pitch.canvasNoMessage'),
          kind: 'end',
          x: x + 460,
          y: startY,
        });
        graph.edges.push({ from: entry.id, to: n.id, example: true });
        messageY += n.height;
      }
      y = Math.max(y, messageY) + 140;
    }
    graph.sections.push({
      id: `section-${group}`,
      title: t(`onboarding.step${group}`),
      x: x - 30,
      y: rowY,
      width: 1040,
      height: y - rowY,
    });
  }
  graph.width = Math.max(...graph.sections.map((s) => s.x + s.width)) + 100;
  graph.height = Math.max(...graph.sections.map((s) => s.y + s.height)) + 100;
  return graph;
}
