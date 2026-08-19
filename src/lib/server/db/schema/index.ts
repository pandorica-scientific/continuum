// One import site for the whole schema. Split by domain rather than by table:
// files that change together live together, and drizzle-kit is pointed at the
// directory, so a new file is picked up without being registered anywhere.
//
// The enum lists this schema's CHECK constraints are generated from are NOT
// here: they live in `$lib/enums`, because the browser reads them too and
// anything under `$lib/server` is unreachable from there.
//
// Ordered so a file appears after everything it references.
export * from './money';
export * from './auth';
export * from './contacts';
export * from './documents';
export * from './entity';
export * from './accounts';
export * from './property';
export * from './loans';
export * from './investments';
export * from './calendar';
export * from './tax';
export * from './jobs';
