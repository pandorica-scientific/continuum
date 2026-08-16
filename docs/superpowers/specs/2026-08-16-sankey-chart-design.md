# Cash-flow Sankey — design

Date: 2026-08-16
Release: 0.3.6
Status: approved, implementing

## What this is

The cash-flow chart becomes a true multi-column Sankey, laid out at the size of
the box it is given.

Two complaints drove it. The chart **scaled** rather than reflowed — one
880 × 592 layout shrunk by a transform, so at half width the labels halved with
it. And it left a large empty corner: the trunk occupied the top 40% and the
leaves swept diagonally to the bottom right, because Housing is 76% of outflow
and peeled off last.

## The decision, and what it costs

Three options were weighed: reflow the existing cascade, rewrite as a true
Sankey, or adopt `d3-sankey`.

**A true Sankey was chosen.** It matches the reference diagrams and fills its
box naturally. Recorded honestly, because it is a real cost: the cascade told a
story this does not. "Income → after tax → after bills → after living → saved"
answers the screen's question in a way a generic flow diagram cannot, and the V2
handoff singles out that layout and its label-relaxation pass as the one piece
worth porting closely, having been iterated on heavily.

`d3-sankey` was declined to avoid adding `d3-array` and `d3-shape` to a project
that has stayed deliberately lean and ships self-hosted; the styling and label
placement would still have been ours.

## Structure

Three layers, and the split is the point.

| Layer     | File                           | Knows about                                      |
| --------- | ------------------------------ | ------------------------------------------------ |
| Engine    | `src/lib/charts/sankey.ts`     | columns, values, ribbons, labels — pure geometry |
| Adapter   | `src/lib/charts/flow-graph.ts` | income, groups, leaves                           |
| Component | `src/lib/charts/Sankey.svelte` | the box it is given                              |

**The engine knows nothing about money.** It takes a plain graph and lays out
any number of columns:

```ts
interface SankeyNode {
	key: string;
	label: string;
	value: number;
	colorVar: string;
	column: number;
}
interface SankeyLink {
	from: string;
	to: string;
	value: number;
}
```

That is what makes "add things later" a change to the adapter rather than to the
layout maths — a fifth column, a split group, a node kind that does not exist
yet. It also lets the engine be tested on synthetic graphs, which the cascade
could not be.

**The adapter is the only file that knows what a salary is.** It builds
sources → Income → groups → leaves from the `FlowData` the loader already
returns, including `breakdown[].leaves`, which today feeds only the strip
beneath the chart.

**Income is already open-ended.** `sources` is derived from every category in
the `income` group with a non-zero sum, so Salary, Rent received and Dividends
appear as they earn money, and a new income category needs no code at all.

## Layout

Four passes.

1. **Column x** — evenly spaced across the width, inset for the label gutters.
2. **Node heights** — one scale for every column, since each carries the same
   total: the tallest column fills the height exactly, less inter-node gaps.
   This is what removes the dead corner. The box defines the layout rather than
   the content sitting inside a fixed 1240 × 860.
3. **Within-column order** — sorted by mean parent position, then two
   median-heuristic sweeps to reduce ribbon crossings. Deterministic, so the
   same input always produces the same picture.
4. **Ribbons** — cubic béziers with control points at the horizontal midpoint,
   carried over verbatim from the old engine.

**Nodes are 14px wide**, `rx="2"` — the reference diagrams' chunky blocks rather
than today's 11px hairlines in a 1240 viewBox. Ribbons take their source node's
colour at ~0.45 opacity so overlaps stay legible.

**Labels sit outside the nodes**, name over value. The first column anchors
right, the last anchors left, middle columns sit above their node.
`relaxLabels` moves into the engine unchanged, with the comment explaining why
pooled-adjacent-violators is used and a repeated sweep never settles — it is the
piece that took the most iterations.

## Sizing

`buildSankey(graph, { width, height })` lays out in the box's real pixels. No
fixed viewBox and no transform, so 13px labels stay 13px at every width.

A Sankey has a genuine minimum before it stops being readable, so the adapter
drops depth rather than letting the engine draw something illegible:

- **below ~560px** — the leaf column is dropped; sources → Income → groups. The
  leaves remain in the breakdown strip, so nothing is lost.
- **below ~380px** — groups only, two columns. This is the phone case, where the
  Overview board is a single column.

The component measures with a `ResizeObserver` **plus a synchronous first read**
from `getBoundingClientRect()`. Carried over from 0.3.5: `ResizeObserver` never
fires in a hidden document, so an observer-only implementation renders wrong in
a background tab.

## The old engine

`src/lib/charts/waterfall.ts` and `src/lib/charts/Waterfall.svelte` are deleted,
along with `tests/unit/waterfall.test.ts`. Two chart engines where one is
unreachable is worse than either.

`relaxLabels` and its tests move into the Sankey engine and its suite. Nothing
else survives.

## Testing

The engine takes synthetic graphs, so the invariants are checked **across a
sweep of widths** rather than at one fixed size:

- no two labels in a column overlap
- nothing is drawn outside the box
- ribbon endpoints are flush with their nodes, top and bottom
- each column's node values sum to the graph total
- node order is stable for the same input
- dropping a column at the narrow breakpoints conserves every value

The adapter is tested separately against real `FlowData` shapes: an income
source with no transactions never appears, an expense group with no leaves still
draws, and unfiled money is never dropped from a total.

## Known limitations

- The running-total narrative is gone, as above. If it is missed, it belongs on
  the Cash flow screen as a separate figure rather than as a return to the
  cascade.
- Crossing reduction is a heuristic, not a minimum. With this data — four
  columns, few nodes — it is comfortably enough; a pathological graph could
  still cross.
