/** Keep a calendar filter only while the newly loaded month contains that day. */
export function selectedDayForMonth(
	selectedDay: string | null,
	dates: readonly string[]
): string | null {
	return selectedDay && dates.includes(selectedDay) ? selectedDay : null;
}

/** Route data is the source of truth after same-route and history navigation. */
export function syncedDocumentState(input: { query: string; prefillOpen: boolean }) {
	return { query: input.query, adding: input.prefillOpen };
}
