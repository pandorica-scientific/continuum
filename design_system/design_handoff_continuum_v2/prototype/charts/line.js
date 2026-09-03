// A data-driven line chart in pixel space: the axis is derived from the data (nice ticks), the box is
// measured with ResizeObserver, so the plot fills its panel and rescales as points are added.
function niceStep(range, target) {
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}
export function makeLineChart(React) {
  const h = React.createElement;
  return class LineChart extends React.Component {
    state = { width: 0 };
    ref = React.createRef();
    componentDidMount() { const el = this.ref.current; const set = () => { const w = el.getBoundingClientRect().width; if (w && w !== this.state.width) this.setState({ width: w }); }; set(); this.ro = new ResizeObserver(set); this.ro.observe(el); }
    componentWillUnmount() { this.ro?.disconnect(); }
    render() {
      const { series = [], labels = [], sublabels = [], height = 220, unit = '', zeroLine = true, decimals = 1, padLeft = 56, padRight = 96 } = this.props;
      const W = this.state.width, H = height, top = 12, bottom = 46;
      const ys = series.flatMap((s) => s.points.map((p) => p.y).filter((y) => y !== null && y !== undefined));
      let min = Math.min(...ys, zeroLine ? 0 : Infinity), max = Math.max(...ys, zeroLine ? 0 : -Infinity);
      if (!isFinite(min)) { min = 0; max = 1; }
      const span = Math.max(max - min, 1e-6), step = niceStep(span * 1.25, 4);
      const lo = Math.floor((min - span * 0.12) / step) * step, hi = Math.ceil((max + span * 0.12) / step) * step;
      const ticks = []; for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(+t.toFixed(6));
      const plotW = Math.max(0, W - padLeft - padRight), plotH = H - top - bottom;
      const n = Math.max(labels.length, 1);
      const inset = Math.min(56, plotW * 0.08);
      const xOf = (i) => padLeft + inset + (n === 1 ? (plotW - 2 * inset) / 2 : (i / (n - 1)) * (plotW - 2 * inset));
      const yOf = (v) => top + (1 - (v - lo) / (hi - lo)) * plotH;
      const fmtT = (v) => (v > 0 && zeroLine ? '+' : '') + v.toFixed(Number.isInteger(step) ? 0 : 1) + unit;
      const mono = { fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--fg3)' };
      return h('div', { ref: this.ref, style: { position: 'relative', width: '100%', height: H } },
        W > 0 ? h('svg', { width: W, height: H, style: { display: 'block', overflow: 'visible' } },
          ticks.map((t) => h('g', { key: 't' + t },
            h('line', { x1: padLeft, x2: W - padRight, y1: yOf(t), y2: yOf(t), stroke: t === 0 && zeroLine ? 'var(--bd2)' : 'var(--bd)' }),
            h('text', { x: padLeft - 8, y: yOf(t) + 4, textAnchor: 'end', style: mono }, fmtT(t)))),
          series.map((s) => {
            const pts = s.points.map((p, i) => (p.y === null || p.y === undefined ? null : [xOf(i), yOf(p.y)])).filter(Boolean);
            const last = pts[pts.length - 1];
            return h('g', { key: s.name },
              pts.length > 1 ? h('path', { d: 'M' + pts.map((p) => p.join(',')).join(' L'), fill: 'none', stroke: s.color, strokeWidth: s.width || 2.5, strokeLinecap: 'round', strokeLinejoin: 'round', style: { transition: 'd var(--dur-slow, 260ms) var(--ease, ease)' } }) : null,
              pts.map((p, i) => h('circle', { key: i, cx: p[0], cy: p[1], r: 4.5, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 })),
              last && s.endLabel !== false ? h('text', { x: last[0] + 10, y: last[1] + 4, style: { ...mono, fill: s.color, fontWeight: 600 } }, s.label || (fmtT(s.points[s.points.length - 1].y) + (s.suffix ? ' ' + s.suffix : ''))) : null);
          }),
          labels.map((l, i) => h('g', { key: 'l' + i },
            h('text', { x: xOf(i), y: H - 24, textAnchor: 'middle', style: { fontFamily: 'var(--font-sans)', fontSize: 12, fill: 'var(--fg2)', fontWeight: 500 } }, l),
            sublabels[i] ? h('text', { x: xOf(i), y: H - 8, textAnchor: 'middle', style: mono }, sublabels[i]) : null))
        ) : null);
    }
  };
}
