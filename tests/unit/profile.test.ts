import { describe, expect, it } from 'vitest';
import { candidateGrids } from '$lib/server/import/tabular/grid';
import { chooseGrid } from '$lib/server/import/tabular/regions';
import {
	fromDocument,
	headerSignature,
	headersOf,
	matchProfile,
	profileFromReading,
	rolesFromProfile,
	toDocument,
	type ImportProfile
} from '$lib/server/import/tabular/profile';
import { readTabular } from '$lib/server/import/tabular/statement';

const HEADERS = ['Fecha', 'Concepto', 'Importe', 'Saldo'];

const profile = (over: Partial<ImportProfile> = {}): ImportProfile =>
	profileFromReading({
		id: 'p1',
		name: 'Banco Ficticio',
		source: 'delimited',
		delimiter: ';',
		encoding: 'utf-8',
		headers: HEADERS,
		roles: ['bookingDate', 'description', 'amount', 'balance'],
		dateOrder: 'day-first',
		decimalMark: ',',
		...over
	});

describe('header signatures', () => {
	it('ignores case and accents, so a re-styled label is the same layout', () => {
		expect(headerSignature(['Fecha', 'Importe'])).toBe(headerSignature(['FECHA', 'importe']));
		expect(headerSignature(['Částka'])).toBe(headerSignature(['castka']));
	});

	it('ignores column ORDER, because moving a column changes no meaning', () => {
		expect(headerSignature(['Fecha', 'Importe'])).toBe(headerSignature(['Importe', 'Fecha']));
	});

	it('changes when a column is added, removed or renamed', () => {
		const base = headerSignature(HEADERS);
		expect(headerSignature([...HEADERS, 'Divisa'])).not.toBe(base);
		expect(headerSignature(HEADERS.slice(1))).not.toBe(base);
		expect(headerSignature(['Fecha', 'Concepto', 'Cantidad', 'Saldo'])).not.toBe(base);
	});
});

describe('matching', () => {
	it('matches an unchanged layout', () => {
		expect(matchProfile(HEADERS, [profile()])).toMatchObject({ kind: 'match' });
	});

	it('reports DRIFT when the bank adds a column, naming what changed', () => {
		const result = matchProfile([...HEADERS, 'Divisa'], [profile()]);
		expect(result.kind).toBe('drifted');
		if (result.kind === 'drifted') {
			expect(result.added).toEqual(['divisa']);
			expect(result.removed).toEqual([]);
		}
	});

	it('reports drift when a column is dropped', () => {
		const result = matchProfile(['Fecha', 'Concepto', 'Importe'], [profile()]);
		expect(result.kind).toBe('drifted');
		if (result.kind === 'drifted') expect(result.removed).toEqual(['saldo']);
	});

	it('does not claim a different bank as drift', () => {
		expect(matchProfile(['Datum', 'Objem', 'Měna', 'Protiúčet'], [profile()]).kind).toBe('none');
	});
});

describe('applying a profile', () => {
	it('resolves roles by NAME, so a reordered export still maps correctly', () => {
		// Firefly III maps by column index; a bank inserting a column silently
		// shifts every role one to the right and the import still "succeeds".
		const reordered = ['Saldo', 'Fecha', 'Importe', 'Concepto'];
		expect(rolesFromProfile(profile(), reordered)).toEqual([
			'balance',
			'bookingDate',
			'amount',
			'description'
		]);
	});

	it('leaves an unknown column unmapped rather than guessing', () => {
		expect(rolesFromProfile(profile(), ['Fecha', 'Referencia'])).toEqual([
			'bookingDate',
			undefined
		]);
	});

	it('reads a file using the remembered mapping, and still demands proof', () => {
		const file = [
			'Saldo inicial;1000,00 EUR',
			'Saldo final;1150,00 EUR',
			'',
			'Fecha;Concepto;Importe;Saldo',
			'01/03/2025;NOMINA;300,00;1300,00',
			'05/03/2025;COMPRA;-50,00;1250,00',
			'09/03/2025;ALQUILER;-100,00;1150,00'
		].join('\n');
		const choice = chooseGrid(candidateGrids(new TextEncoder().encode(file)))!;
		const region = choice.transactions[0];
		const saved = profile();

		// Every date here is 12 or lower, so unaided the reader would have to ask.
		expect(readTabular(choice, region).questions.map((q) => q.dimension)).toContain('dateOrder');

		// With the confirmed layout it reads without asking — the profile answers
		// the question a person already answered once.
		const guided = readTabular(choice, region, {
			roles: rolesFromProfile(saved, headersOf(region)),
			dateOrder: saved.mapping.dateOrder,
			decimalMark: saved.mapping.decimalMark
		});
		expect(guided.questions).toEqual([]);
		expect(guided.statement?.rows).toHaveLength(3);
		expect(guided.statement?.rows[0].bookedAt).toBe('2025-03-01');
		const sum = guided.statement!.rows.reduce((a, r) => a + r.amountMinor, 0n);
		expect(guided.statement!.openingBalanceMinor! + sum).toBe(
			guided.statement!.closingBalanceMinor
		);
	});
});

describe('sharing a profile', () => {
	it('round-trips through its portable document', () => {
		const document = toDocument(profile());
		const restored = fromDocument(document, 'p2');
		expect(restored.signature).toBe(profile().signature);
		expect(restored.mapping.columns).toEqual(profile().mapping.columns);
	});

	it('carries no ids or timestamps that mean nothing elsewhere', () => {
		expect(Object.keys(toDocument(profile()))).not.toContain('id');
		expect(Object.keys(toDocument(profile()))).not.toContain('version');
	});

	it("marks an imported profile unverified — it is somebody else's confirmation", () => {
		expect(fromDocument(toDocument(profile()), 'p3').verified).toBe(false);
		expect(fromDocument(toDocument(profile()), 'p3').origin).toBe('imported');
	});

	it('refuses a file that is not a profile', () => {
		expect(() => fromDocument({ hello: 'world' }, 'x')).toThrow(/not a Continuum import profile/);
		expect(() => fromDocument({ continuumProfile: 1 }, 'x')).toThrow(/missing/);
	});
});
