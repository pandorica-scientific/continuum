# Continuum design tokens

_Generated from `src/lib/styles/app.css` by `scripts/design-tokens.mjs`. Do not edit by hand — run `npm run design:tokens` after changing the stylesheet._

The stylesheet is the source of truth. Every note below is its own comment, kept here so a mockup can be authored against the shipped system without opening the app. A token with no **Light** value takes the same value in both themes.

## Surfaces, then inks, then the hue set every tint and wash is mixed from

> Surfaces, then inks, then the hue set every tint and wash is mixed from.
> Three card grounds rather than one: a card, something resting on a card,
> and something resting on that. Past three a reader stops counting depth
> and starts seeing noise, which is the same argument elevation makes below.

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#0e1117` | `#eeeae2` |
| `--bg2` | `#11161f` | `#e6e1d7` |
| `--side` | `#0a0d13` | `#f5f2ec` |
| `--card` | `rgba(255, 255, 255, 0.03)` | `#f9f7f2` |
| `--card2` | `rgba(255, 255, 255, 0.06)` | `#f1ede5` |
| `--card3` | `rgba(255, 255, 255, 0.09)` | `#e6e0d4` |
| `--bd` | `rgba(255, 255, 255, 0.08)` | `rgb(60 52 40 / 0.11)` |
| `--bd2` | `rgba(255, 255, 255, 0.18)` | `rgb(60 52 40 / 0.22)` |
| `--fg1` | `#e6e9ef` | `#1c1a16` |
| `--fg2` | `#c5ccd6` | `#3d3a34` |
| `--fg3` | `#99a4b3` | `#75705f` |
| `--fg-inverse` | `#0e1117` | `#ffffff` |
| `--green` | `#2ecc71` | `#0d7245` |
| `--red` | `#ef6a5c` | `#bd2e21` |
| `--yellow` | `#f1c40f` | `#8a5900` |
| `--blue` | `#5aaee4` | `#186294` |
| `--purple` | `#bd85d3` | `#743990` |
| `--orange` | `#e67e22` | `#a2530f` |
| `--teal` | `#1abc9c` | `#087059` |
| `--indigo` | `#7d8feb` | `#454fb0` |
| `--brand` | `#5895d8` | `#1b4f8a` |
| `--plate` | `rgba(14, 17, 23, 0.86)` | `rgba(243, 240, 233, 0.9)` |

## Pill fills

> Pill fills: the hue itself at 0.18 over the card. Grey is the one
> exception at 0.16 — a neutral at the same alpha as a hue reads heavier,
> because nothing about it is carried by chroma.
>
> Two inks above are set BY this line rather than the other way round.
> `--indigo` and `--brand` measured 4.38 and 3.73 as text on their own
> tints, under the 4.5 floor, and were lifted in OKLCH — hue and chroma
> held, lightness raised to the first shippable hex that clears it. The
> alternative, thinning the tint, needs brand at alpha 0.035 to work,
> which is not a pill any more. Light needs neither: both clear there.
> palette-contrast.test.ts measures every tint family, derived from this
> block, so a hue added here is checked without being listed anywhere.

| Token | Dark | Light |
|---|---|---|
| `--green-tint` | `rgba(46, 204, 113, 0.18)` | `rgba(34, 163, 102, 0.13)` |
| `--yellow-tint` | `rgba(241, 196, 15, 0.18)` | `rgba(232, 169, 4, 0.16)` |
| `--red-tint` | `rgba(239, 106, 92, 0.18)` | `rgba(224, 80, 63, 0.13)` |
| `--blue-tint` | `rgba(90, 174, 228, 0.18)` | `rgba(63, 143, 206, 0.13)` |
| `--teal-tint` | `rgba(26, 188, 156, 0.18)` | `rgba(20, 161, 132, 0.13)` |
| `--purple-tint` | `rgba(189, 133, 211, 0.18)` | `rgba(165, 101, 196, 0.13)` |
| `--orange-tint` | `rgba(230, 126, 34, 0.18)` | `rgba(224, 123, 30, 0.14)` |
| `--indigo-tint` | `rgba(123, 140, 232, 0.18)` | `rgba(112, 128, 224, 0.14)` |
| `--brand-tint` | `rgba(74, 134, 200, 0.18)` | `rgba(63, 124, 191, 0.13)` |
| `--grey-tint` | `rgba(138, 150, 166, 0.16)` | `rgba(120, 130, 145, 0.13)` |

## One step below a tint

> One step below a tint: tile and card grounds that carry a hue without
> becoming a pill.
> Complete by design. Both families cover the same hues so a component can
> step between them, and a wash nothing happens to reference today is a gap
> in the palette rather than dead code — do not "clean" one out.
> Grey drops with its tint, one step under the 0.07 the hues take.

| Token | Dark | Light |
|---|---|---|
| `--green-wash` | `rgba(46, 204, 113, 0.07)` | `color-mix(in srgb, rgb(34 163 102) 12%, #fff)` |
| `--yellow-wash` | `rgba(241, 196, 15, 0.07)` | `color-mix(in srgb, rgb(232 169 4) 16%, #fff)` |
| `--red-wash` | `rgba(239, 106, 92, 0.07)` | `color-mix(in srgb, rgb(224 80 63) 10%, #fff)` |
| `--blue-wash` | `rgba(90, 174, 228, 0.07)` | `color-mix(in srgb, rgb(63 143 206) 11%, #fff)` |
| `--teal-wash` | `rgba(26, 188, 156, 0.07)` | `color-mix(in srgb, rgb(20 161 132) 11%, #fff)` |
| `--purple-wash` | `rgba(189, 133, 211, 0.07)` | `color-mix(in srgb, rgb(165 101 196) 11%, #fff)` |
| `--orange-wash` | `rgba(230, 126, 34, 0.07)` | `color-mix(in srgb, rgb(224 123 30) 12%, #fff)` |
| `--indigo-wash` | `rgba(123, 140, 232, 0.07)` | `color-mix(in srgb, rgb(112 128 224) 11%, #fff)` |
| `--brand-wash` | `rgba(74, 134, 200, 0.07)` | `color-mix(in srgb, rgb(63 124 191) 11%, #fff)` |
| `--grey-wash` | `rgba(138, 150, 166, 0.06)` | `color-mix(in srgb, rgb(120 130 145) 10%, #fff)` |

## Category series colours

> ── Category series colours ──────────────────────────────────────────────
> Generated in OKLCH and validated, not chosen by eye. Every pair was
> measured for separation under normal, protan and deutan vision against the
> card these sit on; the palette that shipped before failed both themes —
> housing and living were 2.7 apart under deuteranopia where 8 is the floor,
> and in light mode transport and bills were 0.3.
>
> Lightness alternates between adjacent groups on purpose. Equal hue spacing
> does not give equal perceptual spacing: the amber/olive pair collapses to
> 0.7 at a single lightness, and separating on lightness too is what saves it.
>
> Order below is waterfall order, which is the order "adjacent" means.

| Token | Dark | Light |
|---|---|---|
| `--series-income` | `#75a322` | `#83af3e` |
| `--series-taxes` | `#ac2f3b` | `#b23e46` |
| `--series-bills` | `#da7306` | `#e38231` |
| `--series-subscriptions` | `#7d43a8` | `#844fad` |
| `--series-health` | `#7189f3` | `#7e96fb` |
| `--series-transport` | `#786000` | `#826900` |
| `--series-living` | `#d365aa` | `#de75b5` |
| `--series-housing` | `#006b98` | `#0074a4` |
| `--series-savings` | `#00a6ad` | `#00b4bb` |

## Jurisdiction fills for the tax chart

> Jurisdiction fills for the tax chart. A softer step of four series hues,
> deliberately not the traffic-light hues, which must keep meaning
> good/watch/bad.
>
> Each holds its parent's hue angle, so a jurisdiction reads as the same
> colour family as the series it borrows from. Lightness varies PER TOKEN,
> not uniformly: the handoff proposed one shared lightness, and measured,
> that put Germany against Spain at ΔE 1.8 where 8 is the floor — the same
> amber/olive collapse noted above, which only lightness separation fixes.
>
> Dark clears the floor: worst pair 9.7, flattened at the 0.62 → 0.42
> gradient the chart paints. Light does NOT and cannot — see the light
> block. Measurements in scratch-workspace/v0.4.3/soft-token-contrast.md.

| Token | Dark | Light |
|---|---|---|
| `--series-health-soft` | `#6279f1` | `#4556d9` |
| `--series-income-soft` | `#aee659` | `#8cc700` |
| `--series-bills-soft` | `#c96900` | `#d16e00` |
| `--series-taxes-soft` | `#ff7d80` | `#c11435` |

## Reserve, for groups a household adds

> Reserve, for groups a household adds. Ranked by measured separation from
> everything above and from each other: 1 stands on its own, 2–4 need the
> series named beside them, 5–10 are carried by their label and the colour
> only helps. Assign in order; do not reach past what is used.

| Token | Dark | Light |
|---|---|---|
| `--series-r1` | `#008f75` | `#009d81` |
| `--series-r2` | `#007369` | `#008075` |
| `--series-r3` | `#5f6ed7` | `#6b7cdf` |
| `--series-r4` | `#00ad72` | `#23ba7d` |
| `--series-r5` | `#00a0d0` | `#00aee1` |
| `--series-r6` | `#ab6900` | `#bb7400` |
| `--series-r7` | `#9e57b9` | `#a966c2` |
| `--series-r8` | `#008b93` | `#0098a1` |
| `--series-r9` | `#009250` | `#189f5a` |
| `--series-r10` | `#3d5abd` | `#4967c5` |
| `--font-sans` | `'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | — |
| `--font-mono` | `'Source Code Pro', ui-monospace, monospace` | — |

## The type ramp

> The type ramp.
>
> There used to be twenty-two distinct font sizes, and 12 / 12.5 / 13 / 13.5
> were all in heavy use — 267 declarations across those four alone. Half a
> pixel is not a size difference anyone chose; it is drift. But it is visible
> when two such elements sit next to each other, and it was reported as the
> app using different fonts in different places, which is what unequal sizes
> in one family look like.
>
> The steps are the values already most used, so this merged the half-pixel
> neighbours into their nearest whole rather than imposing a new scale. Add a
> step here rather than a one-off px value in a component.

| Token | Dark | Light |
|---|---|---|
| `--text-2xs` | `10px` | — |
| `--text-xs` | `11px` | — |
| `--text-sm` | `12px` | — |
| `--text-md` | `13px` | — |
| `--text-lg` | `14px` | — |
| `--text-xl` | `16px` | — |
| `--text-2xl` | `19px` | — |
| `--text-3xl` | `22px` | — |
| `--text-4xl` | `28px` | — |

## Geometry

> ---- Geometry ----
> Measured from the code rather than chosen. A tidier scale of
> {4,6,8,12,16} was tested against every gap and radius in the product and
> would have visibly moved 112 gaps and 62 corners — that is a restyle, not a
> standardisation. These are the values already dominant, so adopting them is
> invisible, which is the entire point.
>
> Add a step here rather than a one-off px value in a component — the same
> rule the type scale above states, now enforced by design/no-raw-geometry.

| Token | Dark | Light |
|---|---|---|
| `--radius-xs` | `4px` | — |
| `--radius-sm` | `6px` | — |
| `--radius-md` | `8px` | — |
| `--radius-lg` | `10px` | — |
| `--radius-xl` | `12px` | — |
| `--radius-2xl` | `16px` | — |
| `--radius-pill` | `999px` | — |
| `--space-1` | `2px` | — |
| `--space-2` | `4px` | — |
| `--space-3` | `6px` | — |
| `--space-4` | `8px` | — |
| `--space-5` | `10px` | — |
| `--space-6` | `12px` | — |
| `--space-7` | `14px` | — |
| `--space-8` | `16px` | — |

## One height for anything a person types into or presses in a form row

> One height for anything a person types into or presses in a form row.
> The base control layer applies it as a `min-height` to every input, select
> and textarea, and a `.btn` at the default padding and type size already
> measures it — so a control and the button beside it agree without either
> being told about the other. It is a floor, not a fixed height: a textarea
> still grows with its rows, and a control a screen has deliberately made
> smaller keeps its own padding and only stops being SHORTER than this.

| Token | Dark | Light |
|---|---|---|
| `--control-h` | `36px` | — |

## Scan engine

> ── Scan engine ──────────────────────────────────────────────────────────
> Five axes the scan flow reads. Everything in src/lib/scan/client consumes
> these; none of them is written as a literal in a component.
>
> Scrim. These are `--plate`'s DARK values, held constant when the theme
> flips — the one place the scan flow does not follow the theme, and it is
> deliberate. The chrome AROUND the viewfinder is themed; what floats ON the
> feed is not, because a camera frame's luminance is unknown and changes
> every frame. Do NOT add a light override: near-white text is correct over
> a light page and unreadable over a dark kitchen at night, which is the
> primary usage context.

| Token | Dark | Light |
|---|---|---|
| `--scan-plate` | `rgba(14, 17, 23, 0.72)` | — |
| `--scan-plate-edge` | `rgba(14, 17, 23, 0.86)` | — |
| `--scan-ink` | `#e6e9ef` | — |

## Detection state

> Detection state. The primary signal is stroke WEIGHT and DASH; colour only
> reinforces it, so the four states stay separable in greyscale and over an
> unpredictable backdrop. Rejected dashes TIGHTER than searching — a
> different rhythm, not just a different hue.
>
> `searching` has a colour but no weight or dash, because it draws no
> outline: no page found means no box, since a speculative outline is a
> claim the detector has not made. See OUTLINE in ScanCapture.svelte.

| Token | Dark | Light |
|---|---|---|
| `--detect-searching` | `var(--fg3)` | — |
| `--detect-found` | `var(--blue)` | — |
| `--detect-stable` | `var(--green)` | — |
| `--detect-rejected` | `var(--yellow)` | — |
| `--detect-w-found` | `2px` | — |
| `--detect-w-stable` | `3px` | — |
| `--detect-dash-rejected` | `4 4` | — |

## Safe area

> Safe area. The home indicator sits exactly where the shutter wants to be.
> Left and right matter too — a landscape phone has insets on the long
> edges. Every edge control is inset by the relevant token PLUS its own
> padding, never by a guessed constant.

| Token | Dark | Light |
|---|---|---|
| `--safe-top` | `env(safe-area-inset-top, 0px)` | — |
| `--safe-bottom` | `env(safe-area-inset-bottom, 0px)` | — |
| `--safe-left` | `env(safe-area-inset-left, 0px)` | — |
| `--safe-right` | `env(safe-area-inset-right, 0px)` | — |

## Touch

> Touch. 44 is the floor, not the target, and it applies to every control in
> the scan flow — including ones inheriting the base input layer, which
> resolves to 34px: right for a desktop form row, ten pixels short on a
> phone held one-handed.

| Token | Dark | Light |
|---|---|---|
| `--touch-min` | `44px` | — |
| `--shutter-size` | `72px` | — |

## Motion

> Motion. The easing is seeded from the one transition the product already
> has; the durations are NOT, and that took three attempts. 90ms is right
> for a 1px tint changing in place and is below the threshold of visible
> movement across the height of a screen. 300ms still read as a flicker on a
> real phone. 700ms is long enough to follow the page down to the counter —
> which is the information the beat carries — and still ends before you can
> study it.
>
> RESERVED, and read by nothing today: these three belong to the capture
> collapse — the outline travelling into the thumbnail — which the design
> specifies and no rule has implemented. The values are kept because they
> were measured rather than picked, and the reasoning above is what would
> otherwise have to be rediscovered.

| Token | Dark | Light |
|---|---|---|
| `--motion-snap` | `90ms` | — |
| `--motion-capture` | `700ms` | — |
| `--motion-settle` | `220ms` | — |
| `--ease-out` | `cubic-bezier(0.2, 0, 0.2, 1)` | — |

## Elevation

> ── Elevation ────────────────────────────────────────────────────────────
> Two, and only two, because a page with five depths has none.
>
> In the document flow nothing is raised: a card is separated by its ground
> and its 1px border, and a shadow there is decoration standing in for a
> boundary that already exists. What DOES float — a tooltip, a picker, a menu
> — is a different case: it sits over unpredictable content, and without a
> shadow its edge is the only thing telling a reader where the page stopped
> and the overlay began. That is information, not styling.
>
> Both are near-black rather than a tinted colour: a shadow tinted in one
> theme reads as a glow in the other, and these are the only two colour
> values in the system deliberately not drawn from a hue token.

| Token | Dark | Light |
|---|---|---|
| `--shadow-float` | `0 10px 30px rgb(0 0 0 / 0.55)` | `0 8px 28px -8px rgb(60 52 40 / 0.35), 0 1px 3px rgb(60 52 40 / 0.12)` |
| `--shadow-raise` | `0 4px 14px rgb(0 0 0 / 0.35)` | — |

## v0.8.1, the v2 skin

> ── v0.8.1, the v2 skin ────────────────────────────────────────────────
> Promoted here from `design_system/design_handoff_continuum_v2/tokens/`
> rather than loaded as a second stylesheet beside this one, because
> `scripts/design-tokens.mjs` reads THIS file to build the reference and to
> check that no canvas quotes a value which has drifted. A token living
> anywhere else is a token the drift check cannot see.
>
> Geometry named by what wears it. Aliases, not new numbers: a card and a
> tile step two rungs up the scale, a control one.

| Token | Dark | Light |
|---|---|---|
| `--radius-card` | `var(--radius-2xl)` | — |
| `--radius-tile` | `var(--radius-xl)` | — |
| `--radius-ctl` | `var(--radius-lg)` | — |

## A ground one step brighter than --card, so a card has something to lift

> A ground one step brighter than --card, so a card has something to lift
> off and a shadow has somewhere to fall.

| Token | Dark | Light |
|---|---|---|
| `--surface` | `rgba(255, 255, 255, 0.045)` | `#ffffff` |
| `--surface-2` | `rgba(255, 255, 255, 0.075)` | `#f3efe7` |
| `--surface-3` | `rgba(255, 255, 255, 0.11)` | `#e4ded2` |

## Elevation in the flow

> Elevation in the flow. The rule until now was that nothing in the flow is
> raised; v2 allows exactly one quiet value for a card, plus one for the two
> things that are meant to read as lit — the net-worth hero and quick-add.

| Token | Dark | Light |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgb(0 0 0 / 0.28), 0 12px 32px -16px rgb(0 0 0 / 0.55)` | `0 1px 2px rgb(60 52 40 / 0.08), 0 14px 36px -18px rgb(60 52 40 / 0.32)` |
| `--shadow-hero` | `0 18px 44px -22px color-mix(in srgb, var(--brand) 70%, transparent)` | `0 18px 44px -20px color-mix(in srgb, var(--brand) 55%, transparent)` |

## Motion

> Motion. The easing is the one already here under its v2 name; two
> durations join the 90ms press, which is unchanged.

| Token | Dark | Light |
|---|---|---|
| `--ease` | `var(--ease-out)` | — |
| `--dur` | `150ms` | — |
| `--dur-slow` | `260ms` | — |

## An icon tile is a hue mixed into the ground behind a stroke icon

> An icon tile is a hue mixed into the ground behind a stroke icon.

| Token | Dark | Light |
|---|---|---|
| `--tile-alpha` | `16%` | `17%` |
| `--tile-alpha-active` | `28%` | `28%` |

## Headline figures in the sans — the one sanctioned exception to "every

> Headline figures in the sans — the one sanctioned exception to "every
> number in mono". Table figures, dates, IDs and pills stay mono.

| Token | Dark | Light |
|---|---|---|
| `--font-display` | `var(--font-sans)` | — |
| `--display-tracking` | `-0.03em` | — |

## The sizes those figures need

> The sizes those figures need. The ramp above tops out at 28px because
> nothing before v2 printed a number larger than a panel heading.

| Token | Dark | Light |
|---|---|---|
| `--text-5xl` | `30px` | — |
| `--display-hero` | `26px` | — |
| `--display-figure` | `24px` | — |
| `--display-sm` | `20px` | — |
| `--display-xs` | `17px` | — |
