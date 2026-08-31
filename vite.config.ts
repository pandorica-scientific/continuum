import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter(),

			// Turned off because src/lib/server/auth/csrf.ts replaces it, NOT because the
			// protection is unwanted. SvelteKit's version compares Origin against
			// url.origin, which adapter-node pins to the ORIGIN environment variable —
			// one address — so every other address the server answers on had its form
			// posts refused. The check runs before the handle hook, so a hook cannot
			// soften it; disabling it here is the only place the replacement can live.
			// The replacement compares Origin against the request's own Host, which is
			// the same protection without the single-address assumption.
			csrf: { trustedOrigins: ['*'] }
		})
	],
	build: {
		/**
		 * The card artwork is always a file, never inlined.
		 *
		 * Vite inlines any asset under 4 kB as a base64 data URI. At the size
		 * these are encoded now none of them is anywhere near it, but they were
		 * once: 70 of the 121 faces went into the Documents page's own chunk, 424
		 * kB of JavaScript that a household downloaded in full to draw the two
		 * cards it owns. The rule stays because it is about what these files ARE
		 * — one is fetched when a card needs it and cached by its own hash — not
		 * about what they currently weigh.
		 *
		 * `undefined` for everything else, so the default still applies to the
		 * favicon and anything small that genuinely belongs in the bundle.
		 */
		assetsInlineLimit: (filePath: string) =>
			filePath.includes('doc-placeholders') ? false : undefined
	},
	test: {
		include: [
			'src/**/*.test.ts',
			'tests/unit/**/*.test.ts',
			'tests/integration/**/*.test.ts',
			'tests/acceptance/**/*.test.ts'
		],
		environment: 'node'
	}
});
