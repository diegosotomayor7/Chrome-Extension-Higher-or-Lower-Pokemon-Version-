// --- Loading ---

// Start loading as soon as the popup opens so the game is ready by the time a mode is picked.
const pokedexReady = loadPokedex();
pokedexReady.catch(err => console.error('Failed to load Pokédex:', err));

// The C++ game engine, compiled to WebAssembly (see engine/)
const engineReady = createPkmnEngine();
engineReady.catch(err => console.error('Failed to load game engine:', err));

async function loadPokedex() {
    const SQL = await initSqlJs({ locateFile: file => `vendor/sql.js/${file}` });
    const response = await fetch('data/pokedex.db');
    if (!response.ok) throw new Error(`Could not load data/pokedex.db (HTTP ${response.status})`);
    return new SQL.Database(new Uint8Array(await response.arrayBuffer()));
}

// Waits for the database and engine, disabling `button` meanwhile. Returns [db, EngineModule], or null on failure.
async function loadGameData(button) {
    button.disabled = true;
    try {
        return await Promise.all([pokedexReady, engineReady]);
    } catch {
        alert("Couldn't load the game. Try reopening the extension.");
        return null;
    } finally {
        button.disabled = false;
    }
}

function queryAll(db, sql, params = []) {
    const stmt = db.prepare(sql);
    try {
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
    } finally {
        stmt.free();
    }
}

// Every Pokémon from the given generations, or from all of them if `gens` is omitted.
// Ordered by id so the Daily Challenge engine sees the same pool on every computer.
function loadPool(db, gens) {
    const where = gens ? `WHERE generation_id IN (${gens.map(() => '?').join(', ')})` : '';
    return queryAll(db, `
        SELECT id, name, hp, attack, defense, special_attack, special_defense, speed
        FROM pokemon_card
        ${where}
        ORDER BY id`, gens ?? []);
}

const DIFFICULTY_LABELS = {
    easy: "Easy",
    normal: "Normal",
    hard: "Hard",
    extreme: "Extreme"
};

// Indexed by the engine's stat number, in pokemon_card column order
const STAT_NAMES = ["HP", "Attack", "Defense", "Special Attack", "Special Defense", "Speed"];

function getImageUrl(id) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

// Local date as "YYYY-MM-DD", so the Daily Challenge changes at the player's midnight
function todayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Storage ---

// High scores are kept per difficulty. Scores saved before difficulties existed count as Normal.
async function loadHighScores() {
    const data = await chrome.storage.local.get(['pkmnHighScores', 'pkmnHighScore']);
    return data.pkmnHighScores ?? { normal: data.pkmnHighScore ?? 0 };
}

// Finished Daily Challenges by date: { "2026-09-28": { score, mistakes, roundsPlayed, completed } }
async function loadDailyResults() {
    const data = await chrome.storage.local.get(['pkmnDailyResults']);
    return data.pkmnDailyResults ?? {};
}

// --- Screens ---

const SCREENS = ['main-menu', 'menu-container', 'game-container', 'daily-summary', 'stats-screen'];

function showScreen(id) {
    for (const screen of SCREENS) {
        document.getElementById(screen).style.display = screen === id ? 'block' : 'none';
    }
}

// --- Game (shared by Play and the Daily Challenge) ---

// The game in progress: { engine, pokemonById, mode: 'endless' | 'daily', ... }
let game = null;

function createGame(EngineModule, pool, seed) {
    const engine = new EngineModule.Engine(seed);
    for (const p of pool) {
        engine.addPokemon(p.id, p.hp, p.attack, p.defense, p.special_attack, p.special_defense, p.speed);
    }
    return { engine, pokemonById: new Map(pool.map(p => [p.id, p])) };
}

// Frees the engine's WebAssembly memory when leaving a game
function endGame() {
    if (game) {
        game.engine.delete();
        game = null;
    }
}

// Hides the sprite until it has downloaded, so the previous Pokémon's picture never shows under a new name
function setSprite(img, id) {
    img.src = getImageUrl(id);
    const show = () => { img.style.visibility = 'visible'; };
    if (img.complete) {
        show();
    } else {
        img.style.visibility = 'hidden';
        img.onload = img.onerror = show;
    }
}

function showRound() {
    const round = game.engine.round();
    const currentPkmn = game.pokemonById.get(round.currentId);
    const newPkmn = game.pokemonById.get(round.challengerId);

    setSprite(document.getElementById('left-img'), currentPkmn.id);
    setSprite(document.getElementById('right-img'), newPkmn.id);
    document.getElementById('left-name').innerText = currentPkmn.name;
    document.getElementById('right-name').innerText = newPkmn.name;

    document.getElementById('question-label').innerText =
        `${newPkmn.name} has a higher/lower ${STAT_NAMES[round.stat]} than ${currentPkmn.name}`;

    const roundLabel = document.getElementById('round-label');
    if (game.mode === 'daily') {
        const difficulty = game.engine.roundDifficulty();
        roundLabel.innerText = `Round ${game.engine.roundNumber()}/${game.rounds} · ${DIFFICULTY_LABELS[difficulty]}`;
        roundLabel.className = `difficulty-${difficulty}`;
        roundLabel.style.display = 'block';
    } else {
        roundLabel.style.display = 'none';
    }

    // Download the next challenger's sprite now so it appears instantly after the guess
    const upcoming = game.engine.upcomingRound();
    if (upcoming) {
        const img = new Image();
        img.src = getImageUrl(upcoming.challengerId);
    }
}

// The two stat values of a round, for the messages shown after a wrong guess
function describeRound(round, result) {
    const statName = STAT_NAMES[round.stat];
    return `${game.pokemonById.get(round.currentId).name} ${statName}: ${result.currentValue}\n` +
           `${game.pokemonById.get(round.challengerId).name} ${statName}: ${result.challengerValue}`;
}

function checkGuess(guess) {
    if (!game) return;
    const round = game.engine.round();
    const result = game.engine.guess(guess);
    if (game.mode === 'daily') {
        dailyGuess(round, result);
    } else {
        endlessGuess(round, result);
    }
}

document.getElementById('higher-btn').onclick = () => checkGuess('higher');
document.getElementById('lower-btn').onclick = () => checkGuess('lower');

document.getElementById('game-back-btn').onclick = () => {
    // Daily progress is saved after every guess, so leaving just pauses the challenge
    const backTo = game?.mode === 'daily' ? 'main-menu' : 'menu-container';
    endGame();
    showScreen(backTo);
};

// --- Play (endless game) ---

async function startEndlessGame(db, EngineModule, gens, difficulty) {
    endGame();
    game = { ...createGame(EngineModule, loadPool(db, gens), crypto.getRandomValues(new Uint32Array(1))[0]),
             mode: 'endless', difficulty, highScores: await loadHighScores() };
    game.engine.setDifficulty(difficulty);
    game.engine.startGame();

    document.getElementById('score-label').innerText = 'Score: 0';
    showHighScore();
    showRound();
    showScreen('game-container');
}

function endlessGuess(round, result) {
    if (result.correct) {
        document.getElementById('score-label').innerText = `Score: ${result.score}`;
        if (result.score > (game.highScores[game.difficulty] ?? 0)) {
            game.highScores[game.difficulty] = result.score;
            chrome.storage.local.set({ 'pkmnHighScores': game.highScores });
            showHighScore();
        }
    } else {
        alert(`Game Over! Score: ${result.score}\n\n${describeRound(round, result)}`);
        document.getElementById('score-label').innerText = `Score: 0`;
    }
    showRound();
}

function showHighScore() {
    document.getElementById('high-score-label').innerText =
        `Best (${DIFFICULTY_LABELS[game.difficulty]}): ${game.highScores[game.difficulty] ?? 0}`;
}

// --- Daily Challenge ---

async function openDailyChallenge() {
    const date = todayString();
    const results = await loadDailyResults();
    if (results[date]) {
        showDailySummary(date, results[date]);
        return;
    }

    const loaded = await loadGameData(document.getElementById('daily-btn'));
    if (!loaded) return;
    const [db, EngineModule] = loaded;

    // Everyone plays the same rounds: every generation, seeded by today's date
    endGame();
    game = { ...createGame(EngineModule, loadPool(db), EngineModule.dailySeed(date)),
             mode: 'daily', date,
             rounds: EngineModule.DAILY_ROUNDS, mistakesAllowed: EngineModule.DAILY_MISTAKES_ALLOWED };

    // Pick up where the player left off if the popup was closed mid-challenge
    const { pkmnDailyProgress: progress } = await chrome.storage.local.get(['pkmnDailyProgress']);
    let resumed = false;
    if (progress?.date === date) {
        try {
            game.engine.resumeDailyChallenge(progress.roundsPlayed, progress.score, progress.mistakes);
            resumed = true;
        } catch (err) {
            console.error('Could not resume Daily Challenge:', err);
        }
    }
    if (!resumed) game.engine.startDailyChallenge();

    document.getElementById('score-label').innerText = `Score: ${game.engine.score()}`;
    showMistakes();
    showRound();
    showScreen('game-container');
}

function dailyGuess(round, result) {
    document.getElementById('score-label').innerText = `Score: ${result.score}`;
    showMistakes();

    if (!result.correct) {
        const mistakes = game.engine.mistakes();
        const status = mistakes > game.mistakesAllowed
            ? 'Out of mistakes!'
            : `Mistakes: ${mistakes}/${game.mistakesAllowed}`;
        alert(`Wrong!\n\n${describeRound(round, result)}\n\n${status}`);
    }

    if (game.engine.isFinished()) {
        finishDailyChallenge();
        return;
    }
    chrome.storage.local.set({
        'pkmnDailyProgress': {
            date: game.date,
            roundsPlayed: game.engine.roundNumber() - 1,
            score: game.engine.score(),
            mistakes: game.engine.mistakes()
        }
    });
    showRound();
}

function showMistakes() {
    document.getElementById('high-score-label').innerText =
        `Mistakes: ${Math.min(game.engine.mistakes(), game.mistakesAllowed)}/${game.mistakesAllowed}`;
}

async function finishDailyChallenge() {
    const { date, engine, rounds, mistakesAllowed } = game;
    const result = {
        score: engine.score(),
        mistakes: engine.mistakes(),
        rounds,
        roundsPlayed: engine.roundNumber(),
        completed: engine.mistakes() <= mistakesAllowed
    };
    endGame();

    const results = await loadDailyResults();
    results[date] = result;
    await chrome.storage.local.set({ 'pkmnDailyResults': results });
    await chrome.storage.local.remove('pkmnDailyProgress');
    showDailySummary(date, result);
}

function showDailySummary(date, result) {
    const [year, month, day] = date.split('-').map(Number);
    document.getElementById('daily-date').innerText = new Date(year, month - 1, day)
        .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    document.getElementById('daily-score').innerText = `${result.score}/${result.rounds}`;

    let detail;
    if (!result.completed) {
        detail = `Out of mistakes on round ${result.roundsPlayed}`;
    } else if (result.mistakes === 0) {
        detail = 'Perfect, no mistakes!';
    } else {
        detail = `Completed with ${result.mistakes} mistake${result.mistakes === 1 ? '' : 's'}`;
    }
    document.getElementById('daily-detail').innerText = detail;
    showScreen('daily-summary');
}

// --- Stats ---

async function showStats() {
    const [highScores, results] = await Promise.all([loadHighScores(), loadDailyResults()]);
    for (const difficulty of Object.keys(DIFFICULTY_LABELS)) {
        document.getElementById(`best-${difficulty}`).innerText = highScores[difficulty] ?? 0;
    }
    const completed = Object.values(results).filter(r => r.completed).length;
    document.getElementById('daily-completed').innerText = `Daily challenges completed: ${completed}`;
    showScreen('stats-screen');
}

// --- Main Menu ---

document.getElementById('daily-btn').onclick = openDailyChallenge;
document.getElementById('play-btn').onclick = () => showScreen('menu-container');
document.getElementById('stats-btn').onclick = showStats;

for (const id of ['play-back-btn', 'summary-back-btn', 'stats-back-btn']) {
    document.getElementById(id).onclick = () => showScreen('main-menu');
}


// --- Play Menu ---

// No generations are selected until the player picks some
let genStates = {
    1: false,
    2: false,
    3: false,
    4: false,
    5: false,
    6: false,
    7: false,
    8: false,
    9: false
};

function setSelected(btn, isSelected) {
    btn.classList.toggle('selected', isSelected);
    btn.classList.toggle('deselected', !isSelected);
}

function allGensSelected() {
    return Object.values(genStates).every(state => state);
}

// Updates the generation buttons, and lights up All only when every generation is selected
function updateGenButtons() {
    for (let i = 1; i <= 9; i++) {
        setSelected(document.getElementById(`gen${i}-btn`), genStates[i]);
    }
    setSelected(document.getElementById('all-btn'), allGensSelected());
}

// Toggle buttons on click
for (let i = 1; i <= 9; i++) {
    document.getElementById(`gen${i}-btn`).onclick = () => {
        genStates[i] = !genStates[i];
        updateGenButtons();
    };
}

// All generations button: selects every generation, or clears them if they're all already selected
document.getElementById('all-btn').onclick = () => {
    const selectAll = !allGensSelected();
    for (let i = 1; i <= 9; i++) {
        genStates[i] = selectAll;
    }
    updateGenButtons();
};

// Difficulty buttons (one selected at a time, remembered between sessions)
let selectedDifficulty = 'normal';

function selectDifficulty(difficulty) {
    selectedDifficulty = difficulty;
    for (const btn of document.querySelectorAll('.difficulty-btn')) {
        setSelected(btn, btn.dataset.difficulty === difficulty);
    }
}

for (const btn of document.querySelectorAll('.difficulty-btn')) {
    btn.onclick = () => {
        selectDifficulty(btn.dataset.difficulty);
        chrome.storage.local.set({ 'pkmnDifficulty': btn.dataset.difficulty });
    };
}

chrome.storage.local.get(['pkmnDifficulty']).then(data => {
    if (data.pkmnDifficulty in DIFFICULTY_LABELS) selectDifficulty(data.pkmnDifficulty);
});

// Start button
document.getElementById('start-btn').onclick = async () => {
    const enabledGens = [];
    for (let i = 1; i <= 9; i++) {
        if (genStates[i]) enabledGens.push(i);
    }

    if (enabledGens.length === 0) {
        alert("Please select at least one generation!");
        return;
    }

    const loaded = await loadGameData(document.getElementById('start-btn'));
    if (!loaded) return;
    const [db, EngineModule] = loaded;
    await startEndlessGame(db, EngineModule, enabledGens, selectedDifficulty);
};
