const number_of_pokemon = 1025; //As of February 2026. Can be updated if necessary.
let highScore = 0;

//load high score from storage and start the game
async function initGame() {
    const data = await chrome.storage.local.get(['pkmnHighScore']);
    if (data.pkmnHighScore) {
        highScore = data.pkmnHighScore;
        document.getElementById('high-score-label').innerText = `Best: ${highScore}`;
    }
    newRound();
}

//get data from PokeAPI for a given pokemon ID
async function getPokemonData(id) {
    try {
        const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
        if (!response.ok) throw new Error("Pokémon not found");

        const data = await response.json();

        // Extract and return an object with the data we need
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

// Get the image URL for a given Pokémon ID
function getImageUrl(id) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

// Maps the display name to the exact key in our returned object
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
    // blank the question label while loading new data
    document.getElementById('question-label').innerText = "";

    // 1. If it's the first round, get the first Pokémon
    if (!currentPkmn) {
        const first_id = Math.floor(Math.random() * number_of_pokemon) + 1;
        currentPkmn = await getPokemonData(first_id);
    }

    // 2. Get the second Pokémon (and make sure it's not the same as the first)
    let next_id;
    do {
        next_id = Math.floor(Math.random() * number_of_pokemon) + 1;
    } while (next_id === currentPkmn.id);

    newPkmn = await getPokemonData(next_id);

    // 3. Pick a random stat
    randomStat = statsOptions[Math.floor(Math.random() * statsOptions.length)];

    // 4. Update the UI
    document.getElementById('left-img').src = getImageUrl(currentPkmn.id);
    document.getElementById('right-img').src = getImageUrl(newPkmn.id);
    document.getElementById('left-name').innerText = currentPkmn.name;
    document.getElementById('right-name').innerText = newPkmn.name;
    
    document.getElementById('question-label').innerText = 
        `${newPkmn.name} has a higher/lower ${randomStat} than ${currentPkmn.name}`;
}

function checkGuess(guess) {
    if (!currentPkmn || !newPkmn) return; // Prevent clicking before load

    const key = statsMapping[randomStat];
    const valCurrent = currentPkmn[key];
    const valNew = newPkmn[key];

    // Check logic: Is the NEW pokemon's stat higher or lower than the CURRENT one?
    const correct = (guess === 'higher' && valNew >= valCurrent) || 
                    (guess === 'lower' && valNew <= valCurrent);

    if (correct) {
        count++;
        document.getElementById('score-label').innerText = `Score: ${count}`;
        if (count > highScore) {
            highScore = count;
            saveHighScore(highScore);
        }
        currentPkmn = newPkmn; // The new becomes the current for the next round
        newRound();
    } else {
        alert(`Game Over! Score: ${count}\n\n${currentPkmn.name} ${randomStat}: ${valCurrent}\n${newPkmn.name} ${randomStat}: ${valNew}`);
        count = 0;
        document.getElementById('score-label').innerText = `Score: 0`;
        currentPkmn = null; // Reset
        newRound();
    }
}

// Save the high score to local storage
function saveHighScore(score) {
    chrome.storage.local.set({ 'pkmnHighScore': score }, () => {
        document.getElementById('high-score-label').innerText = `Best: ${score}`;
    });
}

// Event Listeners
document.getElementById('higher-btn').onclick = () => checkGuess('higher');
document.getElementById('lower-btn').onclick = () => checkGuess('lower');

// Initial call
initGame();