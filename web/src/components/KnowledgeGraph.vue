<template>
  <div ref="wrapRef" class="kg-wrap">
    <canvas
      ref="canvasRef"
      class="kg-canvas"
      role="img"
      aria-label="知识图谱画布：可拖拽节点、滚轮缩放；键盘用户请使用工具栏的节点列表"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @dblclick="onDoubleClick"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { Mastery } from "../api";

const NODE_W = 120;
const NODE_H = 32;
const MIN_K = 0.2;
const MAX_K = 3;

export interface GraphNodeInput {
  id: number;
  label: string;
  mastery: Mastery;
}

export interface GraphEdgeInput {
  from: number;
  to: number;
}

interface SimNode extends SimulationNodeDatum, GraphNodeInput {
  x: number;
  y: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: number | SimNode;
  target: number | SimNode;
}

const props = withDefaults(
  defineProps<{
    nodes: GraphNodeInput[];
    edges: GraphEdgeInput[];
    /** 课程级持久化坐标：key 为知识点 id */
    savedPositions: Record<string, { x: number; y: number }>;
    linking?: boolean;
    linkSource?: number | null;
    selectedId?: number | null;
  }>(),
  { linking: false, linkSource: null, selectedId: null },
);

const emit = defineEmits<{
  "node-click": [id: number];
  "link-pick": [id: number];
  "drag-end": [id: number, x: number, y: number];
}>();

const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let sim: Simulation<SimNode, SimLink> | null = null;
let nodes: SimNode[] = [];
let links: SimLink[] = [];
let width = 0;
let height = 0;
let dpr = 1;
let palette = readPalette();

let transform = { x: 0, y: 0, k: 1 };
let drag: { mode: "node"; id: number; moved: boolean } | { mode: "pan"; startX: number; startY: number; origX: number; origY: number } | null = null;
let hoverId: number | null = null;
let suppressClick = false;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;

function readPalette() {
  const el = document.querySelector(".ai-study-app");
  const cs = el ? getComputedStyle(el) : null;
  const v = (name: string, fallback: string) => cs?.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--as-text", "#e9e4d4"),
    dim: v("--as-text-dim", "#9aa49a"),
    faint: v("--as-text-faint", "#8a948b"),
    bg: v("--as-bg-elev", "#141a15"),
    bg2: v("--as-bg-elev2", "#1b231c"),
    border: v("--as-border", "#27312a"),
    accent: v("--as-accent", "#e3b95e"),
    accentSoft: v("--as-accent-soft", "rgba(227,185,94,.12)"),
    accentLine: v("--as-accent-line", "rgba(227,185,94,.35)"),
    green: v("--as-green", "#7fc08c"),
    blue: v("--as-blue", "#7fb0c9"),
    purple: v("--as-purple", "#a78bfa"),
  };
}

function masteryColor(m: Mastery): string {
  if (m === "proficient") return palette.accent;
  if (m === "mastered") return palette.green;
  if (m === "known") return palette.blue;
  return palette.faint;
}

function resize() {
  const wrap = wrapRef.value;
  const canvas = canvasRef.value;
  if (!wrap || !canvas) return;
  dpr = window.devicePixelRatio || 1;
  width = wrap.clientWidth;
  height = wrap.clientHeight;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  draw();
}

function circularStart(i: number, total: number): { x: number; y: number } {
  const r = 40 + Math.sqrt(total) * 26;
  const angle = (i / Math.max(1, total)) * Math.PI * 2;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

function rebuild() {
  sim?.stop();
  nodes = props.nodes.map((n, i) => {
    const saved = props.savedPositions[String(n.id)];
    const p = saved ?? circularStart(i, props.nodes.length);
    return { ...n, x: p.x, y: p.y, fx: saved ? p.x : null, fy: saved ? p.y : null };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  links = props.edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => ({ source: e.from, target: e.to }));
  if (nodes.length === 0) {
    draw();
    return;
  }
  sim = forceSimulation<SimNode, SimLink>(nodes)
    .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(150).strength(0.35))
    .force("charge", forceManyBody<SimNode>().strength(-220))
    .force("collide", forceCollide<SimNode>().radius(NODE_W / 2 + 10))
    .force("center", forceCenter(0, 0))
    .alphaDecay(0.04)
    .velocityDecay(0.38)
    .on("tick", draw);
  // 同步预热到稳定：避免首次进入时节点四散/跑出视野，布局也保持确定性
  sim.stop();
  for (let i = 0; i < 180; i++) sim.tick();
  fitView();
}

function fitView() {
  if (nodes.length === 0) return;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - NODE_W / 2;
  const maxX = Math.max(...xs) + NODE_W / 2;
  const minY = Math.min(...ys) - NODE_H / 2;
  const maxY = Math.max(...ys) + NODE_H / 2;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const k = Math.min((width - 60) / w, (height - 60) / h, 1.6);
  transform = {
    k: Math.max(MIN_K, Math.min(MAX_K, k || 1)),
    x: width / 2 - ((minX + maxX) / 2) * Math.max(MIN_K, Math.min(MAX_K, k || 1)),
    y: height / 2 - ((minY + maxY) / 2) * Math.max(MIN_K, Math.min(MAX_K, k || 1)),
  };
  draw();
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas || !ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr * transform.k, 0, 0, dpr * transform.k, dpr * transform.x, dpr * transform.y);

  const showLabel = transform.k >= 0.55;
  ctx.lineWidth = 1.2 / transform.k;
  ctx.strokeStyle = palette.faint;
  ctx.globalAlpha = 0.65;
  for (const e of links) {
    const s = e.source as SimNode;
    const t = e.target as SimNode;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y + NODE_H / 2);
    ctx.bezierCurveTo(s.x, (s.y + t.y) / 2, t.x, (s.y + t.y) / 2, t.x, t.y - NODE_H / 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const n of nodes) {
    const x = n.x - NODE_W / 2;
    const y = n.y - NODE_H / 2;
    const isHover = hoverId === n.id;
    const isPicked = props.linkSource === n.id;
    const isSelected = props.selectedId === n.id;
    const stroke = isPicked || isSelected ? palette.accent : masteryColor(n.mastery);

    roundRect(ctx, x, y, NODE_W, NODE_H, 8);
    ctx.fillStyle = isPicked ? palette.accentSoft : palette.bg2;
    ctx.fill();
    ctx.lineWidth = (isHover || isPicked || isSelected ? 2 : 1.3) / transform.k;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    if (showLabel) {
      ctx.fillStyle = palette.text;
      ctx.font = `${12 / transform.k}px "PingFang SC", "Hiragino Sans GB", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(clip(n.label), n.x, n.y);
    }
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function clip(label: string): string {
  return label.length > 9 ? label.slice(0, 9) + "…" : label;
}

function toWorld(clientX: number, clientY: number) {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: (clientX - rect.left - transform.x) / transform.k, y: (clientY - rect.top - transform.y) / transform.k };
}

function hitTest(clientX: number, clientY: number): SimNode | null {
  const p = toWorld(clientX, clientY);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (Math.abs(p.x - n.x) <= NODE_W / 2 && Math.abs(p.y - n.y) <= NODE_H / 2) return n;
  }
  return null;
}

function onWheel(e: WheelEvent) {
  const rect = canvasRef.value?.getBoundingClientRect();
  if (!rect) return;
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  const k = Math.max(MIN_K, Math.min(MAX_K, transform.k * factor));
  const scale = k / transform.k;
  transform = { k, x: mx - (mx - transform.x) * scale, y: my - (my - transform.y) * scale };
  draw();
}

function onPointerDown(e: PointerEvent) {
  const n = hitTest(e.clientX, e.clientY);
  if (n) {
    drag = { mode: "node", id: n.id, moved: false };
    n.fx = n.x;
    n.fy = n.y;
    sim?.alphaTarget(0.25).restart();
  } else {
    drag = { mode: "pan", startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  }
  canvasRef.value?.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  const current = drag;
  if (!current) {
    const n = hitTest(e.clientX, e.clientY);
    const next = n?.id ?? null;
    if (next !== hoverId) {
      hoverId = next;
      draw();
    }
    return;
  }
  if (current.mode === "pan") {
    transform.x = current.origX + (e.clientX - current.startX);
    transform.y = current.origY + (e.clientY - current.startY);
    draw();
    return;
  }
  const n = nodes.find((x) => x.id === current.id);
  if (!n) return;
  const p = toWorld(e.clientX, e.clientY);
  n.fx = p.x;
  n.fy = p.y;
  n.x = p.x;
  n.y = p.y;
  current.moved = true;
  draw();
}

function onPointerUp() {
  if (!drag) return;
  const state = drag;
  drag = null;
  sim?.alphaTarget(0);
  if (state.mode === "node") {
    const n = nodes.find((x) => x.id === state.id);
    if (state.moved && n) {
      suppressClick = true;
      emit("drag-end", n.id, n.x, n.y);
    } else if (n) {
      // 点击不拖动：解除临时 pin，保留当前位置
      n.fx = null;
      n.fy = null;
    }
  }
}

function onDoubleClick(e: MouseEvent) {
  const n = hitTest(e.clientX, e.clientY);
  if (!n) return;
  centerOn(n.id, Math.min(MAX_K, Math.max(1.4, transform.k)));
}

function onClick(e: MouseEvent) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const n = hitTest(e.clientX, e.clientY);
  if (!n) return;
  if (props.linking) emit("link-pick", n.id);
  else emit("node-click", n.id);
}

function centerOn(id: number, k = transform.k) {
  const n = nodes.find((x) => x.id === id);
  if (!n) return;
  transform = { k, x: width / 2 - n.x * k, y: height / 2 - n.y * k };
  draw();
}

defineExpose({
  fitView,
  centerOn,
  resetLayout(): void {
    nodes = [];
    rebuild();
  },
});

watch(
  () => [props.nodes, props.edges],
  () => rebuild(),
  { deep: false },
);
watch(
  () => [props.linking, props.linkSource, props.selectedId],
  () => draw(),
);

onMounted(() => {
  const canvas = canvasRef.value;
  if (canvas) {
    ctx = canvas.getContext("2d");
    canvas.addEventListener("click", onClick);
  }
  resizeObserver = new ResizeObserver(() => {
    resize();
    draw();
  });
  if (wrapRef.value) resizeObserver.observe(wrapRef.value);
  themeObserver = new MutationObserver(() => {
    palette = readPalette();
    draw();
  });
  const app = document.querySelector(".ai-study-app");
  if (app) themeObserver.observe(app, { attributes: true, attributeFilter: ["data-theme"] });
  resize();
  rebuild();
});

onBeforeUnmount(() => {
  sim?.stop();
  sim = null;
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  canvasRef.value?.removeEventListener("click", onClick);
});
</script>
