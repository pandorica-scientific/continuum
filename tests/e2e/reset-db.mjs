import postgres from 'postgres';

// Reset the dedicated e2e database so every run walks the wizard from zero.
// Runs as part of the Playwright webServer command, BEFORE the app boots —
// Playwright starts the web server before globalSetup, so a reset there would
// drop the database out from under an already-migrated server.
const url =
	process.env.E2E_DATABASE_URL ?? 'postgres://continuum:continuum@localhost:5432/continuum_e2e';
const dbName = new URL(url).pathname.slice(1);
const admin = postgres(url.replace(`/${dbName}`, '/postgres'), { onnotice: () => {} });
await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
await admin.unsafe(`CREATE DATABASE ${dbName}`);
await admin.end();
console.log(`e2e database ${dbName} reset`);
