// Game engine for Pokémon Higher or Lower.
//
// Owns the Pokémon pool, picks each round's challenger and stat according to the difficulty,
// checks guesses, and keeps score. It has no browser or Emscripten dependencies: the web build
// wraps it in src/bindings.cpp, and the unit tests use it directly.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <optional>
#include <random>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace pkmn {

// Order matches the stat columns in the pokemon_card view.
enum class Stat : std::uint8_t { Hp, Attack, Defense, SpecialAttack, SpecialDefense, Speed };
inline constexpr std::size_t kStatCount = 6;

enum class Difficulty : std::uint8_t { Easy, Normal, Hard, Extreme };

enum class Guess : std::uint8_t { Higher, Lower };

// Inclusive range for |challenger stat - current stat|.
struct GapRange {
    int min;
    int max;
};

// Easy: 40+ apart. Normal: anything, ties included. Hard: 6-20 apart. Extreme: 1-5 apart.
GapRange gapRange(Difficulty difficulty);

std::optional<Difficulty> parseDifficulty(std::string_view name);
std::optional<Guess> parseGuess(std::string_view name);

struct Pokemon {
    int id;
    std::array<int, kStatCount> stats;

    int stat(Stat s) const { return stats[static_cast<std::size_t>(s)]; }
};

struct Round {
    int currentId;
    int challengerId;
    Stat stat;
};

struct GuessResult {
    bool correct;
    int currentValue;
    int challengerValue;
    int score;  // the new score if correct, otherwise the score the game ended with
};

class Engine {
public:
    // Pokémon shown recently are skipped when the difficulty band has other options.
    static constexpr std::size_t kRecentHistory = 8;

    explicit Engine(std::uint32_t seed);

    // Adds a Pokémon to the pool; takes effect on the next startGame().
    // Throws std::invalid_argument if the id is already in the pool.
    void addPokemon(const Pokemon& pokemon);
    std::size_t poolSize() const { return pool_.size(); }

    void setDifficulty(Difficulty difficulty) { difficulty_ = difficulty; }
    Difficulty difficulty() const { return difficulty_; }

    // Resets the score and deals the first round. Throws std::logic_error if the pool has < 2 Pokémon.
    void startGame();

    Round round() const;
    // The round that follows if the current guess is correct, so the UI can preload its sprite.
    Round upcomingRound() const;
    int score() const { return score_; }

    // Correct: the challenger becomes the current Pokémon. Wrong: the score resets and a new game is dealt.
    // A tie counts as correct for either guess.
    GuessResult guess(Guess guess);

private:
    struct StatEntry {
        int value;
        std::size_t poolIndex;
    };

    // A round in terms of pool positions.
    struct Deal {
        std::size_t current;
        std::size_t challenger;
        Stat stat;
    };

    void buildIndex();
    Deal deal(std::size_t current);
    std::optional<std::size_t> pickChallenger(std::size_t current, Stat stat);
    std::size_t randomIndex(std::size_t size);
    Round toRound(const Deal& d) const;
    void remember(std::size_t poolIndex);
    bool isRecent(std::size_t poolIndex) const;
    const Deal& started() const;

    std::mt19937 rng_;
    Difficulty difficulty_ = Difficulty::Normal;
    std::vector<Pokemon> pool_;
    std::unordered_set<int> ids_;
    std::array<std::vector<StatEntry>, kStatCount> byStat_;  // each sorted by value
    std::deque<std::size_t> recent_;
    std::optional<Deal> round_;
    std::optional<Deal> upcoming_;
    int score_ = 0;
};

}  // namespace pkmn
