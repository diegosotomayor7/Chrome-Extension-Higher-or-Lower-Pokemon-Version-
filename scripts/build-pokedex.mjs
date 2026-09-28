// Builds data/pokedex.db from PokeAPI.
//
//   npm run build:db            use cached API responses where available
//   npm run build:db -- --fresh ignore the cache and re-download everything
//
// Raw responses are cached in .cache/pokeapi/ so rebuilding after a schema change costs no network calls.
// The database is written to a temp file and only moved into place once every integrity check passes.

import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'db', 'schema.sql');
const OUT_PATH = path.join(ROOT, 'data', 'pokedex.db');
const TMP_PATH = OUT_PATH + '.tmp';
const CACHE_DIR = path.join(ROOT, '.cache', 'pokeapi');

const API = 'https://pokeapi.co/api/v2';
const CONCURRENCY = 12;
const MAX_RETRIES = 4;
const FRESH = process.argv.includes('--fresh');

const STAT_NAMES = {
    'hp': 'HP',
    'attack': 'Attack',
    'defense': 'Defense',
    'special-attack': 'Special Attack',
    'special-defense': 'Special Defense',
    'speed': 'Speed'
};

// --- Fetching ---

let networkRequests = 0;

async function getJson(endpoint) {
    const cacheFile = path.join(CACHE_DIR, endpoint.replace(/[/?=&]+/g, '_') + '.json');
    if (!FRESH && existsSync(cacheFile)) {
        return JSON.parse(await readFile(cacheFile, 'utf8'));
    }

    for (let attempt = 1; ; attempt++) {
        try {
            networkRequests++;
            const response = await fetch(`${API}/${endpoint}`);
            if (!response.ok) throw new Error(`HTTP ${response.status} for ${endpoint}`);
            const data = await response.json();
            await writeFile(cacheFile, JSON.stringify(data));
            return data;
        } catch (err) {
            if (attempt >= MAX_RETRIES) throw err;
            await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
        }
    }
}

// Runs `worker` over `items` with at most CONCURRENCY requests in flight, preserving order.
async function mapConcurrent(items, worker, label) {
    const results = new Array(items.length);
    let next = 0, done = 0;

    async function run() {
        while (next < items.length) {
            const i = next++;
            results[i] = await worker(items[i]);
            done++;
            if (done % 100 === 0 || done === items.length) {
                process.stdout.write(`\r  ${label}: ${done}/${items.length}`);
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, run));
    process.stdout.write('\n');
    return results;
}

function idFromUrl(url) {
    return Number(url.split('/').filter(Boolean).pop());
}

function englishName(names) {
    return names.find(n => n.language.name === 'en')?.name;
}

function titleCase(slug) {
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// --- Download ---

async function download() {
    await mkdir(CACHE_DIR, { recursive: true });

    console.log('Fetching generations...');
    const genList = await getJson('generation?limit=100');
    const generations = await mapConcurrent(
        genList.results.map(g => idFromUrl(g.url)),
        id => getJson(`generation/${id}`),
        'generations'
    );

    console.log('Fetching species...');
    const speciesList = await getJson('pokemon-species?limit=10000');
    const speciesIds = speciesList.results.map(s => idFromUrl(s.url)).sort((a, b) => a - b);
    const species = await mapConcurrent(speciesIds, id => getJson(`pokemon-species/${id}`), 'species');

    console.log('Fetching pokemon...');
    const pokemon = await mapConcurrent(species, s => {
        const defaultVariety = s.varieties.find(v => v.is_default);
        return getJson(`pokemon/${idFromUrl(defaultVariety.pokemon.url)}`);
    }, 'pokemon');

    return { generations, species, pokemon };
}

// --- Build ---

function build({ generations, species, pokemon }) {
    const db = new DatabaseSync(TMP_PATH);
    db.exec('PRAGMA journal_mode = DELETE;');
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

    const insertGeneration = db.prepare('INSERT INTO generations (id, name, region) VALUES (?, ?, ?)');
    const insertStat = db.prepare('INSERT OR IGNORE INTO stats (id, slug, name) VALUES (?, ?, ?)');
    const insertType = db.prepare('INSERT OR IGNORE INTO types (id, slug, name) VALUES (?, ?, ?)');
    const insertPokemon = db.prepare(`
        INSERT INTO pokemon (id, slug, name, generation_id, height_dm, weight_hg, is_legendary, is_mythical)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertPokemonStat = db.prepare('INSERT INTO pokemon_stats (pokemon_id, stat_id, base_value) VALUES (?, ?, ?)');
    const insertPokemonType = db.prepare('INSERT INTO pokemon_types (pokemon_id, slot, type_id) VALUES (?, ?, ?)');

    db.exec('BEGIN');
    try {
        for (const g of generations) {
            insertGeneration.run(g.id, englishName(g.names) ?? titleCase(g.name), titleCase(g.main_region.name));
        }

        species.forEach((s, i) => {
            const p = pokemon[i];
            insertPokemon.run(
                s.id,
                s.name,
                englishName(s.names) ?? titleCase(s.name),
                idFromUrl(s.generation.url),
                p.height,
                p.weight,
                s.is_legendary ? 1 : 0,
                s.is_mythical ? 1 : 0
            );

            for (const { stat, base_stat } of p.stats) {
                const statId = idFromUrl(stat.url);
                insertStat.run(statId, stat.name, STAT_NAMES[stat.name] ?? titleCase(stat.name));
                insertPokemonStat.run(s.id, statId, base_stat);
            }

            for (const { slot, type } of p.types) {
                const typeId = idFromUrl(type.url);
                insertType.run(typeId, type.name, titleCase(type.name));
                insertPokemonType.run(s.id, slot, typeId);
            }
        });
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }

    return db;
}

// --- Verify ---

// Each check is a query that returns offending rows; any rows at all fail the build.
const CHECKS = {
    'every Pokémon has exactly 6 stats': `
        SELECT p.id, p.name, COUNT(ps.stat_id) AS n
        FROM pokemon p LEFT JOIN pokemon_stats ps ON ps.pokemon_id = p.id
        GROUP BY p.id HAVING n <> 6`,
    'every Pokémon has 1 or 2 types, starting at slot 1': `
        SELECT p.id, p.name, COUNT(pt.type_id) AS n, MIN(pt.slot) AS first_slot
        FROM pokemon p LEFT JOIN pokemon_types pt ON pt.pokemon_id = p.id
        GROUP BY p.id HAVING n NOT IN (1, 2) OR first_slot <> 1`,
    'Pokédex numbers have no gaps': `
        SELECT id FROM pokemon p
        WHERE id > 1 AND NOT EXISTS (SELECT 1 FROM pokemon q WHERE q.id = p.id - 1)`,
    'each generation is one contiguous range of Pokédex numbers': `
        SELECT generation_id FROM pokemon
        GROUP BY generation_id HAVING MAX(id) - MIN(id) + 1 <> COUNT(*)`,
    'foreign keys are intact': 'PRAGMA foreign_key_check'
};

function verify(db) {
    let failed = false;
    for (const [name, sql] of Object.entries(CHECKS)) {
        const rows = db.prepare(sql).all();
        if (rows.length > 0) {
            failed = true;
            console.error(`  FAIL: ${name}`);
            console.error(rows.slice(0, 5));
        } else {
            console.log(`  ok: ${name}`);
        }
    }
    if (failed) throw new Error('Integrity checks failed; data/pokedex.db was not updated.');
}

function summarize(db) {
    console.log('\nPokémon per generation:');
    console.table(db.prepare(`
        SELECT g.id AS gen, g.region, MIN(p.id) AS first_id, MAX(p.id) AS last_id, COUNT(*) AS pokemon
        FROM generations g JOIN pokemon p ON p.generation_id = g.id
        GROUP BY g.id ORDER BY g.id`).all());
}

// --- Main ---

const started = Date.now();
await mkdir(path.dirname(OUT_PATH), { recursive: true });
await rm(TMP_PATH, { force: true });

const data = await download();
console.log(`Downloaded with ${networkRequests} network requests (rest from cache).`);

console.log('Building database...');
const db = build(data);

console.log('Verifying...');
try {
    verify(db);
    summarize(db);
    db.exec('VACUUM');
} finally {
    db.close();
}

await rename(TMP_PATH, OUT_PATH);
console.log(`\nWrote ${path.relative(ROOT, OUT_PATH)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
