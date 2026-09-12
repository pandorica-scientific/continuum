export interface StampOptions {
  /** Display name, required; at most 120 characters after whitespace normalization. */
  name: string;
  /** Optional ISO alpha-2 code. A known, unambiguous city can infer it. */
  country?: string;
  /** Explicit lookup such as "cz-prague"; name remains the display label. */
  destinationId?: string;
  /** Deterministic integer, 0 through 4294967295. */
  seed?: number;
  icon?: string;
  /** A regional identifier, or "neutral". */
  region?: string;
  border?: string;
  layout?: string;
  palette?: string;
  /** Six-digit hex color such as "#255e83". */
  color?: string;
  type?: string;
  motif?: string | null;
  wear?: string;
}
export interface StampDefinition extends Required<Omit<StampOptions,'destinationId'>> {}
export interface StampResult {
  svg: string;
  definition: StampDefinition;
  destinationId: string | null;
  source: 'landmark' | 'shared-symbol' | 'generic';
}
export function generateStamp(options: StampOptions): string;
export function createStamp(options: StampOptions): StampResult;
export function renderStamp(definition: StampOptions): string;
export function renderIcon(id: string, color?: string): string;
export interface Component { id: string; label: string; [key: string]: unknown }
export const borders: Component[];
export const layouts: Component[];
export const palettes: (Component & {color:string})[];
export const typography: Component[];
export const motifs: Component[];
export const wear: Component[];
export const regions: Component[];
export const neutralRegion: Component;
export const symbols: Record<string,Component & {svg:string}>;
export const landmarks: Record<string,Component & {svg:string;city:string}>;
export const destinations: {id:string;name:string;country:string;region:string;icon:string;kind:string;iconKind:string}[];
