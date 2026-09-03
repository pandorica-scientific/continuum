// Ported from continuum/src/lib/charts/sankey.ts + flow-graph.ts (AGPL-3.0-or-later).
// Pure geometry: nodes with a column index, links with a value → boxes, ribbons, labels.

const NODE_W = 14, NODE_GAP = 10, MAX_FONT = 13, MIN_FONT = 9, VALUE_RATIO = 0.85, LINE = 1.3, PAD_X = 6, PAD_Y = 3, MIN_RUN = 48, LEADER = 22, CURVE = 0.33;
const labelHeight = (font, withValue) => Math.ceil(font * LINE) + (withValue ? Math.ceil(font * VALUE_RATIO * LINE) + 1 : 0) + PAD_Y * 2;
export const estimateText = (text, font) => text.length * font * 0.62;
function valueChars(value) { const whole = Math.round(Math.abs(value)).toString(); return whole.length + Math.floor((whole.length - 1) / 3) + 3; }
const valueSample = (value) => '0'.repeat(valueChars(value));
function labelWidth(label, value, showValue, font, measure) { return Math.max(measure(label, font, 'name'), showValue ? measure(valueSample(value), font * VALUE_RATIO, 'value') : 0); }

function relaxLabels(preferred, minGap, minY, maxY) {
  const order = preferred.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const blocks = [];
  for (const { y, i } of order) {
    blocks.push({ sum: y, count: 1, items: [i] });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1], prev = blocks[blocks.length - 2];
      const prevTop = prev.sum / prev.count - ((prev.count - 1) * minGap) / 2;
      const lastTop = last.sum / last.count - ((last.count - 1) * minGap) / 2;
      if (lastTop >= prevTop + prev.count * minGap) break;
      blocks.splice(blocks.length - 2, 2, { sum: prev.sum + last.sum, count: prev.count + last.count, items: [...prev.items, ...last.items] });
    }
  }
  const items = [], tops = [];
  for (const block of blocks) { const top = block.sum / block.count - ((block.count - 1) * minGap) / 2; block.items.forEach((item, k) => { items.push(item); tops.push(top + k * minGap); }); }
  const out = new Array(preferred.length);
  if ((items.length - 1) * minGap > maxY - minY) { items.forEach((item, k) => { out[item] = minY + k * minGap; }); return out; }
  for (let i = 0; i < tops.length; i++) tops[i] = Math.max(tops[i], i === 0 ? minY : tops[i - 1] + minGap);
  for (let i = tops.length - 1; i >= 0; i--) tops[i] = Math.min(tops[i], i === tops.length - 1 ? maxY : tops[i + 1] - minGap);
  items.forEach((item, i) => { out[item] = tops[i]; });
  return out;
}
function ribbonPath(x0, y0, x1, y1, t) {
  const c0 = x0 + (x1 - x0) * CURVE, c1 = x1 - (x1 - x0) * CURVE;
  return `M${x0},${y0} C${c0},${y0} ${c1},${y1} ${x1},${y1} L${x1},${y1 + t} C${c1},${y1 + t} ${c0},${y0 + t} ${x0},${y0 + t} Z`;
}
function planColumn(nodes, boxHeight, measure) {
  const withValue = nodes.some((n) => n.showValue);
  let font = MAX_FONT;
  while (font > MIN_FONT && nodes.length * (labelHeight(font, withValue) + 1) > boxHeight) font--;
  const height = labelHeight(font, withValue);
  const lane = Math.max(0, ...nodes.map((n) => labelWidth(n.label, n.value, !!n.showValue, font, measure))) + PAD_X * 2;
  return { font, height, lane, room: Math.floor(boxHeight / (height + 1)), withValue };
}

export function buildSankey(graph, box, measure = estimateText) {
  const columns = [...new Set(graph.nodes.map((n) => n.column))].sort((a, b) => a - b);
  const layout = { width: box.width, height: box.height, nodes: [], ribbons: [], labels: [] };
  if (!columns.length) return layout;
  const inCol = (c) => graph.nodes.filter((n) => n.column === c);
  const columnTotal = Math.max(...columns.map((c) => inCol(c).reduce((s, n) => s + n.value, 0)));
  const mostNodes = Math.max(...columns.map((c) => inCol(c).length));
  const usable = Math.max(1, box.height - (mostNodes - 1) * NODE_GAP);
  const scale = columnTotal > 0 ? usable / columnTotal : 0;
  const plans = new Map();
  for (const c of columns) plans.set(c, planColumn(inCol(c), box.height, measure));
  const first = columns[0], last = columns[columns.length - 1];
  const outer = (c) => c === first || c === last;
  const runs = Math.max(1, columns.length - 1);
  const needs = (c) => (outer(c) ? (plans.get(c)?.lane ?? 0) + PAD_X : 0);
  const slope = (c) => (outer(c) ? LEADER - PAD_X : 0);
  const both = (of) => of(first) + (columns.length > 1 ? of(last) : 0);
  const spare = Math.max(0, box.width - columns.length * NODE_W - runs * MIN_RUN);
  const slopeScale = both(slope) > 0 ? Math.max(0, Math.min(1, (spare - both(needs)) / both(slope))) : 0;
  const squeeze = both(needs) > spare ? Math.max(0, spare / both(needs)) : 1;
  if (squeeze < 1) for (const [c, plan] of plans) { const font = Math.max(MIN_FONT, Math.floor(plan.font * squeeze)); const height = labelHeight(font, plan.withValue); plans.set(c, { ...plan, font, height, lane: plan.lane * squeeze, room: Math.floor(box.height / (height + 1)) }); }
  const standoff = (c) => (outer(c) ? PAD_X + Math.round(slope(c) * slopeScale) : PAD_X);
  const margin = (c) => (outer(c) ? Math.round(needs(c) * squeeze) + Math.round(slope(c) * slopeScale) : 0);
  const run = columns.length === 1 ? 0 : Math.max(MIN_RUN, (box.width - margin(first) - margin(last) - columns.length * NODE_W) / runs);
  const roomInRun = Math.max(0, run - PAD_X * 3);
  for (const [c, plan] of plans) {
    if (outer(c) || plan.lane <= roomInRun || plan.lane <= 0) continue;
    const ratio = roomInRun / plan.lane; const font = Math.max(MIN_FONT, Math.floor(plan.font * ratio)); const height = labelHeight(font, plan.withValue);
    plans.set(c, { ...plan, font, height, lane: Math.min(plan.lane * ratio, roomInRun), room: Math.floor(box.height / (height + 1)) });
  }
  const xOf = new Map(); let cursor = margin(first);
  for (const c of columns) { xOf.set(c, cursor); cursor += NODE_W + (c === last ? 0 : run); }
  const placed = new Map(), order = new Map();
  for (const c of columns) order.set(c, inCol(c).sort((a, b) => b.value - a.value).map((n) => n.key));
  const indexIn = (c, key) => order.get(c)?.indexOf(key) ?? -1;
  function sweep(column, neighbour, edge) {
    const keys = order.get(column) ?? [];
    const meanOf = (key) => { const idx = graph.links.filter((l) => (edge === 'parents' ? l.to === key : l.from === key)).map((l) => indexIn(neighbour, edge === 'parents' ? l.from : l.to)).filter((i) => i >= 0); return idx.length ? idx.reduce((s, i) => s + i, 0) / idx.length : null; };
    const wm = keys.map((key, position) => ({ key, position, mean: meanOf(key) }));
    wm.sort((a, b) => { if (a.mean !== null && b.mean !== null) return a.mean - b.mean || a.position - b.position; if (a.mean === null && b.mean === null) return a.position - b.position; return a.mean === null ? 1 : -1; });
    order.set(column, wm.map((e) => e.key));
  }
  for (let pass = 0; pass < 4; pass++) { for (let i = 1; i < columns.length; i++) sweep(columns[i], columns[i - 1], 'parents'); for (let i = columns.length - 2; i >= 0; i--) sweep(columns[i], columns[i + 1], 'children'); }
  for (const c of columns) {
    const byKey = new Map(inCol(c).map((n) => [n.key, n]));
    const ordered = (order.get(c) ?? []).map((k) => byKey.get(k)).filter(Boolean);
    const stackHeight = ordered.reduce((s, n) => s + n.value * scale, 0) + (ordered.length - 1) * NODE_GAP;
    let y = Math.max(0, (box.height - stackHeight) / 2);
    for (const node of ordered) { const h = Math.max(1, node.value * scale); const shaped = { ...node, x: xOf.get(c) ?? 0, y, w: NODE_W, h }; placed.set(node.key, shaped); layout.nodes.push(shaped); y += h + NODE_GAP; }
  }
  const outCursor = new Map(), inCursor = new Map(), y0For = new Map(), y1For = new Map();
  const columnOf = (key) => placed.get(key)?.column ?? 0;
  for (const link of [...graph.links].sort((a, b) => columnOf(a.from) - columnOf(b.from) || (placed.get(a.to)?.y ?? 0) - (placed.get(b.to)?.y ?? 0))) { const from = placed.get(link.from); if (!from) continue; const t = Math.max(1, link.value * scale); y0For.set(link, from.y + (outCursor.get(from.key) ?? 0)); outCursor.set(from.key, (outCursor.get(from.key) ?? 0) + t); }
  for (const link of [...graph.links].sort((a, b) => columnOf(a.from) - columnOf(b.from) || (placed.get(a.from)?.y ?? 0) - (placed.get(b.from)?.y ?? 0))) { const to = placed.get(link.to); if (!to) continue; const t = Math.max(1, link.value * scale); y1For.set(link, to.y + (inCursor.get(to.key) ?? 0)); inCursor.set(to.key, (inCursor.get(to.key) ?? 0) + t); }
  for (const link of [...graph.links].sort((a, b) => columnOf(a.from) - columnOf(b.from) || (y0For.get(a) ?? 0) - (y0For.get(b) ?? 0))) {
    const from = placed.get(link.from), to = placed.get(link.to); if (!from || !to) continue;
    const thickness = Math.max(1, link.value * scale), y0 = y0For.get(link) ?? from.y, y1 = y1For.get(link) ?? to.y, x0 = from.x + from.w, x1 = to.x;
    layout.ribbons.push({ from: link.from, to: link.to, value: link.value, x0, y0, x1, y1, thickness, colorVar: from.colorVar, d: ribbonPath(x0, y0, x1, y1, thickness) });
  }
  for (const c of columns) {
    const nodes = layout.nodes.filter((n) => n.column === c); const plan = plans.get(c); if (!plan) continue;
    const { font, height, room } = plan; const isFirst = c === first, outside = outer(c);
    const preferred = nodes.map((n) => n.y + n.h / 2 - height / 2);
    const relaxed = relaxLabels(preferred, height + 1, 0, Math.max(0, box.height - height));
    const named = new Set([...nodes].sort((a, b) => b.value - a.value).slice(0, room).map((n) => n.key));
    const width = outside ? Math.max(0, margin(c) - standoff(c)) : Math.max(0, Math.min(plan.lane, roomInRun));
    nodes.forEach((node, i) => {
      const nodeCentre = node.y + node.h / 2, labelCentre = relaxed[i] + height / 2;
      const x = isFirst ? node.x - standoff(c) : node.x + node.w + standoff(c);
      layout.labels.push({ key: node.key, column: c, label: node.label, value: node.value, showValue: !!node.showValue,
        fits: named.has(node.key) && labelWidth(node.label, node.value, !!node.showValue, font, measure) <= width + 0.5,
        plate: !outside, colorVar: node.colorVar, x, y: relaxed[i], height, font, width, anchor: isFirst ? 'end' : 'start',
        leader: Math.abs(labelCentre - nodeCentre) > 1 ? { x1: isFirst ? node.x : node.x + node.w, y1: nodeCentre, x2: x, y2: labelCentre } : null });
    });
  }
  return layout;
}

// ── flow-graph.ts ──
const INCOME = '--green', RESERVES_COLOR = '--red', KEPT_COLOR = '--indigo', ROUNDING = 0.005;
export function depthFor(width) { return width < 380 ? 2 : width < 560 ? 3 : 4; }
export function flowGraph(input, depth = 4) {
  const graph = { nodes: [], links: [] };
  const drawn = input.kept < -ROUNDING;
  const sources = [...input.sources.filter((s) => s.amount > 0).map((s) => ({ ...s, colorVar: s.colorVar ?? INCOME })), ...(drawn ? [{ key: 'residual:reserves', name: input.reservesLabel, amount: -input.kept, colorVar: RESERVES_COLOR, href: null }] : [])];
  const total = sources.reduce((s, x) => s + x.amount, 0);
  const incomeColumn = depth === 2 ? -1 : 1, groupColumn = depth === 2 ? 1 : 2;
  for (const s of sources) graph.nodes.push({ key: `src:${s.key}`, label: s.name, value: s.amount, colorVar: s.colorVar, column: 0, showValue: true, href: s.href ?? null });
  if (incomeColumn >= 0) { graph.nodes.push({ key: 'income', label: drawn ? 'Income + reserves' : 'Income', value: total, colorVar: INCOME, column: incomeColumn, showValue: true, href: input.incomeHref ?? null }); for (const s of sources) graph.links.push({ from: `src:${s.key}`, to: 'income', value: s.amount }); }
  const outflows = [...input.stages.filter((s) => s.amount > 0).map((s) => ({ key: s.key, label: s.label, value: s.amount, colorVar: s.colorVar, href: s.href ?? null })), ...(input.kept > ROUNDING ? [{ key: 'residual:kept', label: input.keptLabel, value: input.kept, colorVar: KEPT_COLOR, href: null }] : [])];
  for (const o of outflows) {
    graph.nodes.push({ key: `grp:${o.key}`, label: o.label, value: o.value, colorVar: o.colorVar, column: groupColumn, href: o.href });
    if (incomeColumn >= 0) graph.links.push({ from: 'income', to: `grp:${o.key}`, value: o.value });
    else for (const s of sources) { const share = total > 0 ? (s.amount / total) * o.value : 0; if (share > 0) graph.links.push({ from: `src:${s.key}`, to: `grp:${o.key}`, value: share }); }
  }
  if (depth < 4) return graph;
  const leavesFor = new Map(input.breakdown.map((b) => [b.key, b.leaves]));
  for (const o of outflows) for (const [i, leaf] of (leavesFor.get(o.key) ?? []).filter((l) => l.value > 0).entries()) { const key = `leaf:${o.key}:${i}`; graph.nodes.push({ key, label: leaf.name, value: leaf.value, colorVar: o.colorVar, column: 3, href: leaf.href ?? null }); graph.links.push({ from: `grp:${o.key}`, to: key, value: leaf.value }); }
  return graph;
}

// ── Sankey.svelte, as a React component ──
const RIBBON_OPACITY = 0.45, RIBBON_LIT = 0.7, RIBBON_DIM = 0.12, MIN_HEIGHT = 260, MAX_HEIGHT = 620;
const fmtAmount = (v) => { const [w, d] = Math.abs(v).toFixed(2).split('.'); const g = w.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); return (v < 0 ? '−' : '') + g + (d === '00' ? '' : '.' + d) + ' Kč'; };

export function makeSankey(React) {
  const h = React.createElement;
  return class Sankey extends React.Component {
    state = { width: 0, measure: estimateText, hovered: null, hoveredKey: null, hoveredRibbon: null };
    ref = React.createRef();
    componentDidMount() {
      const el = this.ref.current; if (!el) return;
      const set = () => { const w = el.getBoundingClientRect().width; if (w > 0 && w !== this.state.width) this.setState({ width: w }); };
      set();
      this.ro = new ResizeObserver(set); this.ro.observe(el);
      const canvas = () => { const ctx = document.createElement('canvas').getContext('2d'); if (!ctx) return estimateText; const st = getComputedStyle(el); const sans = st.getPropertyValue('--font-sans'), mono = st.getPropertyValue('--font-mono'); return (text, font, kind) => { ctx.font = kind === 'value' ? `400 ${font}px ${mono}` : `500 ${font}px ${sans}`; return ctx.measureText(text).width; }; };
      this.setState({ measure: canvas() });
      document.fonts?.ready.then(() => { if (this.ro) this.setState({ measure: canvas() }); });
    }
    componentWillUnmount() { this.ro?.disconnect(); this.ro = null; }
    render() {
      const { flow } = this.props; const { width, measure, hovered, hoveredKey, hoveredRibbon } = this.state;
      const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, width * 0.46));
      const layout = width > 0 ? buildSankey(flowGraph(flow, depthFor(width)), { width, height }, measure) : { nodes: [], ribbons: [], labels: [], width: 0, height };
      const labelOf = new Map(layout.nodes.map((n) => [n.key, n.label]));
      const leave = () => this.setState({ hovered: null, hoveredKey: null, hoveredRibbon: null });
      const enterNode = (n) => this.setState({ hoveredKey: n.key, hoveredRibbon: null, hovered: { label: n.label, value: n.value, x: n.x + n.w / 2, y: n.y } });
      const enterRibbon = (r, i) => this.setState({ hoveredRibbon: i, hoveredKey: null, hovered: { label: `${labelOf.get(r.from) ?? r.from} → ${labelOf.get(r.to) ?? r.to}`, value: r.value, x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 + r.thickness / 2 } });
      // Everything a block belongs to: the ribbons it touches, plus the whole chain downstream (its leaves) and upstream (the trunk it came from).
      const lit = new Set();
      const focusRibbon = hoveredRibbon !== null ? layout.ribbons[hoveredRibbon] : null;
      if (hoveredKey !== null || focusRibbon) {
        if (focusRibbon) lit.add(focusRibbon);
        // Upstream only: the path this money took to get here. Downstream would light half the diagram from the trunk.
        const up = [focusRibbon ? focusRibbon.from : hoveredKey];
        while (up.length) { const k = up.pop(); for (const r of layout.ribbons) if (r.to === k && !lit.has(r)) { lit.add(r); up.push(r.from); } }
        if (!focusRibbon) for (const r of layout.ribbons) if (r.from === hoveredKey) lit.add(r);
      }
      const op = (r) => lit.size === 0 ? RIBBON_OPACITY : (lit.has(r) ? RIBBON_LIT : RIBBON_DIM);
      const nodeLit = (n) => lit.size === 0 || n.key === hoveredKey || [...lit].some((r) => r.from === n.key || r.to === n.key);
      const text = { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
      return h('div', { ref: this.ref, style: { position: 'relative', width: '100%', height } },
        layout.nodes.length ? h('svg', { width: layout.width, height: layout.height, style: { display: 'block' } },
          layout.ribbons.map((r, i) => h('path', { key: 'r' + i, d: r.d, fill: `var(${r.colorVar})`, fillOpacity: op(r), style: { transition: 'fill-opacity var(--dur, 150ms) var(--ease, ease)' }, onPointerEnter: () => enterRibbon(r, i), onPointerLeave: leave })),
          layout.nodes.map((n) => h('g', { key: n.key, onPointerEnter: () => enterNode(n), onPointerLeave: leave, style: { cursor: n.href ? 'pointer' : 'default' } }, h('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 2, fill: `var(${n.colorVar})`, fillOpacity: nodeLit(n) ? 1 : 0.35, style: { transition: 'fill-opacity var(--dur, 150ms) var(--ease, ease)' } }))),
          layout.labels.filter((l) => l.fits && l.leader).map((l) => h('line', { key: 'l' + l.key, x1: l.leader.x1, y1: l.leader.y1, x2: l.leader.x2, y2: l.leader.y2, stroke: `var(${l.colorVar})`, strokeWidth: 1, opacity: 0.5 }))
        ) : null,
        layout.labels.filter((l) => l.fits).map((l) => h('div', { key: 'lb' + l.key, style: { position: 'absolute', left: l.x, top: l.y, height: l.height, fontSize: l.font, maxWidth: l.width, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, pointerEvents: 'none', transform: l.anchor === 'end' ? 'translateX(-100%)' : 'none', alignItems: l.anchor === 'end' ? 'flex-end' : 'flex-start', textAlign: l.anchor === 'end' ? 'right' : 'left', background: l.plate ? 'var(--plate)' : 'transparent', borderRadius: l.plate ? 6 : 0, padding: l.plate ? '0 5px' : 0 } },
          h('span', { style: { ...text, fontSize: '1em', fontWeight: 500, color: 'var(--fg1)', lineHeight: 1.3 } }, l.label),
          l.showValue ? h('span', { style: { ...text, fontSize: '0.85em', color: 'var(--fg2)', lineHeight: 1.3, fontFamily: 'var(--font-mono)' } }, fmtAmount(l.value)) : null)),
        hovered ? h('div', { role: 'status', style: { position: 'absolute', zIndex: 2, left: hovered.x, top: hovered.y, transform: 'translate(-50%, calc(-100% - 6px))', display: 'flex', flexDirection: 'column', gap: 1, pointerEvents: 'none', whiteSpace: 'nowrap', background: 'var(--bg2)', border: '1px solid var(--bd2)', borderRadius: 8, padding: '4px 8px', boxShadow: 'var(--shadow-float)' } },
          h('span', { style: { fontSize: 12, fontWeight: 500, color: 'var(--fg1)' } }, hovered.label),
          h('span', { style: { fontSize: 11, color: 'var(--fg2)', fontFamily: 'var(--font-mono)' } }, fmtAmount(hovered.value))) : null
      );
    }
  };
}
