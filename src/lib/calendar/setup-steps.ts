// What someone has to do at the provider's end before connecting.
//
// The registry's `hint` is one line under the form; this is the walkthrough
// behind the ⓘ. Kept here rather than in the Settings screen so a provider owns
// its own instructions, and kept as data rather than markup so it can be shown
// in a bubble, a page, or the docs without being rewritten.

export interface SetupGuide {
	steps: string[];
	/** The one thing that goes wrong most often, said plainly. */
	warning?: string;
	docs?: string;
}

export const SETUP_GUIDES: Record<string, SetupGuide> = {
	icloud: {
		steps: [
			'Sign in at appleid.apple.com.',
			'Go to Sign-In and Security → App-Specific Passwords.',
			'Generate one and call it “Continuum”.',
			'Paste your Apple ID and that password here, and press Connect.',
			'Then choose which iCloud calendar to sync with.'
		],
		warning:
			'Your normal Apple ID password will not work — iCloud only accepts an app-specific password for calendar access.'
	},

	google: {
		steps: [
			'Create a project at console.cloud.google.com (free, no billing needed).',
			'APIs & Services → Library → enable the Google Calendar API.',
			'OAuth consent screen (newer consoles: Google Auth Platform → Data Access) → add the scope .../auth/calendar.app.created — the narrow one, which needs no approval.',
			'Press “Publish app” so the status reads “In production”, NOT “Testing”.',
			'Credentials → Create OAuth client ID → Web application.',
			'Add this address plus /settings/google/callback as an authorised redirect URI.',
			'Paste the client ID and secret here, then press Authorise.',
			'Press “Choose a calendar” — Continuum makes one called “Continuum” and syncs only that.'
		],
		warning:
			'If Google says “can only be accessed by developer-approved testers”, the consent screen is still on Testing — press “Publish app” under Audience. Leaving it on Testing also expires the token after 7 days, so sync would stop weekly. Publishing needs no verification and is free.',
		docs: 'docs/google-calendar-setup.md'
	}
};
