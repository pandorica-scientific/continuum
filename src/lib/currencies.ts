// Client-safe currency helpers. The selectable list itself is derived
// server-side from the FX rate table (see $lib/server/fx/currencies), so any
// currency the rate source quotes is usable without a code change.

/** Human label for a currency code, e.g. "CZK — Czech koruna". */
export function currencyLabel(code: string): string {
	try {
		const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code);
		return name && name !== code ? `${code} — ${name}` : code;
	} catch {
		return code;
	}
}
