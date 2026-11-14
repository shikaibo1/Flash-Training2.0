import type { GraphNode } from '../types';
import type { Point } from './graphLayout';

export type GraphPreferences = {
  offsets: Record<string, Point>;
  focused: boolean;
  showLabels: boolean;
  showEvidence: boolean;
};

export function readGraphPreferences(key: string, nodes: GraphNode[]): GraphPreferences & { error: string } {
  const defaults = { offsets: {}, focused: false, showLabels: false, showEvidence: true, error: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || saved.version !== 1) return defaults;
    const offsets: Record<string, Point> = {};
    for (const node of nodes) {
      const point = saved.offsets?.[node.id];
      if (point && typeof point.x === 'number' && typeof point.y === 'number' &&
          Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e6 && Math.abs(point.y) <= 1e6) {
        offsets[node.id] = { x: point.x, y: point.y };
      }
    }
    return { offsets, focused: saved.focused === true, showLabels: saved.showLabels === true,
      showEvidence: saved.showEvidence !== false, error: '' };
  } catch {
    return { ...defaults, error: '无法恢复已保存的布局，本次使用默认布局。' };
  }
}
