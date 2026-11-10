import type { GraphData, GraphNode } from "../types";

export type Point = { x: number; y: number };
export type GraphEdge = GraphData["edges"][number];

export const graphNodeStyles = {
  role: { label: "职业", color: "#526e60", fill: "#e5eee7", radius: 29 },
  task: { label: "任务", color: "#527da3", fill: "#e8f0f8", radius: 26 },
  atom: { label: "原子能力", color: "#34836a", fill: "#e3f3eb", radius: 23 },
  knowledge: { label: "课程知识", color: "#9a733a", fill: "#f7efdd", radius: 25 },
};

export const graphRelationLabels = {
  requires: "需要", supports: "支撑", prerequisite: "前置", contains: "包含",
};

// Deterministic layout: fixed iterations, no background simulation or random jitter.
// Type anchors retain a readable knowledge → action → task → career orientation.
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Record<string, Point> {
  const anchors: Record<GraphNode["type"], Point> = {
    knowledge: { x: -430, y: -100 }, atom: { x: -100, y: 130 },
    task: { x: 290, y: -100 }, role: { x: 520, y: 140 },
  };
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const positions: Record<string, Point> = {};
  for (const type of Object.keys(anchors) as GraphNode["type"][]) {
    const group = ordered.filter(node => node.type === type);
    group.forEach((node, index) => {
      const angle = index * 2.399963;
      const radius = 55 * Math.sqrt(index + 1);
      positions[node.id] = {
        x: anchors[type].x + Math.cos(angle) * radius,
        y: anchors[type].y + Math.sin(angle) * radius,
      };
    });
  }
  const links = edges.filter(edge => positions[edge.source] && positions[edge.target] && edge.source !== edge.target);
  for (let step = 0; step < 240; step++) {
    const forces: Record<string, Point> = {};
    for (const node of ordered) {
      const point = positions[node.id];
      forces[node.id] = { x: (anchors[node.type].x - point.x) * .012, y: (anchors[node.type].y - point.y) * .008 };
    }
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i].id, b = ordered[j].id;
        const dx = positions[b].x - positions[a].x || .01;
        const dy = positions[b].y - positions[a].y || .01;
        const distance = Math.hypot(dx, dy);
        const repulsion = Math.min(22, 5500 / (distance * distance));
        const clearance = Math.hypot(dx / 175, dy / 120);
        const collision = Math.max(0, 1 - clearance) * 24;
        const fx = dx / distance * (repulsion + collision);
        const fy = dy / distance * (repulsion + collision);
        forces[a].x -= fx; forces[a].y -= fy;
        forces[b].x += fx; forces[b].y += fy;
      }
    }
    for (const edge of links) {
      const a = positions[edge.source], b = positions[edge.target];
      const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const attraction = (distance - 195) * .012;
      const fx = (b.x - a.x) / distance * attraction;
      const fy = (b.y - a.y) / distance * attraction;
      forces[edge.source].x += fx; forces[edge.source].y += fy;
      forces[edge.target].x -= fx; forces[edge.target].y -= fy;
    }
    const cooling = 1 - step / 300;
    for (const node of ordered) {
      positions[node.id].x += Math.max(-18, Math.min(18, forces[node.id].x)) * cooling;
      positions[node.id].y += Math.max(-18, Math.min(18, forces[node.id].y)) * cooling;
    }
  }
  return positions;
}

export function graphCurve(start: Point, end: Point, startRadius: number, endRadius: number) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < startRadius + endRadius + 12) return null;
  const bend = Math.min(42, distance * .12);
  const control = { x: (start.x + end.x) / 2 - dy / distance * bend, y: (start.y + end.y) / 2 + dx / distance * bend };
  const fromLength = Math.hypot(control.x - start.x, control.y - start.y);
  const toLength = Math.hypot(control.x - end.x, control.y - end.y);
  const from = { x: start.x + (control.x - start.x) / fromLength * (startRadius + 3), y: start.y + (control.y - start.y) / fromLength * (startRadius + 3) };
  const to = { x: end.x + (control.x - end.x) / toLength * (endRadius + 8), y: end.y + (control.y - end.y) / toLength * (endRadius + 8) };
  return {
    path: `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`,
    label: { x: (from.x + 2 * control.x + to.x) / 4, y: (from.y + 2 * control.y + to.y) / 4 },
  };
}
