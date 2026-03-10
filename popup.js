function gameLogic(enabledGens) {

    const genRanges = {
        1: [1, 151],
        2: [152, 251],
        3: [252, 386],
        4: [387, 493],
        5: [494, 649],
        6: [650, 721],
        7: [722, 809],
        8: [810, 905],
        9: [906, 1025]
    };

    // Build the pool of valid Pokémon IDs based on enabled generations
    let validIds = [];
    for (const gen of enabledGens) {
        const [start, end] = genRanges[gen];
        for (let i = start; i <= end; i++) {
            validIds.push(i);
        }
    }

    // Fallback to gen 1 if somehow empty
    if (validIds.length === 0) {
        const [start, end] = genRanges[1];
        for (let i = start; i <= end; i++) {
            validIds.push(i);
        }
    }

    let highScore = 0;

    // --- Prefetch Queue ---
    const QUEUE_SIZE = 3;
    let prefetchQueue = [];
    let isFilling = false;

    function randomValidId(excludeId) {
        let id;
        do {
            id = validIds[Math.floor(Math.random() * validIds.length)];
        } while (id === excludeId && validIds.length > 1);
        return id;
    }

    async function fillQueue() {
        if (isFilling) return;
        isFilling = true;
        while (prefetchQueue.length < QUEUE_SIZE) {
            const id = randomValidId(null);
            const data = await getPokemonData(id);
            if (data) {
                const img = new Image();
                img.src = getImageUrl(id);
                prefetchQueue.push(data);
            }
        }
        isFilling = false;
    }

    async function getNextPokemon(excludeId) {
        let index = prefetchQueue.findIndex(p => p.id !== excludeId);
        if (index !== -1) {
            const pkmn = prefetchQueue.splice(index, 1)[0];
            fillQueue();
            return pkmn;
        }
        let id = randomValidId(excludeId);
        const data = await getPokemonData(id);
        fillQueue();
        return data;
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

    async function getPokemonData(id) {
        try {
            const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
            if (!response.ok) throw new Error("Pokémon not found");

            const data = await response.json();

            return {
                id: id,
                name: data.name.charAt(0).toUpperCase() + data.name.slice(1),
                hp: data.stats[0].base_stat,
                attack: data.stats[1].base_stat,
                defense: data.stats[2].base_stat,
                "special-attack": data.stats[3].base_stat,
                "special-defense": data.stats[4].base_stat,
                speed: data.stats[5].base_stat
            };
        } catch (err) {
            console.error(err.message);
            return null;
        }
    }

    function getImageUrl(id) {
        return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
    }

    const statsMapping = {
        "HP": "hp",
        "Attack": "attack",
        "Defense": "defense",
        "Special Attack": "special-attack",
        "Special Defense": "special-defense",
        "Speed": "speed"
    };

    const statsOptions = Object.keys(statsMapping);
    let currentPkmn, newPkmn, randomStat, count = 0;

    async function newRound() {
        document.getElementById('question-label').innerText = "";

        if (!currentPkmn) {
            currentPkmn = await getNextPokemon(null);
        }

        newPkmn = await getNextPokemon(currentPkmn.id);

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
document.getElementById('start-btn').onclick = () => {
    const enabledGens = [];
    for (let i = 1; i <= 9; i++) {
        if (genStates[i]) enabledGens.push(i);
    }

    if (enabledGens.length === 0) {
        alert("Please select at least one generation!");
        return;
    }

    document.getElementById('menu-container').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    gameLogic(enabledGens);
};