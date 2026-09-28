// --- Loading ---

// Start loading as soon as the popup opens so the game is ready by the time Start is clicked.
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

const DIFFICULTY_LABELS = {
    easy: "Easy",
    normal: "Normal",
    hard: "Hard",
    extreme: "Extreme"
};

// High scores are kept per difficulty. Scores saved before difficulties existed count as Normal.
async function loadHighScores() {
    const data = await chrome.storage.local.get(['pkmnHighScores', 'pkmnHighScore']);
    return data.pkmnHighScores ?? { normal: data.pkmnHighScore ?? 0 };
}


function gameLogic(db, EngineModule, enabledGens, difficulty) {

    // Load every Pokémon from the enabled generations in one query
    const placeholders = enabledGens.map(() => '?').join(', ');
    const pool = queryAll(db, `
        SELECT id, name, hp, attack, defense, special_attack, special_defense, speed
        FROM pokemon_card
        WHERE generation_id IN (${placeholders})`, enabledGens);
    const pokemonById = new Map(pool.map(p => [p.id, p]));

    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const engine = new EngineModule.Engine(seed);
    for (const p of pool) {
        engine.addPokemon(p.id, p.hp, p.attack, p.defense, p.special_attack, p.special_defense, p.speed);
    }
    engine.setDifficulty(difficulty);
    engine.startGame();

    // Indexed by the engine's stat number, in pokemon_card column order
    const statNames = ["HP", "Attack", "Defense", "Special Attack", "Special Defense", "Speed"];

    let highScores = {};

    async function initGame() {
        highScores = await loadHighScores();
        showHighScore();
        showRound();
    }

    function getImageUrl(id) {
        return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
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
        const round = engine.round();
        const currentPkmn = pokemonById.get(round.currentId);
        const newPkmn = pokemonById.get(round.challengerId);

        setSprite(document.getElementById('left-img'), currentPkmn.id);
        setSprite(document.getElementById('right-img'), newPkmn.id);
        document.getElementById('left-name').innerText = currentPkmn.name;
        document.getElementById('right-name').innerText = newPkmn.name;

        document.getElementById('question-label').innerText =
            `${newPkmn.name} has a higher/lower ${statNames[round.stat]} than ${currentPkmn.name}`;

        // Download the next challenger's sprite now so it appears instantly after a correct guess
        const img = new Image();
        img.src = getImageUrl(engine.upcomingRound().challengerId);
    }

    function checkGuess(guess) {
        const round = engine.round();
        const result = engine.guess(guess);

        if (result.correct) {
            document.getElementById('score-label').innerText = `Score: ${result.score}`;
            if (result.score > (highScores[difficulty] ?? 0)) {
                highScores[difficulty] = result.score;
                saveHighScores();
            }
        } else {
            const statName = statNames[round.stat];
            alert(`Game Over! Score: ${result.score}\n\n` +
                  `${pokemonById.get(round.currentId).name} ${statName}: ${result.currentValue}\n` +
                  `${pokemonById.get(round.challengerId).name} ${statName}: ${result.challengerValue}`);
            document.getElementById('score-label').innerText = `Score: 0`;
        }
        showRound();
    }

    function showHighScore() {
        document.getElementById('high-score-label').innerText =
            `Best (${DIFFICULTY_LABELS[difficulty]}): ${highScores[difficulty] ?? 0}`;
    }

    function saveHighScores() {
        chrome.storage.local.set({ 'pkmnHighScores': highScores }, showHighScore);
    }

    document.getElementById('higher-btn').onclick = () => checkGuess('higher');
    document.getElementById('lower-btn').onclick = () => checkGuess('lower');

    initGame();
}


// --- Menu Logic ---

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

    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = true;
    let db, EngineModule;
    try {
        [db, EngineModule] = await Promise.all([pokedexReady, engineReady]);
    } catch {
        alert("Couldn't load the game. Try reopening the extension.");
        startBtn.disabled = false;
        return;
    }

    document.getElementById('menu-container').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    gameLogic(db, EngineModule, enabledGens, selectedDifficulty);
};
