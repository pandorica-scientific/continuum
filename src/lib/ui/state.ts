/**
 * Which day the calendar agenda is showing.
 *
 * Always exactly one. A month-wide agenda is a list nobody reads — it scrolls
 * past whatever is actually next — so the screen answers "what is on today"
 * and the grid is how you ask about another day.
 *
 * Keeps the current selection while the newly loaded month still contains it;
 * otherwise falls to today, and to the first of the month when today is
 * somewhere else entirely.
 */
export function selectedDayForMonth(
	selectedDay: string | null,
	dates: readonly string[],
	today?: string
): string | null {
	if (selectedDay && dates.includes(selectedDay)) return selectedDay;
	if (today && dates.includes(today)) return today;
	return dates[0] ?? null;
}

/** Route data is the source of truth after same-route and history navigation. */
export function syncedDocumentState(input: { query: string; prefillOpen: boolean }) {
	return { query: input.query, adding: input.prefillOpen };
}
