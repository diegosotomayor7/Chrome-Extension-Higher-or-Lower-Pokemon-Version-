// JavaScript bindings for the engine (Emscripten embind).
//
// The JS side works in plain values: difficulties and guesses are strings ("hard", "higher"),
// stats are indices 0-5 in pokemon_card column order, and rounds/results are plain objects.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <stdexcept>
#include <string>

#include "pkmn/engine.hpp"

using emscripten::val;

namespace {

val toJs(const pkmn::Round& round) {
    val obj = val::object();
    obj.set("currentId", round.currentId);
    obj.set("challengerId", round.challengerId);
    obj.set("stat", static_cast<int>(round.stat));
    return obj;
}

val toJs(const pkmn::GuessResult& result) {
    val obj = val::object();
    obj.set("correct", result.correct);
    obj.set("currentValue", result.currentValue);
    obj.set("challengerValue", result.challengerValue);
    obj.set("score", result.score);
    return obj;
}

void addPokemonStats(pkmn::Engine& engine, int id, int hp, int attack, int defense,
                     int specialAttack, int specialDefense, int speed) {
    engine.addPokemon({id, {hp, attack, defense, specialAttack, specialDefense, speed}});
}

void setDifficultyByName(pkmn::Engine& engine, const std::string& name) {
    auto difficulty = pkmn::parseDifficulty(name);
    if (!difficulty) throw std::invalid_argument("unknown difficulty: " + name);
    engine.setDifficulty(*difficulty);
}

val submitGuess(pkmn::Engine& engine, const std::string& name) {
    auto guess = pkmn::parseGuess(name);
    if (!guess) throw std::invalid_argument("unknown guess: " + name);
    return toJs(engine.guess(*guess));
}

val currentRound(const pkmn::Engine& engine) { return toJs(engine.round()); }
int poolSizeInt(const pkmn::Engine& engine) { return static_cast<int>(engine.poolSize()); }

// null on the last round of a Daily Challenge
val nextRound(const pkmn::Engine& engine) {
    auto round = engine.upcomingRound();
    return round ? toJs(*round) : val::null();
}

std::string roundDifficultyName(const pkmn::Engine& engine) {
    switch (engine.roundDifficulty()) {
        case pkmn::Difficulty::Easy: return "easy";
        case pkmn::Difficulty::Normal: return "normal";
        case pkmn::Difficulty::Hard: return "hard";
        case pkmn::Difficulty::Extreme: return "extreme";
    }
    return "normal";
}

std::uint32_t dailySeed(const std::string& isoDate) { return pkmn::daily::seedForDate(isoDate); }

}  // namespace

EMSCRIPTEN_BINDINGS(pkmn_engine) {
    emscripten::class_<pkmn::Engine>("Engine")
        .constructor<std::uint32_t>()
        .function("addPokemon", &addPokemonStats)
        .function("setDifficulty", &setDifficultyByName)
        .function("startGame", &pkmn::Engine::startGame)
        .function("startDailyChallenge", &pkmn::Engine::startDailyChallenge)
        .function("resumeDailyChallenge", &pkmn::Engine::resumeDailyChallenge)
        .function("round", &currentRound)
        .function("upcomingRound", &nextRound)
        .function("guess", &submitGuess)
        .function("score", &pkmn::Engine::score)
        .function("roundNumber", &pkmn::Engine::roundNumber)
        .function("roundDifficulty", &roundDifficultyName)
        .function("mistakes", &pkmn::Engine::mistakes)
        .function("isFinished", &pkmn::Engine::isFinished)
        .function("poolSize", &poolSizeInt);

    emscripten::function("dailySeed", &dailySeed);
    emscripten::constant("DAILY_ROUNDS", pkmn::daily::kRounds);
    emscripten::constant("DAILY_ROUNDS_PER_DIFFICULTY", pkmn::daily::kRoundsPerDifficulty);
    emscripten::constant("DAILY_MISTAKES_ALLOWED", pkmn::daily::kMistakesAllowed);
}
