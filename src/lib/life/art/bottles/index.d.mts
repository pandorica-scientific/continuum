export type BottleType =
	| 'bordeaux'
	| 'burgundy'
	| 'champagne'
	| 'riesling'
	| 'whisky'
	| 'gin'
	| 'beer'
	| 'cognac';

export interface LabelBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BottleShape {
	/** Human-readable name of the silhouette, for a gallery. */
	label: string;
	/** Six-digit hex; the glass the bottle is blown from. */
	glass: string;
	/** Six-digit hex; the capsule or crown. */
	cap: string;
	/** The silhouette path, in the 400 × 160 viewBox. */
	body: string;
	/** Exact coordinates of the label plate, for placing a photograph. */
	labelBox: LabelBox;
}

export interface BottleOptions {
	type?: BottleType;
	/** An image URL, a relative path, or a raster data URL. */
	labelImage?: string;
	/** `contain` keeps the whole photograph; `cover` crops it to fill. */
	labelFit?: 'contain' | 'cover';
	/** Six-digit hex overrides for the silhouette's own colours. */
	glass?: string;
	cap?: string;
	/** The accessible name of the drawing. */
	title?: string;
	/** 40 to 4096. */
	width?: number;
	/** Unique per inline SVG on a page, or ids collide between instances. */
	idPrefix?: string;
}

export const bottles: Record<BottleType, BottleShape>;
export function renderBottle(options?: BottleOptions): string;
