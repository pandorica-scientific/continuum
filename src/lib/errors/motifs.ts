// The easter egg: clicking the rings on an error screen redraws them as a
// scene. Line art only, one colour, the same 340 box the rings use — so the
// swap is a redraw rather than a layout change.
//
// Transcribed from the design's motif table by script rather than retyped: a
// mistyped arc command fails silently, still rendering, just wrong.

export interface MotifPath {
	d: string;
	/** stroke-width */
	w: number;
	/** opacity */
	o: number;
	/** stroke-dasharray, when the line is meant to break up */
	dash?: string;
	/** degrees about the centre of the box */
	rot?: number;
}

export const MOTIFS: Record<string, MotifPath[]> = {
	// arcs shuffled out of sequence, and an arrow pointing back the way it came
	'400': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M170,110 A60,60 0 0 1 170,230', w: 6, o: 0.9, rot: 18 },
		{ d: 'M170,124 A46,46 0 0 1 170,216', w: 5.4, o: 0.55, rot: 168 },
		{ d: 'M170,138 A32,32 0 0 1 170,202', w: 5, o: 0.35, rot: 292 },
		{ d: 'M198,170 H146', w: 4.4, o: 0.9 },
		{ d: 'M158,160 L146,170 L158,180', w: 4.4, o: 0.9 }
	],
	// a watch on a chain, hands stopped
	'401': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M170,214 m-46,-44 a46,46 0 1,0 92,0 a46,46 0 1,0 -92,0', w: 5.6, o: 0.9 },
		{ d: 'M170,214 m-36,-44 a36,36 0 1,0 72,0 a36,36 0 1,0 -72,0', w: 3.2, o: 0.3 },
		{ d: 'M170,168 v-10', w: 5, o: 0.9 },
		{ d: 'M170,158 m-8,0 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0', w: 4.4, o: 0.9 },
		{ d: 'M164,150 C150,138 152,124 138,116 C126,109 122,98 124,88', w: 3.6, o: 0.5 },
		{ d: 'M170,170 v-26 M170,170 l22,12', w: 4.4, o: 0.9 }
	],
	// a keyhole, locked from the far side
	'403': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M170,170 m-72,0 a72,72 0 1,0 144,0 a72,72 0 1,0 -144,0', w: 4.4, o: 0.28 },
		{ d: 'M170,148 m-18,0 a18,18 0 1,0 36,0 a18,18 0 1,0 -36,0', w: 5.6, o: 0.9 },
		{ d: 'M158,162 L148,212 H192 L182,162', w: 5.6, o: 0.9 },
		{ d: 'M212,154 h22', w: 4, o: 0.4 },
		{ d: 'M212,186 h22', w: 4, o: 0.25 }
	],
	// a door standing on its own, ajar, with nothing behind it
	'404': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M126,96 h72 v148 h-72 z', w: 5.2, o: 0.85 },
		{ d: 'M198,110 l26,-12 v128 l-26,-12 z', w: 4.6, o: 0.9 },
		{ d: 'M190,172 h6', w: 5, o: 0.9 },
		{ d: 'M204,252 l34,26 M216,252 l40,18', w: 3.6, o: 0.3 },
		{ d: 'M104,244 h140', w: 3.6, o: 0.22 }
	],
	// an hourglass, run through
	'408': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M132,104 h76 M132,236 h76', w: 5.2, o: 0.9 },
		{ d: 'M140,104 L170,170 L140,236', w: 5.2, o: 0.9 },
		{ d: 'M200,104 L170,170 L200,236', w: 5.2, o: 0.9 },
		{ d: 'M146,236 C150,206 190,206 194,236', w: 4.4, o: 0.55 },
		{ d: 'M170,178 v18', w: 3.6, o: 0.3 }
	],
	// the same arc arriving three times, out of step
	'429': [
		{ d: 'M118,110 A60,60 0 0 1 118,230', w: 5.6, o: 0.9 },
		{ d: 'M152,110 A60,60 0 0 1 152,230', w: 5.2, o: 0.45 },
		{ d: 'M186,110 A60,60 0 0 1 186,230', w: 4.8, o: 0.22 },
		{ d: 'M220,110 A60,60 0 0 1 220,230', w: 4.4, o: 0.1 },
		{ d: 'M244,152 h34 M244,170 h48 M244,188 h26', w: 4, o: 0.5 }
	],
	// the inner ring split open, throwing sparks
	'500': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M170,104 A66,66 0 0 1 214,132', w: 5.6, o: 0.9 },
		{ d: 'M214,132 l-16,10 l20,10 l-18,12', w: 5, o: 0.9 },
		{ d: 'M212,192 A66,66 0 0 1 170,236', w: 5.6, o: 0.9 },
		{ d: 'M244,150 l20,-12 M250,176 l24,4 M238,124 l12,-20', w: 4, o: 0.55 },
		{ d: 'M170,170 m-9,0 a9,9 0 1,0 18,0 a9,9 0 1,0 -18,0', w: 4.4, o: 0.7 }
	],
	// two links that no longer meet
	'502': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M96,146 h44 a24,24 0 0 1 0,48 h-44 a24,24 0 0 1 0,-48 z', w: 5.4, o: 0.9 },
		{ d: 'M244,146 h-42 a24,24 0 0 0 0,48 h42 a24,24 0 0 0 0,-48 z', w: 5.4, o: 0.9 },
		{ d: 'M156,170 h8 M176,170 h8', w: 4.4, o: 0.35 },
		{ d: 'M170,124 v-14 M170,216 v14', w: 3.6, o: 0.25 }
	],
	// someone is under the floor with a spanner
	'503': [
		{ d: 'M170,44 A126,126 0 0 1 170,296', w: 4, o: 0.12 },
		{ d: 'M170,16 A154,154 0 0 1 170,324', w: 4, o: 0.07 },
		{ d: 'M126,224 L206,144', w: 6, o: 0.9 },
		{ d: 'M204,142 a26,26 0 1,0 22,22 l-18,-6 l-10,-10 z', w: 5.4, o: 0.9 },
		{ d: 'M118,232 m-12,0 a12,12 0 1,0 24,0 a12,12 0 1,0 -24,0', w: 4.6, o: 0.7 },
		{ d: 'M104,120 h58 M104,144 h34', w: 4, o: 0.3 }
	],
	// a signal thinning out into distance
	'000': [
		{ d: 'M120,120 A72,72 0 0 1 120,220', w: 5.4, o: 0.55, dash: '2 12' },
		{ d: 'M150,134 A52,52 0 0 1 150,206', w: 5, o: 0.34, dash: '2 14' },
		{ d: 'M180,146 A34,34 0 0 1 180,194', w: 4.6, o: 0.2, dash: '2 16' },
		{ d: 'M214,170 h14 M244,170 h8 M266,170 h4', w: 4.2, o: 0.4 },
		{ d: 'M290,170 m-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0', w: 4, o: 0.9 }
	]
};
