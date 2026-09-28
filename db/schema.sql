-- Pokédex schema for Higher or Lower.
-- Built by scripts/build-pokedex.mjs from PokeAPI data; shipped with the extension as data/pokedex.db.

PRAGMA foreign_keys = ON;

CREATE TABLE generations (
    id          INTEGER PRIMARY KEY,              -- 1..9
    name        TEXT    NOT NULL UNIQUE,          -- 'Generation I'
    region      TEXT    NOT NULL                  -- 'Kanto'
);

CREATE TABLE pokemon (
    id            INTEGER PRIMARY KEY,            -- National Pokédex number
    slug          TEXT    NOT NULL UNIQUE,        -- 'mr-mime' (PokeAPI species name)
    name          TEXT    NOT NULL,               -- 'Mr. Mime' (official English name)
    generation_id INTEGER NOT NULL REFERENCES generations(id),
    height_dm     INTEGER NOT NULL CHECK (height_dm > 0),   -- decimetres
    weight_hg     INTEGER NOT NULL CHECK (weight_hg > 0),   -- hectograms
    is_legendary  INTEGER NOT NULL DEFAULT 0 CHECK (is_legendary IN (0, 1)),
    is_mythical   INTEGER NOT NULL DEFAULT 0 CHECK (is_mythical IN (0, 1))
);

CREATE TABLE stats (
    id    INTEGER PRIMARY KEY,                    -- PokeAPI stat id (1..6)
    slug  TEXT    NOT NULL UNIQUE,                -- 'special-attack'
    name  TEXT    NOT NULL UNIQUE                 -- 'Special Attack'
);

CREATE TABLE pokemon_stats (
    pokemon_id  INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    stat_id     INTEGER NOT NULL REFERENCES stats(id),
    base_value  INTEGER NOT NULL CHECK (base_value > 0),
    PRIMARY KEY (pokemon_id, stat_id)
) WITHOUT ROWID;

CREATE TABLE types (
    id    INTEGER PRIMARY KEY,                    -- PokeAPI type id
    slug  TEXT    NOT NULL UNIQUE,                -- 'fire'
    name  TEXT    NOT NULL UNIQUE                 -- 'Fire'
);

CREATE TABLE pokemon_types (
    pokemon_id  INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
    slot        INTEGER NOT NULL CHECK (slot IN (1, 2)),
    type_id     INTEGER NOT NULL REFERENCES types(id),
    PRIMARY KEY (pokemon_id, slot),
    UNIQUE (pokemon_id, type_id)
) WITHOUT ROWID;

-- The game filters by generation every round, and "who has the highest X" queries scan by stat.
CREATE INDEX idx_pokemon_generation   ON pokemon(generation_id);
CREATE INDEX idx_pokemon_stats_value  ON pokemon_stats(stat_id, base_value);
CREATE INDEX idx_pokemon_types_type   ON pokemon_types(type_id);

-- One row per Pokémon with its stats pivoted into columns: the shape popup.js works with.
CREATE VIEW pokemon_card AS
SELECT
    p.id,
    p.name,
    p.generation_id,
    MAX(CASE WHEN s.slug = 'hp'              THEN ps.base_value END) AS hp,
    MAX(CASE WHEN s.slug = 'attack'          THEN ps.base_value END) AS attack,
    MAX(CASE WHEN s.slug = 'defense'         THEN ps.base_value END) AS defense,
    MAX(CASE WHEN s.slug = 'special-attack'  THEN ps.base_value END) AS special_attack,
    MAX(CASE WHEN s.slug = 'special-defense' THEN ps.base_value END) AS special_defense,
    MAX(CASE WHEN s.slug = 'speed'           THEN ps.base_value END) AS speed,
    SUM(ps.base_value)                                               AS base_stat_total
FROM pokemon p
JOIN pokemon_stats ps ON ps.pokemon_id = p.id
JOIN stats s          ON s.id = ps.stat_id
GROUP BY p.id;
