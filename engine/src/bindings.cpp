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
val nextRound(const pkmn::Engine& engine) { return toJs(engine.upcomingRound()); }
int poolSizeInt(const pkmn::Engine& engine) { return static_cast<int>(engine.poolSize()); }

}  // namespace

EMSCRIPTEN_BINDINGS(pkmn_engine) {
    emscripten::class_<pkmn::Engine>("Engine")
        .constructor<std::uint32_t>()
        .function("addPokemon", &addPokemonStats)
        .function("setDifficulty", &setDifficultyByName)
        .function("startGame", &pkmn::Engine::startGame)
        .function("round", &currentRound)
        .function("upcomingRound", &nextRound)
        .function("guess", &submitGuess)
        .function("score", &pkmn::Engine::score)
        .function("poolSize", &poolSizeInt);
}
