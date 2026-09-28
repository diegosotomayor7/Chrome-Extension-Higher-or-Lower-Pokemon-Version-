// Game engine for Pokémon Higher or Lower.
//
// Owns the Pokémon pool, picks each round's challenger and stat according to the difficulty,
// checks guesses, and keeps score. Contains no browser-specific code; the JavaScript bindings
// are in src/bindings.cpp.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <optional>
#include <random>
#include <string>
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

// Easy: 50+ apart. Normal: anything, ties included. Hard: 11-30 apart. Extreme: 1-10 apart.
GapRange gapRange(Difficulty difficulty);

std::optional<Difficulty> parseDifficulty(std::string_view name);
std::optional<Guess> parseGuess(std::string_view name);

// Daily Challenge: the same 20 rounds for every player on a given date, getting harder every 5 rounds.
namespace daily {

inline constexpr int kRounds = 20;
inline constexpr int kRoundsPerDifficulty = 5;
inline constexpr int kMistakesAllowed = 3;  // the 4th mistake ends the challenge

// Rounds 1-5 Easy, 6-10 Normal, 11-15 Hard, 16-20 Extreme. Throws std::out_of_range outside 1..kRounds.
Difficulty difficultyForRound(int round);

// Seed for a date such as "2026-09-28" (FNV-1a hash), so everyone gets the same challenge that day.
std::uint32_t seedForDate(std::string_view isoDate);

}  // namespace daily

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

    // Starts an endless game at the chosen difficulty: resets the score and deals the first round.
    // Throws std::logic_error if the pool has < 2 Pokémon.
    void startGame();

    // Starts the Daily Challenge (see pkmn::daily). The rounds depend only on the seed and the pool,
    // not on the player's guesses. Throws std::logic_error if the pool has < 2 Pokémon.
    void startDailyChallenge();

    // Restarts a Daily Challenge that was interrupted after `roundsPlayed` guesses, dealing the same
    // rounds as before. Throws std::invalid_argument if the numbers aren't a possible unfinished game.
    void resumeDailyChallenge(int roundsPlayed, int score, int mistakes);

    Round round() const;
    // The round after this one (assuming the game continues), so the UI can preload its sprite.
    // Empty on the last round of a Daily Challenge.
    std::optional<Round> upcomingRound() const;

    int score() const { return score_; }
    bool isDaily() const { return daily_; }
    int roundNumber() const { return roundNumber_; }  // 1-based
    int mistakes() const { return mistakes_; }
    Difficulty roundDifficulty() const { return difficultyFor(roundNumber_); }
    // A Daily Challenge is finished after round 20 or once the mistakes allowed run out.
    // Endless games never finish.
    bool isFinished() const { return finished_; }

    // A tie counts as correct for either guess.
    // Endless: correct advances to the next round; wrong resets the score and deals a new game.
    // Daily: every guess advances to the next round; wrong ones count as mistakes.
    // Throws std::logic_error once a Daily Challenge is finished.
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
    void dealFirstRound();
    void advance();
    Difficulty difficultyFor(int roundNumber) const;
    Deal deal(std::size_t current, Difficulty difficulty);
    std::optional<std::size_t> pickChallenger(std::size_t current, Stat stat, Difficulty difficulty);
    std::size_t randomIndex(std::size_t size);
    Round toRound(const Deal& d) const;
    void remember(std::size_t poolIndex);
    bool isRecent(std::size_t poolIndex) const;
    const Deal& started() const;

    std::uint32_t seed_;
    std::mt19937 rng_;
    Difficulty difficulty_ = Difficulty::Normal;
    std::vector<Pokemon> pool_;
    std::unordered_set<int> ids_;
    std::array<std::vector<StatEntry>, kStatCount> byStat_;  // each sorted by value
    std::deque<std::size_t> recent_;
    std::optional<Deal> round_;
    std::optional<Deal> upcoming_;
    bool daily_ = false;
    bool finished_ = false;
    int roundNumber_ = 0;
    int score_ = 0;
    int mistakes_ = 0;
};

}  // namespace pkmn
