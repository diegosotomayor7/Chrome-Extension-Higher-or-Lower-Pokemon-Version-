#  Pokémon Higher or Lower – Chrome Extension

A simple and addictive Chrome Extension game inspired by the classic "Higher or Lower" format. Two Pokémon appear side by side, and you must guess whether the new Pokémon's randomly selected stat is **higher** or **lower** than the current one. Keep guessing correctly to build your streak!

![Chrome Extension](https://img.shields.io/badge/Platform-Chrome%20Extension-brightgreen)
![Pokémon](https://img.shields.io/badge/Powered%20by-PokéAPI-red)
![License](https://img.shields.io/badge/License-MIT-blue)

---

##  Screenshots
<img width="1383" height="738" alt="image" src="https://github.com/user-attachments/assets/5dd886a8-3123-4d88-ab89-dd8b90ff864f" />

![extension_gif](https://github.com/user-attachments/assets/cb6c1210-00b4-4d91-a51e-49238b55928e)




---

##  How to Play

1. Click the extension icon in your Chrome toolbar to open the popup, pick your generations and a difficulty, and press **Start**.
2. Two Pokémon will appear with a random stat category (HP, Attack, Defense, Special Attack, Special Defense, or Speed).
3. Guess whether the **new Pokémon** (right) has a **higher** or **lower** value for that stat compared to the **current Pokémon** (left).
4. If you're correct, your score increases and the new Pokémon becomes the current one for the next round.
5. If you're wrong, it's **Game Over** — the correct stats are revealed and your score resets.
6. Try to beat your **high score**, which is saved locally between sessions!

---

##  Features

- **1025 Pokémon** — Covers all Pokémon through Generation IX (as of February 2025)
- **6 stat categories** — HP, Attack, Defense, Special Attack, Special Defense, and Speed
- **4 difficulty levels** — Easy, Normal, Hard, and Extreme control how close the two Pokémon's stats are (see below)
- **Persistent high scores** — Your best streak on each difficulty is saved using `chrome.storage.local`
- **Live Pokémon sprites** — Fetched directly from the official [PokeAPI sprite repository](https://github.com/PokeAPI/sprites)
- **Bundled Pokédex database** — Stats come from a local SQLite database queried in the browser with [sql.js](https://github.com/sql-js/sql.js), so rounds load instantly with no API calls
- **Lightweight & fast** — No frameworks, pure vanilla JavaScript
- **Offline-friendly score tracking** — High scores persist even after closing the browser


---

##  Pokédex Database (SQLite)

Pokémon data lives in a bundled SQLite database, `data/pokedex.db`, built from [PokéAPI](https://pokeapi.co/).

| Table | Contents |
|---|---|
| `generations` | Generation number, name, and region |
| `pokemon` | National Dex number, official English name, generation, height, weight, legendary/mythical flags |
| `stats`, `pokemon_stats` | The six base stats, one row per Pokémon per stat |
| `types`, `pokemon_types` | Types, with slot 1/2 for dual-type Pokémon |
| `pokemon_card` (view) | One row per Pokémon with all six stats as columns, plus base stat total |

The extension opens the database with sql.js (SQLite compiled to WebAssembly), vendored in `vendor/sql.js/`. To update sql.js, run `npm install && npm run vendor`.

The schema is in [`db/schema.sql`](db/schema.sql). To rebuild the database (requires Node.js 22.13+):

```bash
npm run build:db            # uses cached API responses in .cache/ when available
npm run build:db -- --fresh # re-downloads everything
```

The build runs integrity checks (every Pokémon has 6 stats and 1–2 types, no gaps in Dex numbers, contiguous generations, valid foreign keys) and only replaces `data/pokedex.db` if they all pass.

---

##  Game Engine (C++ → WebAssembly)

The game logic is a C++17 engine in [`engine/`](engine/), compiled to WebAssembly with Emscripten and called from `popup.js` through embind. It owns the Pokémon pool, deals each round, checks guesses, and keeps score.

### Difficulty levels

Difficulty is the gap between the two Pokémon's values for the stat being asked:

| Difficulty | Stat gap | Notes |
|---|---|---|
| Easy | 40 or more | |
| Normal | any | Original game; ties count as correct either way |
| Hard | 6–20 | |
| Extreme | 1–5 | |

For each stat, the engine keeps the pool sorted by that stat's value. Finding every opponent inside a difficulty's gap range is then two binary searches (O(log n)) rather than a scan of the whole pool. The engine tries the six stats in random order and deals the first one that has a valid opponent. It also avoids the last 8 Pokémon shown whenever the range has other options.

### Building and testing

The compiled module (`wasm/pkmn-engine.js` and `.wasm`) is committed, so the extension runs without a C++ toolchain. To work on the engine you need [CMake](https://cmake.org/), a C++ compiler (tests are run with MSVC), [Emscripten](https://emscripten.org/docs/getting_started/downloads.html), and [Ninja](https://ninja-build.org/).

```bash
npm run test:engine    # native build + GoogleTest unit tests
npm run build:engine   # WebAssembly build -> wasm/ (run from a shell with emsdk_env activated)
```
