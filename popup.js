// --- Pokédex Database ---

// Start loading as soon as the popup opens so the game is ready by the time Start is clicked.
const pokedexReady = loadPokedex();
pokedexReady.catch(err => console.error('Failed to load Pokédex:', err));

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


function gameLogic(db, enabledGens) {

    // Load every Pokémon from the enabled generations in one query
    const placeholders = enabledGens.map(() => '?').join(', ');
    const pool = queryAll(db, `
        SELECT id, name, hp, attack, defense, special_attack, special_defense, speed
        FROM pokemon_card
        WHERE generation_id IN (${placeholders})`, enabledGens);

    let highScore = 0;

    // --- Prefetch Queue ---
    // Pokémon are picked a few rounds ahead so their sprites are already downloaded when shown.
    const QUEUE_SIZE = 3;
    let prefetchQueue = [];

    function randomPokemon(excludeId) {
        let pkmn;
        do {
            pkmn = pool[Math.floor(Math.random() * pool.length)];
        } while (pkmn.id === excludeId && pool.length > 1);
        return pkmn;
    }

    function fillQueue() {
        while (prefetchQueue.length < QUEUE_SIZE) {
            const pkmn = randomPokemon(null);
            const img = new Image();
            img.src = getImageUrl(pkmn.id);
            prefetchQueue.push(pkmn);
        }
    }

    function getNextPokemon(excludeId) {
        const index = prefetchQueue.findIndex(p => p.id !== excludeId);
        const pkmn = index !== -1 ? prefetchQueue.splice(index, 1)[0] : randomPokemon(excludeId);
        fillQueue();
        return pkmn;
    }
    // --- End Prefetch Queue ---

    async function initGame() {
        const data = await chrome.storage.local.get(['pkmnHighScore']);
        if (data.pkmnHighScore) {
            highScore = data.pkmnHighScore;
            document.getElementById('high-score-label').innerText = `Best: ${highScore}`;
        }
        fillQueue();
        newRound();
    }

    function getImageUrl(id) {
        return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
    }

    const statsMapping = {
        "HP": "hp",
        "Attack": "attack",
        "Defense": "defense",
        "Special Attack": "special_attack",
        "Special Defense": "special_defense",
        "Speed": "speed"
    };

    const statsOptions = Object.keys(statsMapping);
    let currentPkmn, newPkmn, randomStat, count = 0;

    function newRound() {
        document.getElementById('question-label').innerText = "";

        if (!currentPkmn) {
            currentPkmn = getNextPokemon(null);
        }

        newPkmn = getNextPokemon(currentPkmn.id);

        randomStat = statsOptions[Math.floor(Math.random() * statsOptions.length)];

        document.getElementById('left-img').src = getImageUrl(currentPkmn.id);
        document.getElementById('right-img').src = getImageUrl(newPkmn.id);
        document.getElementById('left-name').innerText = currentPkmn.name;
        document.getElementById('right-name').innerText = newPkmn.name;

        document.getElementById('question-label').innerText =
            `${newPkmn.name} has a higher/lower ${randomStat} than ${currentPkmn.name}`;
    }

    function checkGuess(guess) {
        if (!currentPkmn || !newPkmn) return;

        const key = statsMapping[randomStat];
        const valCurrent = currentPkmn[key];
        const valNew = newPkmn[key];

        const correct = (guess === 'higher' && valNew >= valCurrent) ||
                        (guess === 'lower' && valNew <= valCurrent);

        if (correct) {
            count++;
            document.getElementById('score-label').innerText = `Score: ${count}`;
            if (count > highScore) {
                highScore = count;
                saveHighScore(highScore);
            }
            currentPkmn = newPkmn;
            newRound();
        } else {
            alert(`Game Over! Score: ${count}\n\n${currentPkmn.name} ${randomStat}: ${valCurrent}\n${newPkmn.name} ${randomStat}: ${valNew}`);
            count = 0;
            document.getElementById('score-label').innerText = `Score: 0`;
            currentPkmn = null;
            newRound();
        }
    }

    function saveHighScore(score) {
        chrome.storage.local.set({ 'pkmnHighScore': score }, () => {
            document.getElementById('high-score-label').innerText = `Best: ${score}`;
        });
    }

    document.getElementById('higher-btn').onclick = () => checkGuess('higher');
    document.getElementById('lower-btn').onclick = () => checkGuess('lower');

    initGame();
}


// --- Menu Logic ---

let genStates = {
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    7: true,
    8: true,
    9: true,
    10: true
};

// Toggle buttons on click
for (let i = 1; i <= 9; i++) {
    document.getElementById(`gen${i}-btn`).onclick = () => {
        genStates[i] = !genStates[i];
        const btn = document.getElementById(`gen${i}-btn`);
        if (genStates[i]) {
            btn.classList.remove('deselected');
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
            btn.classList.add('deselected');
        }
    };
}

// All generations button
document.getElementById('all-btn').onclick = () => {
    const allSelected = Object.values(genStates).every(state => state);
    for (let i = 1; i <= 9; i++) {
        genStates[i] = !allSelected;
        const btn = document.getElementById(`gen${i}-btn`);
        if (genStates[i]) {
            btn.classList.remove('deselected');
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
            btn.classList.add('deselected');
        }
    }
};

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
    let db;
    try {
        db = await pokedexReady;
    } catch {
        alert("Couldn't load the Pokédex database. Try reopening the extension.");
        startBtn.disabled = false;
        return;
    }

    document.getElementById('menu-container').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    gameLogic(db, enabledGens);
};