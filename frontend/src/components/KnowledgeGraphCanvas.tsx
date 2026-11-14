import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { BookOpen, BriefcaseBusiness, Focus, Layers3, Maximize2, Minus, Plus, RotateCcw, Workflow } from "lucide-react";
import type { EvidenceData, GraphData, GraphNode } from "../types";
import { graphCurve, graphNodeStyles, graphRelationLabels, layoutGraph } from "../lib/graphLayout";
import type { Point } from "../lib/graphLayout";
import type { ProjectGraphPlan } from '../types/goalGraph';
import { statusColors, statusLabels, statusSymbols } from '../lib/evidence';
import { readGraphPreferences } from '../lib/graphPreferences';

type Camera = { x: number; y: number; scale: number };
type Gesture = {
  pointerId: number; start: Point; camera: Camera; node?: GraphNode;
  origin?: Point; moved: boolean;
};
type Props = {
  graph: GraphData; nodes: GraphNode[]; matchingIds: Set<string>;
  selectedId?: string; evidence: EvidenceData | null;
  plan?: ProjectGraphPlan | null;
  storageKey: string;
  onSelect: (node: GraphNode) => void;
};
const icons = { role: BriefcaseBusiness, task: Workflow, atom: Layers3, knowledge: BookOpen };
const MIN_SCALE = .15, MAX_SCALE = 3;
const clampScale = (scale: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));

function localPoint(svg: SVGSVGElement | null, clientX: number, clientY: number): Point | null {
  const matrix = svg?.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

export default function KnowledgeGraphCanvas({ graph, nodes, matchingIds, selectedId, evidence, plan, storageKey, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const markerId = useId().replace(/:/g, "");
  const helpId = useId();
  const [size, setSize] = useState({ width: 1000, height: 620 });
  const [savedPreferences] = useState(() => readGraphPreferences(storageKey, graph.nodes));
  const [storageError, setStorageError] = useState(savedPreferences.error);
  const [offsets, setOffsets] = useState<Record<string, Point>>(savedPreferences.offsets);
  const [storedCamera, setStoredCamera] = useState<{ key: string; value: Camera } | null>(null);
  const [focused, setFocused] = useState(savedPreferences.focused);
  const [showLabels, setShowLabels] = useState(savedPreferences.showLabels);
  const [showEvidence, setShowEvidence] = useState(savedPreferences.showEvidence);
  // Save after a render, and cancel an obsolete save if preferences change again.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ version: 1, offsets, focused, showLabels, showEvidence }));
        setStorageError(savedPreferences.error);
      } catch { setStorageError('布局偏好无法保存；当前仍可拖动浏览，刷新后可能丢失。'); }
    });
    return () => { active = false; };
  }, [storageKey, offsets, focused, showLabels, showEvidence, savedPreferences.error]);
  const initialPositions = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes, graph.edges]);
  const positions = useMemo(() => ({ ...initialPositions, ...offsets }), [initialPositions, offsets]);
  const scopedIds = new Set(nodes.map(node => node.id));
  const activeId = selectedId && scopedIds.has(selectedId) ? selectedId : undefined;
  const activeNode = nodes.find(node => node.id === activeId);
  const neighbors = new Set<string>(activeId ? [activeId] : []);
  for (const edge of graph.edges) {
    if (edge.source === activeId) neighbors.add(edge.target);
    if (edge.target === activeId) neighbors.add(edge.source);
  }
  const focusActive = focused && Boolean(activeId);
  const visible = focusActive ? nodes.filter(node => neighbors.has(node.id)) : nodes;
  const visibleIds = new Set(visible.map(node => node.id));
  const links = graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  // Selecting a node in the full map does not reset its layout or camera.
  const viewKey = JSON.stringify(visible.map(node => node.id).sort());
  const autoCamera = (): Camera => {
    if (!visible.length) return { x: size.width / 2, y: size.height / 2, scale: 1 };
    const points = visible.map(node => positions[node.id]);
    const minX = Math.min(...points.map(point => point.x)) - 100;
    const maxX = Math.max(...points.map(point => point.x)) + 100;
    const minY = Math.min(...points.map(point => point.y)) - 55;
    const maxY = Math.max(...points.map(point => point.y)) + 120;
    const scale = Math.min(1.25, clampScale(Math.min((size.width - 48) / (maxX - minX), (size.height - 48) / (maxY - minY))));
    return { x: size.width / 2 - (minX + maxX) / 2 * scale, y: size.height / 2 - (minY + maxY) / 2 * scale, scale };
  };
  const camera = storedCamera?.key === viewKey ? storedCamera.value : autoCamera();
  const setCamera = (value: Camera) => setStoredCamera({ key: viewKey, value });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        setStoredCamera(null);
      }
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const zoom = (factor: number, anchor = { x: size.width / 2, y: size.height / 2 }) => {
    const scale = clampScale(camera.scale * factor);
    setCamera({ scale, x: anchor.x - (anchor.x - camera.x) * scale / camera.scale, y: anchor.y - (anchor.y - camera.y) * scale / camera.scale });
  };

  // Native non-passive wheel handling is limited to modifier+wheel; ordinary page scrolling stays available.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (gesture.current) return;
      const point = localPoint(svg, event.clientX, event.clientY);
      if (!point) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const scale = clampScale(camera.scale * Math.exp(-Math.max(-120, Math.min(120, delta)) * .003));
      setStoredCamera({ key: viewKey, value: { scale, x: point.x - (point.x - camera.x) * scale / camera.scale, y: point.y - (point.y - camera.y) * scale / camera.scale } });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [camera.x, camera.y, camera.scale, viewKey, size.height]);

  const startDrag = (event: PointerEvent<SVGElement>, node?: GraphNode) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    const point = localPoint(svgRef.current, event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    svgRef.current?.setPointerCapture(event.pointerId);
    setCamera(camera); // Freeze auto-fit before moving a node.
    gesture.current = { pointerId: event.pointerId, start: point, camera, node, origin: node ? positions[node.id] : undefined, moved: false };
  };
  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = localPoint(svgRef.current, event.clientX, event.clientY);
    if (!point) return;
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.node && drag.origin) {
      const id = drag.node.id;
      const position = { x: drag.origin.x + dx / drag.camera.scale, y: drag.origin.y + dy / drag.camera.scale };
      setOffsets(current => ({ ...current, [id]: position }));
    } else {
      setCamera({ ...drag.camera, x: drag.camera.x + dx, y: drag.camera.y + dy });
    }
  };
  const endDrag = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    if (!cancelled && !drag.moved && drag.node) onSelect(drag.node);
  };
  const nodeKey = (event: KeyboardEvent<SVGGElement>, node: GraphNode) => {
    const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); onSelect(node);
    } else if (delta[event.key]) {
      event.preventDefault(); event.stopPropagation();
      setCamera(camera);
      const step = event.shiftKey ? 30 : 10;
      setOffsets(current => ({ ...current, [node.id]: { x: positions[node.id].x + delta[event.key].x * step, y: positions[node.id].y + delta[event.key].y * step } }));
    }
  };
  const canvasKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    if (["+", "=", "-", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
    if (event.key === "+" || event.key === "=") zoom(1.25);
    if (event.key === "-") zoom(.8);
    if (event.key === "Home") setStoredCamera(null);
    if (event.key.startsWith("Arrow")) setCamera({ ...camera, x: camera.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0), y: camera.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) });
  };

  return <section className="network-panel" aria-label="可交互关系图">
    <div className="network-toolbar">
      <div className="network-view-toggle" aria-label="图谱显示范围">
        <button type="button" aria-pressed={!focusActive} onClick={() => setFocused(false)}>关系全图</button>
        <button type="button" aria-pressed={focusActive} disabled={!activeId} onClick={() => setFocused(true)}><Focus size={14} aria-hidden="true" />只看直接关系</button>
      </div>
      <div className="network-options">
        <label><input type="checkbox" checked={showLabels} onChange={event => setShowLabels(event.target.checked)} />关系名称</label>
        <label><input type="checkbox" checked={showEvidence} onChange={event => setShowEvidence(event.target.checked)} />证据标记</label>
      </div>
    </div>
    {activeNode && <div className="network-selection">
      <span title={activeNode.label}>已选 · {activeNode.label}</span>
      <button type="button" onClick={() => {
        const point = positions[activeNode.id];
        const scale = Math.max(camera.scale, .8);
        setCamera({ x: size.width / 2 - point.x * scale, y: size.height / 2 - point.y * scale, scale });
      }}>定位节点</button>
      <a href="#graph-node-details">查看详情 ↓</a>
    </div>}
    <div className="network-viewport" ref={frameRef}>
      <svg ref={svgRef} viewBox={`0 0 ${size.width} ${size.height}`} role="group" tabIndex={0}
        aria-label="可拖动的职业能力网络" aria-describedby={helpId}
        onPointerDown={event => startDrag(event)} onPointerMove={moveDrag}
        onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)}
        onLostPointerCapture={event => endDrag(event, true)} onKeyDown={canvasKey}>
        <defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7,3.5 L0,7 Z" fill="#8fa99b" /></marker></defs>
        <g transform={`translate(${camera.x},${camera.y}) scale(${camera.scale})`}>
          <g pointerEvents="none">{links.map((edge, index) => {
            const source = graph.nodes.find(node => node.id === edge.source)!;
            const target = graph.nodes.find(node => node.id === edge.target)!;
            const curve = graphCurve(positions[source.id], positions[target.id], graphNodeStyles[source.type].radius, graphNodeStyles[target.type].radius);
            if (!curve) return null;
            const highlighted = edge.source === activeId || edge.target === activeId;
            return <g key={`${edge.source}-${edge.target}-${index}`} opacity={activeId && !highlighted ? .16 : 1}>
              <path d={curve.path} fill="none" stroke={highlighted ? "#4c856d" : "#bccdc1"} strokeWidth={highlighted ? 2.4 : 1.3}
                strokeDasharray={edge.relation === "prerequisite" ? "5 5" : undefined} markerEnd={`url(#${markerId})`} />
              {(showLabels || highlighted) && <text className="network-edge-label" x={curve.label.x} y={curve.label.y - 6} textAnchor="middle">{graphRelationLabels[edge.relation]}</text>}
            </g>;
          })}</g>
          {visible.map(node => {
            const point = positions[node.id], style = graphNodeStyles[node.type], Icon = icons[node.type];
            const selected = node.id === activeId;
            const dim = activeId ? !neighbors.has(node.id) : !matchingIds.has(node.id);
            const observed = evidence?.atomic_skills.find(item => item.atomic_skill_id === node.reference_id)?.contexts.some(context => context.evidence_count > 0)
              || evidence?.project_observations?.some(item => item.atomic_skill_id === node.reference_id);
            const hasEvidence = node.type === "atom" && Boolean(observed);
            const state = node.type === 'atom' ? plan?.states.find(item => item.atomic_skill_id === node.reference_id) : undefined;
            const isTarget = node.type === 'atom' && plan?.target_atom_ids.includes(node.reference_id);
            const isPrerequisite = node.type === 'atom' && plan?.prerequisite_atom_ids.includes(node.reference_id);
            const labelLines = node.label.length > 11 ? [node.label.slice(0, 11), node.label.slice(11, 22) + (node.label.length > 22 ? "…" : "")] : [node.label];
            return <g key={node.id} className="network-node" role="button" tabIndex={0} aria-pressed={selected}
              aria-label={`查看${style.label}：${node.label}${isTarget ? '，目标原子' : isPrerequisite ? '，前置原子' : ''}${state ? `，${statusLabels[state.status]}` : hasEvidence ? "，有情境证据" : ""}`}
              transform={`translate(${point.x},${point.y})`} opacity={dim ? .3 : 1}
              onPointerDown={event => startDrag(event, node)} onKeyDown={event => nodeKey(event, node)}
              onClick={event => { if (event.detail === 0) onSelect(node); }}>
              <title>{style.label}：{node.label}。拖动调整位置，点击查看详情。</title>
              {(isTarget || isPrerequisite) && <circle r={style.radius + 5} fill="none" stroke={isTarget ? '#4c7050' : '#829873'} strokeWidth={isTarget ? 2 : 1.5} strokeDasharray={isPrerequisite ? '3 4' : undefined} />}
              {selected && <circle r={style.radius + 8} fill="none" stroke={style.color} strokeWidth="1.5" opacity=".4" />}
              <circle className="network-node-disc" r={style.radius} fill={style.fill} stroke={selected ? style.color : "#fff"} strokeWidth={selected ? 2 : 3} />
              <Icon x={-10} y={-10} width={20} height={20} color={style.color} strokeWidth={1.6} aria-hidden="true" pointerEvents="none" />
              {showEvidence && state && <circle r={style.radius + 10} fill="none" stroke={statusColors[state.status]} strokeWidth="2" strokeDasharray={state.status === 'unmeasured' ? '2 5' : undefined} />}
              {showEvidence && !plan && hasEvidence && <circle cx={style.radius * .75} cy={-style.radius * .7} r="5" fill="#397f61" stroke="white" strokeWidth="2" />}
              <text className="network-node-label" y={style.radius + 20} textAnchor="middle">{labelLines.map((line, index) => <tspan key={index} x="0" dy={index === 0 ? 0 : 17}>{line}</tspan>)}</text>
              <text className="network-node-kind" y={style.radius + 23 + labelLines.length * 17} textAnchor="middle" fill={style.color}>{style.label}</text>
              {showEvidence && state && <text className="network-state-label" y={style.radius + 38 + labelLines.length * 17} textAnchor="middle" fill={statusColors[state.status]}>{statusSymbols[state.status]} {statusLabels[state.status]}</text>}
            </g>;
          })}
        </g>
      </svg>
      {!visible.length && <div className="network-empty">{plan && !plan.task_id ? '目标尚未绑定任务，请先回到项目选择练习范围。' : '没有匹配节点，请调整上方筛选。'}</div>}
      <div className="network-controls" aria-label="画布控制">
        <button type="button" onClick={() => zoom(1.25)} disabled={camera.scale >= MAX_SCALE} aria-label="放大图谱" title="放大"><Plus size={17} /></button>
        <span aria-label={`缩放比例 ${Math.round(camera.scale * 100)}%`}>{Math.round(camera.scale * 100)}%</span>
        <button type="button" onClick={() => zoom(.8)} disabled={camera.scale <= MIN_SCALE} aria-label="缩小图谱" title="缩小"><Minus size={17} /></button>
        <button type="button" onClick={() => setStoredCamera(null)} aria-label="适应画布" title="适应画布"><Maximize2 size={16} /></button>
        <button type="button" onClick={() => { setOffsets({}); setStoredCamera(null); }} aria-label="重新整理节点位置" title="重新整理节点位置"><RotateCcw size={16} /></button>
      </div>
    </div>
    <div className="network-caption"><p id={helpId}>拖动节点调整布局，拖动空白平移。按住 Ctrl / ⌘ 滚轮缩放；也可用右下角按钮。键盘选中节点后，方向键移动，Enter 查看。</p><span>{visible.length} 个节点 · {links.length} 条关系</span></div>
    {showEvidence && <p className="network-evidence-note"><span />{plan ? `状态限于「${plan.context || '未绑定'}」情境，按历史证据汇总，不代表长期掌握。外圈区分目标与前置，连线虚线表示前置关系。` : '绿点仅表示存在情境证据，不代表掌握；请在详情中查看独立作答、追问和复测的区别。虚线表示前置关系。'}</p>}
    {storageError && <p className="network-storage-note" role="status">{storageError}</p>}
  </section>;
}
