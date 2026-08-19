// What someone has to do at the provider's end before connecting.
//
// The registry's `hint` is one line under the form; this is the walkthrough
// behind the ⓘ. Kept here rather than in the Settings screen so a provider owns
// its own instructions, and kept as data rather than markup so it can be shown
// in a bubble, a page, or the docs without being rewritten.

interface SetupGuide {
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

	// Rewritten from a setup that actually worked, in the order it worked in.
	// Every line here corresponds to something that went wrong first.
	google: {
		steps: [
			'console.cloud.google.com → create a project. Free, no billing.',
			'APIs & Services → Library → enable “Google Calendar API”.',
			'Google Auth Platform → Data Access → add ONLY the scope ending .../auth/calendar.app.created',
			'Google Auth Platform → Audience → Publish app, so the status reads “In production”.',
			'Clients → Create client → Web application.',
			'Authorised redirect URI: this exact address plus /settings/google/callback',
			'Paste the client ID and secret below, press Authorise, and click through the “unverified app” warning.',
			'Press “Create a calendar” — Continuum makes one called Continuum and syncs only that.'
		],
		warning:
			'Use the narrow calendar.app.created scope, not .../auth/calendar. The broad one grants read and delete over every calendar in the account, and Google flags it as needing approval — which is what blocks the connection. And publish the app: left on “Testing” the authorisation expires after 7 days and sync stops weekly.',
		docs: 'docs/google-calendar-setup.md'
	}
};
