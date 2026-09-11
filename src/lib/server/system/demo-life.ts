// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Life half of the demo household.
 *
 * Its own module rather than another six hundred lines in `demo.ts`, which is
 * already the longest file in the project. `seedDemo` calls this last, once the
 * people exist, because everything here hangs off them.
 *
 * The fixtures are invented and deliberately generic — the handoff's own rule.
 * Nothing here is the household's real cellar or its real holidays; the point
 * is that every screen has enough on it to be judged.
 *
 * Dates are relative to today, so the demo never drifts into a state where
 * every trip is in the past and the map has nothing left to reveal.
 */
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import {
	bottle,
	collection,
	recipe,
	recipeCategory,
	recipeIngredient,
	recipeStep,
	recipeTag,
	recipeTagLink,
	tasting,
	tastingNote,
	trip,
	tripBooking,
	tripDestination,
	tripIdea,
	tripIdeaHeart,
	tripMember,
	tripPlace,
	visit,
	visitMember
} from '$lib/server/db/schema';
import { resolveDish, resolveStamp } from '$lib/life/art';

/** Today, and a day a given number of days from it, as ISO days. */
const DAY = 86_400_000;
const isoDay = (offsetDays: number): string =>
	new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const isoTime = (offsetDays: number, hour: number, minute = 0): Date => {
	const date = new Date(Date.now() + offsetDays * DAY);
	date.setUTCHours(hour, minute, 0, 0);
	return date;
};
const thisYear = new Date().getUTCFullYear();

interface TripSeed {
	name: string;
	emoji: string;
	/** Days from today. Negative is a trip already taken. */
	startsIn: number;
	nights: number;
	notes?: string;
	destinations: { country: string; region?: string; city?: string }[];
	members: 'both' | 'jana' | 'petr';
	bookings?: {
		kind: 'flight' | 'train' | 'bus' | 'ferry' | 'car' | 'hotel' | 'other';
		title: string;
		/** Days from the trip's own start. */
		day: number;
		hour: number;
		nights?: number;
		reference?: string;
	}[];
	places?: string[];
}

/**
 * Two trips ahead, six behind, across three years and eight countries.
 *
 * Enough for the stamp wall to have a year worth folding, for the map to have
 * something to scratch, and for one upcoming trip to be close enough that a
 * passport expiring "within six months of return" is a real warning rather than
 * a hypothetical one.
 */
const TRIPS: TripSeed[] = [
	{
		name: 'Porto and the Douro',
		emoji: '🇵🇹',
		startsIn: 24,
		nights: 7,
		notes: 'Train up the valley on the Wednesday. Nothing else booked on purpose.',
		destinations: [
			{ country: 'PT', region: 'Porto', city: 'Porto' },
			{ country: 'PT', region: 'Vila Real' }
		],
		members: 'both',
		bookings: [
			{ kind: 'flight', title: 'Prague → Porto', day: 0, hour: 9, reference: 'QR7T2M' },
			{ kind: 'hotel', title: 'Guesthouse in Ribeira', day: 0, hour: 15, nights: 4 },
			{ kind: 'train', title: 'Porto → Pinhão', day: 4, hour: 8, reference: 'CP-884120' },
			{ kind: 'hotel', title: 'Quinta above the river', day: 4, hour: 14, nights: 3 },
			{ kind: 'flight', title: 'Porto → Prague', day: 7, hour: 18, reference: 'QR7T2M' }
		],
		places: ['Livraria Lello', 'The Wednesday market', 'A boat on the Douro', 'Bolhão']
	},
	{
		name: 'A weekend in Vienna',
		emoji: '🎻',
		startsIn: 61,
		nights: 2,
		destinations: [{ country: 'AT', region: 'Vienna', city: 'Vienna' }],
		members: 'jana',
		bookings: [
			{ kind: 'train', title: 'Praha hl.n. → Wien Hbf', day: 0, hour: 7, reference: 'RJ-73' },
			{ kind: 'hotel', title: 'Small hotel near Naschmarkt', day: 0, hour: 14, nights: 2 },
			{ kind: 'train', title: 'Wien Hbf → Praha hl.n.', day: 2, hour: 17, reference: 'RJ-78' }
		],
		places: ['Kunsthistorisches', 'Café Sperl']
	},
	{
		name: 'Split and the islands',
		emoji: '⛵',
		startsIn: -120,
		nights: 9,
		destinations: [
			{ country: 'HR', region: 'Split-Dalmatia', city: 'Split' },
			{ country: 'HR', region: 'Dubrovnik-Neretva' }
		],
		members: 'both',
		places: ['Diocletian’s cellars', 'The ferry to Hvar']
	},
	{
		name: 'Kraków for the long weekend',
		emoji: '🥟',
		startsIn: -240,
		nights: 3,
		destinations: [{ country: 'PL', region: 'Lesser Poland', city: 'Kraków' }],
		members: 'both'
	},
	{
		name: 'Berlin, for the exhibition',
		emoji: '🖼️',
		startsIn: -310,
		nights: 2,
		destinations: [{ country: 'DE', region: 'Berlin', city: 'Berlin' }],
		members: 'petr'
	},
	{
		name: 'Santiago, on foot',
		emoji: '🐚',
		startsIn: -520,
		nights: 12,
		notes: 'Walked the last hundred kilometres. Would do it again.',
		destinations: [{ country: 'ES', region: 'Galicia', city: 'Santiago de Compostela' }],
		members: 'jana'
	},
	{
		name: 'Kyoto in the autumn',
		emoji: '🍁',
		startsIn: -700,
		nights: 11,
		destinations: [
			{ country: 'JP', region: 'Kyoto', city: 'Kyoto' },
			{ country: 'JP', region: 'Osaka' }
		],
		members: 'both'
	},
	{
		name: 'A week in the Tatras',
		emoji: '🏔️',
		startsIn: -880,
		nights: 6,
		destinations: [{ country: 'SK', region: 'Prešov' }],
		members: 'both'
	}
];

/** Places the household has been that predate Continuum, typed in by hand. */
const MANUAL_VISITS: { country: string; region?: string; city?: string; year: number }[] = [
	{ country: 'IT', region: 'Tuscany', city: 'Florence', year: thisYear - 5 },
	{ country: 'IT', region: 'Veneto', year: thisYear - 5 },
	{ country: 'FR', region: 'Île-de-France', city: 'Paris', year: thisYear - 7 },
	{ country: 'GB', region: 'England', city: 'London', year: thisYear - 8 },
	{ country: 'NL', region: 'North Holland', city: 'Amsterdam', year: thisYear - 9 },
	{ country: 'GR', region: 'Attica', city: 'Athens', year: thisYear - 10 },
	{ country: 'CZ', region: 'Prague', city: 'Prague', year: thisYear - 12 },
	{ country: 'CZ', region: 'South Moravian', year: thisYear - 4 },
	{ country: 'AT', region: 'Tyrol', year: thisYear - 6 }
];

const IDEAS: { name: string; emoji: string; country: string; note: string; hearts: string[] }[] = [
	{
		name: 'Lofoten',
		emoji: '🏔️',
		country: 'NO',
		note: 'For the light in summer, when it does not go dark.',
		hearts: ['jana', 'petr']
	},
	{
		name: 'Lisbon again',
		emoji: '🚋',
		country: 'PT',
		note: 'We keep coming back to this one.',
		hearts: ['jana', 'petr']
	},
	{
		name: 'Iceland, the ring road',
		emoji: '🌋',
		country: 'IS',
		note: 'Two weeks and a car, no plan beyond that.',
		hearts: ['petr']
	},
	{
		name: 'Sicily in spring',
		emoji: '🍋',
		country: 'IT',
		note: 'Before it gets too hot to walk anywhere.',
		hearts: ['jana']
	}
];

interface RecipeSeed {
	name: string;
	emoji: string;
	category: string;
	description: string;
	servings: number;
	minutes: number;
	tags: string[];
	ingredients: [quantity: number | null, unit: string, name: string][];
	steps: string[];
}

/** The rail's shelves, each with its own mark so the four are tellable apart. */
const RECIPE_CATEGORIES: [name: string, emoji: string][] = [
	['Weeknight', '🍳'],
	['For guests', '🥘'],
	['Baking', '🥐'],
	['Slow things', '🍲']
];

/**
 * Tag colours come from the reserve series slots.
 *
 * Not the named ones: `--series-income` means income on a cash-flow chart, and
 * a tag borrowing it would be the one place in the product where a series
 * colour means two things.
 */
const RECIPE_TAGS: [name: string, series: string][] = [
	['weeknight', 'series-r1'],
	['guests', 'series-r3'],
	['kids', 'series-r5'],
	['vegetarian', 'series-r4'],
	['slow', 'series-r6'],
	['baking', 'series-r7'],
	['one pan', 'series-r8']
];

const RECIPES: RecipeSeed[] = [
	{
		name: 'Ragù that takes all afternoon',
		emoji: '🍝',
		category: 'Slow things',
		description: 'The one worth starting before lunch.',
		servings: 4,
		minutes: 240,
		tags: ['slow', 'guests'],
		ingredients: [
			[500, 'g', 'beef mince'],
			[150, 'g', 'pancetta'],
			[1, '', 'onion'],
			[2, '', 'carrots'],
			[400, 'g', 'tinned tomatoes'],
			[250, 'ml', 'red wine'],
			[null, '', 'milk, a splash']
		],
		steps: [
			'Soften the onion and carrot with the pancetta until everything smells sweet.',
			'Brown the mince properly, in batches, or it steams.',
			'Wine in, let it cook away, then the tomatoes.',
			'Lowest heat for three hours. Milk at the end.'
		]
	},
	{
		name: 'Buckwheat salad with chicken',
		emoji: '🥗',
		category: 'Weeknight',
		description: 'Cooks in the time it takes to lay the table.',
		servings: 2,
		minutes: 25,
		tags: ['weeknight', 'one pan'],
		ingredients: [
			[180, 'g', 'buckwheat'],
			[2, '', 'chicken breasts'],
			[200, 'g', 'tomatoes'],
			[1, '', 'cucumber'],
			[2, 'tbsp', 'olive oil'],
			[1, '', 'lemon']
		],
		steps: [
			'Buckwheat on, twice its volume in water, twelve minutes.',
			'Chicken in a hot pan while it cooks.',
			'Everything chopped, everything in, lemon over the top.'
		]
	},
	{
		name: 'Cabbage soup, the winter one',
		emoji: '🍲',
		category: 'Weeknight',
		description: 'Better on the second day, which is the point.',
		servings: 6,
		minutes: 70,
		tags: ['weeknight', 'vegetarian'],
		ingredients: [
			[1, '', 'small cabbage'],
			[3, '', 'potatoes'],
			[1, '', 'onion'],
			[1, 'tbsp', 'caraway seed'],
			[1.5, 'l', 'stock'],
			[200, 'ml', 'sour cream']
		],
		steps: [
			'Onion and caraway in butter until the kitchen smells of it.',
			'Cabbage and potato in, stock over, forty-five minutes.',
			'Sour cream off the heat, never on it.'
		]
	},
	{
		name: 'Whole fish, one tray',
		emoji: '🐟',
		category: 'For guests',
		description: 'Looks like more work than it is.',
		servings: 4,
		minutes: 45,
		tags: ['guests', 'one pan'],
		ingredients: [
			[2, '', 'sea bream'],
			[600, 'g', 'new potatoes'],
			[1, '', 'fennel bulb'],
			[1, '', 'lemon'],
			[3, 'tbsp', 'olive oil']
		],
		steps: [
			'Potatoes and fennel in the oven twenty minutes ahead.',
			'Fish on top, lemon inside it, twenty-five minutes more.',
			'Straight to the table in the tray.'
		]
	},
	{
		name: 'Sunday pancakes',
		emoji: '🥞',
		category: 'Baking',
		description: 'Doubled when anybody stays over.',
		servings: 2,
		minutes: 20,
		tags: ['kids', 'baking'],
		ingredients: [
			[200, 'g', 'plain flour'],
			[2, '', 'eggs'],
			[300, 'ml', 'milk'],
			[1, 'tsp', 'baking powder'],
			[30, 'g', 'butter']
		],
		steps: [
			'Dry things together, wet things in, do not beat it smooth.',
			'Rest it while the pan heats.',
			'A ladle at a time, turn when the top goes matt.'
		]
	},
	{
		name: 'Aubergine baked with tomato',
		emoji: '🍆',
		category: 'For guests',
		description: 'The one vegetarians and everyone else both finish.',
		servings: 4,
		minutes: 80,
		tags: ['vegetarian', 'guests'],
		ingredients: [
			[3, '', 'aubergines'],
			[600, 'g', 'passata'],
			[150, 'g', 'parmesan'],
			[1, '', 'ball of mozzarella'],
			[null, '', 'basil']
		],
		steps: [
			'Slice and salt the aubergine, half an hour, then pat it dry.',
			'Fry in batches until properly golden.',
			'Layer with sauce and cheese, forty minutes at 180°C.'
		]
	}
];

interface BottleSeed {
	type:
		| 'wine'
		| 'champagne'
		| 'whisky'
		| 'bourbon'
		| 'gin'
		| 'rum'
		| 'beer'
		| 'liqueur'
		| 'cognac'
		| 'other';
	producer: string;
	name: string;
	vintage?: number;
	ageYears?: number;
	country: string;
	region: string;
	grapeOrCask: string;
	abv: string;
	sizeMl: number;
	owned: number;
	opened: number;
	drinkFrom?: number;
	drinkTo?: number;
	boughtWhere: string;
	boughtDaysAgo: number;
	priceMinor: bigint;
	tastings?: {
		daysAgo: number;
		who: 'jana' | 'petr';
		score: number;
		note: string;
		flavours: string[];
	}[];
}

/**
 * Flavour notes carry their own colours, like the recipe tags.
 *
 * The radar draws an axis per distinct note, so the seed gives three bottles
 * three or more tastings between them — fewer than three and the card correctly
 * shows its "three tastings with notes will draw a shape here" state instead,
 * which is worth seeing too.
 */
const FLAVOUR_SERIES: Record<string, string> = {
	peat: 'series-r6',
	citrus: 'series-r4',
	oak: 'series-r3',
	vanilla: 'series-r7',
	'sea salt': 'series-r8',
	plum: 'series-r1',
	leather: 'series-r2',
	pepper: 'series-r5',
	honey: 'series-r9',
	apple: 'series-r10'
};

const BOTTLES: BottleSeed[] = [
	{
		type: 'wine',
		producer: 'Quinta do Vale',
		name: 'Reserva Tinto',
		vintage: thisYear - 11,
		country: 'PT',
		region: 'Douro',
		grapeOrCask: 'Touriga Nacional',
		abv: '14.0',
		sizeMl: 750,
		owned: 3,
		opened: 0,
		drinkFrom: thisYear - 3,
		drinkTo: thisYear,
		boughtWhere: 'Brought back from Porto',
		boughtDaysAgo: 400,
		priceMinor: 62000n,
		tastings: [
			{
				daysAgo: 210,
				who: 'petr',
				score: 91,
				note: 'Still tight when it was opened. Better an hour later.',
				flavours: ['plum', 'oak']
			}
		]
	},
	{
		type: 'whisky',
		producer: 'Lagavulin',
		name: '16 Year Old',
		ageYears: 16,
		country: 'GB',
		region: 'Islay',
		grapeOrCask: 'Ex-bourbon',
		abv: '43.0',
		sizeMl: 700,
		owned: 2,
		opened: 1,
		boughtWhere: 'Duty free',
		boughtDaysAgo: 430,
		priceMinor: 189000n,
		tastings: [
			{
				daysAgo: 420,
				who: 'petr',
				score: 94,
				note: 'The one everything else gets measured against.',
				flavours: ['peat', 'sea salt', 'oak']
			},
			{
				daysAgo: 180,
				who: 'jana',
				score: 92,
				note: 'A drop of water opens it right up.',
				flavours: ['peat', 'vanilla']
			},
			{
				daysAgo: 40,
				who: 'petr',
				score: 95,
				note: 'Last of the first bottle. Opening the second tonight.',
				flavours: ['peat', 'sea salt', 'honey']
			}
		]
	},
	{
		type: 'wine',
		producer: 'Château Belle-Vue',
		name: 'Haut-Médoc',
		vintage: thisYear - 9,
		country: 'FR',
		region: 'Bordeaux',
		grapeOrCask: 'Cabernet Sauvignon',
		abv: '13.5',
		sizeMl: 750,
		owned: 1,
		opened: 0,
		drinkFrom: thisYear - 4,
		drinkTo: thisYear - 1,
		boughtWhere: 'Vinotéka u Karla',
		boughtDaysAgo: 900,
		priceMinor: 78000n
	},
	{
		type: 'champagne',
		producer: 'Maison Perrot',
		name: 'Brut Réserve',
		country: 'FR',
		region: 'Champagne',
		grapeOrCask: 'Chardonnay, Pinot Noir',
		abv: '12.0',
		sizeMl: 750,
		owned: 2,
		opened: 0,
		drinkFrom: thisYear - 1,
		drinkTo: thisYear + 3,
		boughtWhere: 'Kept for something',
		boughtDaysAgo: 150,
		priceMinor: 96000n
	},
	{
		type: 'gin',
		producer: 'Hendrick’s',
		name: 'Original',
		country: 'GB',
		region: 'Scotland',
		grapeOrCask: '',
		abv: '41.4',
		sizeMl: 700,
		owned: 1,
		opened: 1,
		boughtWhere: 'Tesco',
		boughtDaysAgo: 90,
		priceMinor: 69900n,
		tastings: [
			{
				daysAgo: 85,
				who: 'jana',
				score: 86,
				note: 'Cucumber, obviously. Good with the good tonic, wasted with the cheap one.',
				flavours: ['citrus']
			}
		]
	},
	{
		type: 'wine',
		producer: 'Sonberk',
		name: 'Ryzlink rýnský',
		vintage: thisYear - 3,
		country: 'CZ',
		region: 'South Moravia',
		grapeOrCask: 'Riesling',
		abv: '12.5',
		sizeMl: 750,
		owned: 4,
		opened: 1,
		drinkFrom: thisYear - 1,
		drinkTo: thisYear + 4,
		boughtWhere: 'Straight from the winery',
		boughtDaysAgo: 200,
		priceMinor: 39000n,
		tastings: [
			{
				daysAgo: 30,
				who: 'jana',
				score: 89,
				note: 'Drier than last year’s. Good with the fish.',
				flavours: ['apple', 'citrus']
			}
		]
	},
	{
		type: 'bourbon',
		producer: 'Buffalo Trace',
		name: 'Kentucky Straight',
		country: 'US',
		region: 'Kentucky',
		grapeOrCask: 'New charred oak',
		abv: '45.0',
		sizeMl: 700,
		owned: 1,
		opened: 0,
		boughtWhere: 'A present',
		boughtDaysAgo: 60,
		priceMinor: 82000n
	},
	{
		type: 'beer',
		producer: 'Pivovar Kout',
		name: 'Světlý ležák 12°',
		country: 'CZ',
		region: 'Plzeň',
		grapeOrCask: '',
		abv: '5.0',
		sizeMl: 500,
		owned: 6,
		opened: 0,
		boughtWhere: 'The shop on the corner',
		boughtDaysAgo: 10,
		priceMinor: 4500n
	}
];

/**
 * Seed everything Life. Called at the end of `seedDemo`, with the two people.
 *
 * Takes a handle, like every other writer in `src/lib/server`: the integration
 * suite runs this against its own embedded database, and a function that can
 * only write through the module-level connection is a function no test can
 * exercise against real constraints.
 */
export async function seedDemoLife(
	people: { jana: string; petr: string },
	handle: Db = db
): Promise<void> {
	const member = (who: 'jana' | 'petr' | 'both'): string[] =>
		who === 'both' ? [people.jana, people.petr] : [people[who]];

	// ---- Trips ----
	for (const seed of TRIPS) {
		const id = uuidv7();
		const startsOn = isoDay(seed.startsIn);
		const first = seed.destinations[0];
		await handle.insert(trip).values({
			id,
			name: seed.name,
			emoji: seed.emoji,
			startsOn,
			endsOn: isoDay(seed.startsIn + seed.nights),
			notes: seed.notes ?? '',
			art: resolveStamp({ name: seed.name, country: first.country, city: first.city })
		});
		await handle.insert(tripDestination).values(
			seed.destinations.map((destination, ordinal) => ({
				id: uuidv7(),
				tripId: id,
				ordinal,
				country: destination.country,
				region: destination.region ?? null,
				city: destination.city ?? null
			}))
		);
		await handle
			.insert(tripMember)
			.values(member(seed.members).map((personId) => ({ tripId: id, personId })));

		if (seed.bookings?.length) {
			await handle.insert(tripBooking).values(
				seed.bookings.map((booking) => ({
					id: uuidv7(),
					tripId: id,
					kind: booking.kind,
					title: booking.title,
					startsAt: isoTime(seed.startsIn + booking.day, booking.hour),
					endsAt: booking.nights ? isoTime(seed.startsIn + booking.day + booking.nights, 11) : null,
					reference: booking.reference ?? ''
				}))
			);
		}
		if (seed.places?.length) {
			await handle.insert(tripPlace).values(
				seed.places.map((label, ordinal) => ({
					id: uuidv7(),
					tripId: id,
					ordinal,
					label,
					// A couple already ticked, so the control reads as something the
					// household uses rather than a row of empty boxes.
					done: ordinal === 0
				}))
			);
		}

		// A trip that has already ended has been to the places it named. Written
		// here rather than left to the read-time pass so the map has something on
		// it the first time it is opened.
		if (seed.startsIn + seed.nights < 0) {
			for (const destination of seed.destinations) {
				const visitId = uuidv7();
				await handle.insert(visit).values({
					id: visitId,
					country: destination.country,
					region: destination.region ?? null,
					city: destination.city ?? null,
					year: Number(startsOn.slice(0, 4)),
					tripId: id,
					source: 'trip',
					// Already seen, except for the most recent trip — which is what
					// gives the demo a reveal to play the first time the map opens.
					revealedAt: seed.startsIn < -200 ? new Date() : null
				});
				await handle
					.insert(visitMember)
					.values(member(seed.members).map((personId) => ({ visitId, personId })));
			}
		}
	}

	// ---- Visits from before Continuum ----
	for (const manual of MANUAL_VISITS) {
		const visitId = uuidv7();
		await handle.insert(visit).values({
			id: visitId,
			country: manual.country,
			region: manual.region ?? null,
			city: manual.city ?? null,
			year: manual.year,
			source: 'manual',
			revealedAt: new Date()
		});
		await handle
			.insert(visitMember)
			.values([people.jana, people.petr].map((personId) => ({ visitId, personId })));
	}

	// ---- The idea board ----
	for (const [ordinal, idea] of IDEAS.entries()) {
		const id = uuidv7();
		await handle.insert(tripIdea).values({
			id,
			name: idea.name,
			emoji: idea.emoji,
			note: idea.note,
			country: idea.country,
			sortOrder: ordinal,
			art: resolveStamp({ name: idea.name, country: idea.country })
		});
		await handle.insert(tripIdeaHeart).values(
			idea.hearts.map((who) => ({
				ideaId: id,
				personId: people[who as 'jana' | 'petr']
			}))
		);
	}

	// ---- Cookbook ----
	const categoryIds = new Map<string, string>();
	for (const [ordinal, [name, emoji]] of RECIPE_CATEGORIES.entries()) {
		const id = uuidv7();
		categoryIds.set(name, id);
		await handle.insert(recipeCategory).values({ id, name, emoji, sortOrder: ordinal });
	}
	const tagIds = new Map<string, string>();
	for (const [name, series] of RECIPE_TAGS) {
		const id = uuidv7();
		tagIds.set(name, id);
		await handle.insert(recipeTag).values({ id, name, series });
	}
	for (const seed of RECIPES) {
		const id = uuidv7();
		await handle.insert(recipe).values({
			id,
			categoryId: categoryIds.get(seed.category)!,
			name: seed.name,
			emoji: seed.emoji,
			description: seed.description,
			servings: seed.servings,
			minutes: seed.minutes,
			art: resolveDish({
				name: seed.name,
				category: seed.category,
				ingredients: seed.ingredients.map(([, , ingredient]) => ingredient)
			})
		});
		await handle
			.insert(recipeTagLink)
			.values(seed.tags.map((tag) => ({ recipeId: id, tagId: tagIds.get(tag)! })));
		await handle.insert(recipeIngredient).values(
			seed.ingredients.map(([quantity, unit, name], ordinal) => ({
				id: uuidv7(),
				recipeId: id,
				ordinal,
				quantity: quantity === null ? null : String(quantity),
				unit,
				name
			}))
		);
		await handle.insert(recipeStep).values(
			seed.steps.map((body, ordinal) => ({
				id: uuidv7(),
				recipeId: id,
				ordinal,
				body
			}))
		);
	}

	// ---- The cellar ----
	// The shelf itself is a seeded row every install has — see `lifeSeedSql`.
	// The demo fills it rather than making a second one.
	const [cellar] = await handle
		.select({ id: collection.id })
		.from(collection)
		.where(eq(collection.key, 'cellar'))
		.limit(1);
	const cellarId = cellar.id;
	for (const seed of BOTTLES) {
		const bottleId = uuidv7();
		await handle.insert(bottle).values({
			id: bottleId,
			collectionId: cellarId,
			type: seed.type,
			producer: seed.producer,
			name: seed.name,
			vintage: seed.vintage ?? null,
			ageYears: seed.ageYears ?? null,
			country: seed.country,
			region: seed.region,
			grapeOrCask: seed.grapeOrCask,
			abv: seed.abv,
			sizeMl: seed.sizeMl,
			drinkFrom: seed.drinkFrom ?? null,
			drinkTo: seed.drinkTo ?? null,
			owned: seed.owned,
			opened: seed.opened,
			boughtOn: isoDay(-seed.boughtDaysAgo),
			boughtWhere: seed.boughtWhere,
			boughtMinor: seed.priceMinor,
			boughtCurrency: 'CZK'
		});
		for (const note of seed.tastings ?? []) {
			const tastingId = uuidv7();
			await handle.insert(tasting).values({
				id: tastingId,
				bottleId,
				tastedOn: isoDay(-note.daysAgo),
				personId: people[note.who],
				score: note.score,
				note: note.note
			});
			if (note.flavours.length) {
				await handle.insert(tastingNote).values(
					note.flavours.map((flavour) => ({
						id: uuidv7(),
						tastingId,
						note: flavour,
						series: FLAVOUR_SERIES[flavour] ?? 'series-r1'
					}))
				);
			}
		}
	}
}
