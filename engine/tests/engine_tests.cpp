#include "pkmn/engine.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <cstdlib>
#include <deque>
#include <map>
#include <random>
#include <set>
#include <stdexcept>

using namespace pkmn;

namespace {

constexpr Difficulty kAllDifficulties[] = {Difficulty::Easy, Difficulty::Normal, Difficulty::Hard,
                                           Difficulty::Extreme};

// A pool of `size` Pokémon with random stats in 1..255, ids 1..size.
std::map<int, Pokemon> randomPool(std::size_t size, std::uint32_t seed = 7) {
    std::mt19937 rng(seed);
    std::uniform_int_distribution<int> stat(1, 255);
    std::map<int, Pokemon> pool;
    for (int id = 1; id <= static_cast<int>(size); ++id) {
        pool[id] = {id, {stat(rng), stat(rng), stat(rng), stat(rng), stat(rng), stat(rng)}};
    }
    return pool;
}

Engine makeEngine(const std::map<int, Pokemon>& pool, Difficulty difficulty, std::uint32_t seed = 42) {
    Engine engine(seed);
    for (const auto& [id, pokemon] : pool) engine.addPokemon(pokemon);
    engine.setDifficulty(difficulty);
    engine.startGame();
    return engine;
}

int valueOf(const std::map<int, Pokemon>& pool, int id, Stat stat) { return pool.at(id).stat(stat); }

Guess correctGuess(const std::map<int, Pokemon>& pool, const Round& r) {
    return valueOf(pool, r.challengerId, r.stat) >= valueOf(pool, r.currentId, r.stat) ? Guess::Higher
                                                                                        : Guess::Lower;
}

int gapOf(const std::map<int, Pokemon>& pool, const Round& r) {
    return std::abs(valueOf(pool, r.challengerId, r.stat) - valueOf(pool, r.currentId, r.stat));
}

}  // namespace

// --- Parsing and configuration ---

TEST(Difficulty, ParsesKnownNames) {
    EXPECT_EQ(parseDifficulty("easy"), Difficulty::Easy);
    EXPECT_EQ(parseDifficulty("normal"), Difficulty::Normal);
    EXPECT_EQ(parseDifficulty("hard"), Difficulty::Hard);
    EXPECT_EQ(parseDifficulty("extreme"), Difficulty::Extreme);
    EXPECT_EQ(parseDifficulty("Hard"), std::nullopt);
    EXPECT_EQ(parseDifficulty(""), std::nullopt);
}

TEST(Guess, ParsesKnownNames) {
    EXPECT_EQ(parseGuess("higher"), Guess::Higher);
    EXPECT_EQ(parseGuess("lower"), Guess::Lower);
    EXPECT_EQ(parseGuess("same"), std::nullopt);
}

TEST(Difficulty, GapRangesGetNarrowerAndCloser) {
    EXPECT_EQ(gapRange(Difficulty::Normal).min, 0);  // ties allowed
    EXPECT_GE(gapRange(Difficulty::Easy).min, 40);
    EXPECT_GT(gapRange(Difficulty::Hard).min, gapRange(Difficulty::Extreme).max);
    EXPECT_GE(gapRange(Difficulty::Extreme).min, 1);  // no free points from ties
    for (Difficulty d : kAllDifficulties) EXPECT_LE(gapRange(d).min, gapRange(d).max);
}

// --- Setup errors ---

TEST(Engine, RejectsDuplicateIds) {
    Engine engine(1);
    engine.addPokemon({25, {35, 55, 40, 50, 50, 90}});
    EXPECT_THROW(engine.addPokemon({25, {1, 1, 1, 1, 1, 1}}), std::invalid_argument);
    EXPECT_EQ(engine.poolSize(), 1u);
}

TEST(Engine, NeedsTwoPokemonToStart) {
    Engine engine(1);
    EXPECT_THROW(engine.startGame(), std::logic_error);
    engine.addPokemon({1, {45, 49, 49, 65, 65, 45}});
    EXPECT_THROW(engine.startGame(), std::logic_error);
    engine.addPokemon({4, {39, 52, 43, 60, 50, 65}});
    EXPECT_NO_THROW(engine.startGame());
}

TEST(Engine, RoundRequiresStartedGame) {
    Engine engine(1);
    EXPECT_THROW(engine.round(), std::logic_error);
    EXPECT_THROW(engine.upcomingRound(), std::logic_error);
    EXPECT_THROW(engine.guess(Guess::Higher), std::logic_error);
}

// --- Guessing and scoring ---

TEST(Engine, CorrectGuessScoresAndAdvancesToUpcomingRound) {
    const auto pool = randomPool(100);
    Engine engine = makeEngine(pool, Difficulty::Normal);

    for (int expectedScore = 1; expectedScore <= 50; ++expectedScore) {
        const Round before = engine.round();
        const Round upcoming = engine.upcomingRound();
        EXPECT_EQ(upcoming.currentId, before.challengerId);

        const GuessResult result = engine.guess(correctGuess(pool, before));
        EXPECT_TRUE(result.correct);
        EXPECT_EQ(result.score, expectedScore);
        EXPECT_EQ(engine.score(), expectedScore);
        EXPECT_EQ(result.currentValue, valueOf(pool, before.currentId, before.stat));
        EXPECT_EQ(result.challengerValue, valueOf(pool, before.challengerId, before.stat));

        const Round after = engine.round();
        EXPECT_EQ(after.currentId, upcoming.currentId);
        EXPECT_EQ(after.challengerId, upcoming.challengerId);
        EXPECT_EQ(after.stat, upcoming.stat);
    }
}

TEST(Engine, WrongGuessEndsGameAndReportsFinalScore) {
    const auto pool = randomPool(100);
    Engine engine = makeEngine(pool, Difficulty::Hard);  // Hard never deals ties, so a wrong guess exists

    for (int i = 0; i < 7; ++i) engine.guess(correctGuess(pool, engine.round()));
    ASSERT_EQ(engine.score(), 7);

    const Round r = engine.round();
    const Guess wrong = correctGuess(pool, r) == Guess::Higher ? Guess::Lower : Guess::Higher;
    const GuessResult result = engine.guess(wrong);

    EXPECT_FALSE(result.correct);
    EXPECT_EQ(result.score, 7);
    EXPECT_EQ(engine.score(), 0);
    EXPECT_NE(engine.round().currentId, engine.round().challengerId);
}

TEST(Engine, TieIsCorrectForEitherGuess) {
    const std::map<int, Pokemon> twins{{1, {1, {80, 80, 80, 80, 80, 80}}},
                                       {2, {2, {80, 80, 80, 80, 80, 80}}}};
    for (Guess g : {Guess::Higher, Guess::Lower}) {
        Engine engine = makeEngine(twins, Difficulty::Normal);
        EXPECT_TRUE(engine.guess(g).correct);
        EXPECT_EQ(engine.score(), 1);
    }
}

// --- Dealing ---

class EveryDifficulty : public ::testing::TestWithParam<Difficulty> {};

TEST_P(EveryDifficulty, GapAlwaysWithinDifficultyRange) {
    const auto pool = randomPool(300);
    const GapRange range = gapRange(GetParam());
    Engine engine = makeEngine(pool, GetParam());

    for (int i = 0; i < 3000; ++i) {
        const Round r = engine.round();
        const int gap = gapOf(pool, r);
        ASSERT_GE(gap, range.min) << "round " << i;
        ASSERT_LE(gap, range.max) << "round " << i;
        engine.guess(correctGuess(pool, r));
    }
}

TEST_P(EveryDifficulty, ChallengerIsNeverTheCurrentPokemon) {
    const auto pool = randomPool(50);
    Engine engine = makeEngine(pool, GetParam());
    for (int i = 0; i < 2000; ++i) {
        const Round r = engine.round();
        ASSERT_NE(r.currentId, r.challengerId);
        engine.guess(correctGuess(pool, r));
    }
}

TEST_P(EveryDifficulty, EveryStatGetsAsked) {
    const auto pool = randomPool(300);
    Engine engine = makeEngine(pool, GetParam());
    std::set<Stat> asked;
    for (int i = 0; i < 500; ++i) {
        const Round r = engine.round();
        asked.insert(r.stat);
        engine.guess(correctGuess(pool, r));
    }
    EXPECT_EQ(asked.size(), kStatCount);
}

INSTANTIATE_TEST_SUITE_P(Engine, EveryDifficulty, ::testing::ValuesIn(kAllDifficulties),
                         [](const auto& info) {
                             switch (info.param) {
                                 case Difficulty::Easy: return "Easy";
                                 case Difficulty::Normal: return "Normal";
                                 case Difficulty::Hard: return "Hard";
                                 case Difficulty::Extreme: return "Extreme";
                             }
                             return "Unknown";
                         });

TEST(Engine, FallsBackWhenNoChallengerFitsTheDifficulty) {
    // Identical stats: every gap is 0, which Extreme (1-5) never allows.
    const std::map<int, Pokemon> twins{{1, {1, {80, 80, 80, 80, 80, 80}}},
                                       {2, {2, {80, 80, 80, 80, 80, 80}}}};
    Engine engine = makeEngine(twins, Difficulty::Extreme);
    for (int i = 0; i < 20; ++i) {
        const Round r = engine.round();
        ASSERT_NE(r.currentId, r.challengerId);
        engine.guess(Guess::Higher);
    }
    EXPECT_EQ(engine.score(), 20);
}

TEST(Engine, AvoidsRecentlyShownPokemonWhenPoolIsLarge) {
    const auto pool = randomPool(400);
    Engine engine = makeEngine(pool, Difficulty::Normal);

    std::deque<int> shown{engine.round().currentId};
    for (int i = 0; i < 2000; ++i) {
        const Round r = engine.round();
        ASSERT_EQ(std::count(shown.begin(), shown.end(), r.challengerId), 0) << "round " << i;
        shown.push_back(r.challengerId);
        if (shown.size() > Engine::kRecentHistory - 1) shown.pop_front();
        engine.guess(correctGuess(pool, r));
    }
}

TEST(Engine, SameSeedDealsSameGame) {
    const auto pool = randomPool(200);
    Engine a = makeEngine(pool, Difficulty::Hard, 1234);
    Engine b = makeEngine(pool, Difficulty::Hard, 1234);
    for (int i = 0; i < 200; ++i) {
        const Round ra = a.round(), rb = b.round();
        ASSERT_EQ(ra.currentId, rb.currentId);
        ASSERT_EQ(ra.challengerId, rb.challengerId);
        ASSERT_EQ(ra.stat, rb.stat);
        a.guess(correctGuess(pool, ra));
        b.guess(correctGuess(pool, rb));
    }
}
