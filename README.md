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

1. Click the extension icon in your Chrome toolbar to open the popup.
2. Two Pokémon will appear with a random stat category (HP, Attack, Defense, Special Attack, Special Defense, or Speed).
3. Guess whether the **new Pokémon** (right) has a **higher** or **lower** value for that stat compared to the **current Pokémon** (left).
4. If you're correct, your score increases and the new Pokémon becomes the current one for the next round.
5. If you're wrong, it's **Game Over** — the correct stats are revealed and your score resets.
6. Try to beat your **high score**, which is saved locally between sessions!

---

##  Features

- **1025 Pokémon** — Covers all Pokémon through Generation IX (as of February 2025)
- **6 stat categories** — HP, Attack, Defense, Special Attack, Special Defense, and Speed
- **Persistent high score** — Your best streak is saved using `chrome.storage.local`
- **Live Pokémon sprites** — Fetched directly from the official [PokeAPI sprite repository](https://github.com/PokeAPI/sprites)
- **Lightweight & fast** — No external dependencies or frameworks, pure vanilla JavaScript
- **Offline-friendly score tracking** — High scores persist even after closing the browser

