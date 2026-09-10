import {
  CARD_HALF,
  BRANCH_SPINE,
} from '@/components/automations/canvas-geometry';
import type {
  CanvasGraph,
  MapEdge,
  MapNode,
  SnapshotFlow,
} from './canvas-graph';
import type { PitchCase } from './pitch-data';

export const COLUMN_GAP = 160;
export const NODE_WIDTH = 320;
const COLUMN = NODE_WIDTH + COLUMN_GAP;
const ROW_GAP = 100;

/** Like BranchFan: the parent port is centered between the first and last
 * child ports, and each child owns the full height of its subtree. */
export function arrangeTree(
  rootId: string,
  nodes: MapNode[],
  edges: MapEdge[]
) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visit = (
    id: string,
    x: number
  ): { items: MapNode[]; height: number; rootY: number } => {
    const node = byId.get(id)!;
    const children = edges
      .filter((e) => e.from === id)
      .map((e) => visit(e.to, x + COLUMN));
    let bottom = 0;
    const anchors: number[] = [];
    const items: MapNode[] = [];
    for (const child of children) {
      anchors.push(bottom + child.rootY);
      child.items.forEach((n) => {
        n.y += bottom;
      });
      items.push(...child.items);
      bottom += child.height + ROW_GAP;
    }
    node.x = x;
    node.y = anchors.length
      ? (anchors[0] + anchors[anchors.length - 1]) / 2
      : 0;
    return {
      items: [node, ...items],
      rootY: node.y,
      height: Math.max(node.y + node.height, bottom ? bottom - ROW_GAP : 0),
    };
  };
  return visit(rootId, 0);
}

export function horizontalLayout(
  graph: CanvasGraph,
  flows: SnapshotFlow[],
  cases: PitchCase[]
): CanvasGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let y = 80;
  // Repeat only terminal markers, never actions or messages. Both empty
  // branches stay explicit, instead of crossing other lanes to one distant end.
  for (const flow of flows) {
    const local = graph.nodes.filter(
      (n) => n.id === flow.id || n.id.startsWith(`${flow.id}-`)
    );
    const end = byId.get(`${flow.id}-end`)!;
    let endings = 0;
    for (const edge of graph.edges.filter((e) => e.to === end.id)) {
      if (endings++) {
        const clone = { ...end, id: `${end.id}-${endings}` };
        graph.nodes.push(clone);
        local.push(clone);
        byId.set(clone.id, clone);
        edge.to = clone.id;
      }
    }
    const ids = new Set(local.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const layout = arrangeTree(flow.id, local, edges);
    layout.items.forEach((n) => {
      n.x += 560;
      n.y += y;
    });
    const section = graph.sections.find((s) => s.id === flow.id)!;
    Object.assign(section, {
      x: 520,
      y: y - 40,
      width: Math.max(...local.map((n) => n.x + NODE_WIDTH)) - 480,
      height: layout.height + 80,
    });
    y += layout.height + 180;
  }
  for (let group = 0; group < 5; group++) {
    const start = y;
    const entries: MapNode[] = [];
    let width = 0;
    for (const c of cases.filter((c) => c.group === group)) {
      const entry = byId.get(c.id)!;
      const path = c.path.map((_, i) => byId.get(`${c.id}-path-${i}`)!);
      const examples = graph.nodes.filter(
        (n) => n.id.startsWith(`${c.id}-message-`) || n.id === `${c.id}-silent`
      );
      const row = [entry, ...path, ...examples];
      row.forEach((n, i) => {
        n.x = 560 + i * COLUMN;
        n.y = y;
      });
      entries.push(entry);
      width = Math.max(width, row[row.length - 1].x + NODE_WIDTH);
      y += Math.max(...row.map((n) => n.height)) + 180;
    }
    const hub = byId.get(`group-${group}`)!;
    hub.x = 80;
    hub.y = entries.length
      ? (entries[0].y + entries[entries.length - 1].y) / 2
      : y;
    const section = graph.sections.find((s) => s.id === `section-${group}`)!;
    Object.assign(section, {
      x: 40,
      y: start - 60,
      width: Math.max(width, NODE_WIDTH + 80),
      height: Math.max(y - start, hub.height) + 100,
    });
    y = Math.max(y, hub.y + hub.height) + 100;
  }
  const root = byId.get('brand')!;
  root.x = 80;
  root.y = 0;
  graph.width = Math.max(...graph.nodes.map((n) => n.x + NODE_WIDTH)) + 100;
  graph.height = Math.max(...graph.nodes.map((n) => n.y + n.height)) + 100;
  return graph;
}

/** Straight header-to-header rails, matching BranchFan's rightward trunk,
 * vertical spine and labels mounted directly on the branch. */
export function horizontalEdge(a: MapNode, b: MapNode, e: MapEdge) {
  const x1 = a.x + NODE_WIDTH,
    y1 = a.y + CARD_HALF;
  const x2 = b.x,
    y2 = b.y + CARD_HALF;
  const spine = x1 + BRANCH_SPINE;
  let path = `M${x1},${y1} H${spine} V${y2} H${x2}`;
  let labelX = spine + (x2 - spine) / 2,
    labelY = y2;
  if (e.example && a.id === 'brand') {
    path = `M${a.x},${y1} H20 V${b.y - 32} H${b.x - 24} V${y2} H${b.x}`;
  } else if (e.example && x2 > x1 + COLUMN_GAP + 1) {
    // Message examples are annotations, not extra execution steps. Their
    // dashed rail goes above the intervening actions instead of through them.
    const rail = a.y - 45;
    path = `M${x1},${y1} H${spine} V${rail} H${x2 - 28} V${y2} H${x2}`;
    labelX = x2 - 110;
    labelY = rail;
  }
  return { path, labelX, labelY };
}
