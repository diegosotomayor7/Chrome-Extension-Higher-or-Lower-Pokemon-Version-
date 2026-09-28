#include "pkmn/engine.hpp"

#include <algorithm>
#include <stdexcept>
#include <string>

namespace pkmn {

namespace {

// Base stats top out at 255, so no two can be further apart than this.
constexpr int kMaxGap = 255;

// How many random draws to try before accepting a recently seen challenger.
constexpr int kMaxSampleAttempts = 16;

}  // namespace

GapRange gapRange(Difficulty difficulty) {
    switch (difficulty) {
        case Difficulty::Easy:    return {50, kMaxGap};
        case Difficulty::Normal:  return {0, kMaxGap};
        case Difficulty::Hard:    return {11, 30};
        case Difficulty::Extreme: return {1, 10};
    }
    throw std::invalid_argument("unknown difficulty");
}

std::optional<Difficulty> parseDifficulty(std::string_view name) {
    if (name == "easy") return Difficulty::Easy;
    if (name == "normal") return Difficulty::Normal;
    if (name == "hard") return Difficulty::Hard;
    if (name == "extreme") return Difficulty::Extreme;
    return std::nullopt;
}

std::optional<Guess> parseGuess(std::string_view name) {
    if (name == "higher") return Guess::Higher;
    if (name == "lower") return Guess::Lower;
    return std::nullopt;
}

namespace daily {

static_assert(kRounds == 4 * kRoundsPerDifficulty, "one block of rounds per difficulty");

Difficulty difficultyForRound(int round) {
    if (round < 1 || round > kRounds) {
        throw std::out_of_range("daily round " + std::to_string(round) + " is outside 1-20");
    }
    constexpr Difficulty kSchedule[] = {Difficulty::Easy, Difficulty::Normal, Difficulty::Hard,
                                        Difficulty::Extreme};
    return kSchedule[(round - 1) / kRoundsPerDifficulty];
}

std::uint32_t seedForDate(std::string_view isoDate) {
    std::uint32_t hash = 2166136261u;  // FNV-1a offset basis
    for (unsigned char c : isoDate) {
        hash ^= c;
        hash *= 16777619u;  // FNV prime
    }
    return hash;
}

}  // namespace daily

Engine::Engine(std::uint32_t seed) : seed_(seed), rng_(seed) {}

void Engine::addPokemon(const Pokemon& pokemon) {
    if (!ids_.insert(pokemon.id).second) {
        throw std::invalid_argument("duplicate Pokémon id " + std::to_string(pokemon.id));
    }
    pool_.push_back(pokemon);
}

void Engine::startGame() {
    daily_ = false;
    dealFirstRound();
}

void Engine::startDailyChallenge() {
    daily_ = true;
    rng_.seed(seed_);  // same seed, same rounds, even if this engine already played
    dealFirstRound();
}

void Engine::resumeDailyChallenge(int roundsPlayed, int score, int mistakes) {
    if (roundsPlayed < 0 || roundsPlayed >= daily::kRounds || score < 0 || mistakes < 0 ||
        score + mistakes != roundsPlayed || mistakes > daily::kMistakesAllowed) {
        throw std::invalid_argument("not an unfinished Daily Challenge");
    }
    startDailyChallenge();
    // Rounds don't depend on guesses, so replaying the deals reproduces the interrupted game.
    for (int i = 0; i < roundsPlayed; ++i) advance();
    score_ = score;
    mistakes_ = mistakes;
}

Round Engine::round() const { return toRound(started()); }

std::optional<Round> Engine::upcomingRound() const {
    started();
    if (!upcoming_) return std::nullopt;
    return toRound(*upcoming_);
}

GuessResult Engine::guess(Guess guess) {
    const Deal& d = started();
    if (finished_) throw std::logic_error("the Daily Challenge is already finished");

    const int currentValue = pool_[d.current].stat(d.stat);
    const int challengerValue = pool_[d.challenger].stat(d.stat);
    const bool correct = guess == Guess::Higher ? challengerValue >= currentValue
                                                : challengerValue <= currentValue;

    if (daily_) {
        if (correct) {
            ++score_;
        } else {
            ++mistakes_;
        }
        const GuessResult result{correct, currentValue, challengerValue, score_};
        if (mistakes_ > daily::kMistakesAllowed || roundNumber_ == daily::kRounds) {
            finished_ = true;
        } else {
            advance();
        }
        return result;
    }

    if (!correct) {
        const int finalScore = score_;
        startGame();
        return {false, currentValue, challengerValue, finalScore};
    }
    ++score_;
    advance();
    return {true, currentValue, challengerValue, score_};
}

void Engine::dealFirstRound() {
    if (pool_.size() < 2) {
        throw std::logic_error("need at least 2 Pokémon to play");
    }
    buildIndex();
    score_ = 0;
    mistakes_ = 0;
    finished_ = false;
    recent_.clear();

    roundNumber_ = 0;
    const std::size_t first = randomIndex(pool_.size());
    remember(first);
    upcoming_ = deal(first, difficultyFor(1));
    advance();
}

// Moves to the upcoming round and deals the one after it (none after the last Daily Challenge round).
void Engine::advance() {
    round_ = upcoming_;
    ++roundNumber_;
    remember(round_->challenger);
    if (daily_ && roundNumber_ >= daily::kRounds) {
        upcoming_.reset();
    } else {
        upcoming_ = deal(round_->challenger, difficultyFor(roundNumber_ + 1));
    }
}

Difficulty Engine::difficultyFor(int roundNumber) const {
    return daily_ ? daily::difficultyForRound(std::clamp(roundNumber, 1, daily::kRounds)) : difficulty_;
}

void Engine::buildIndex() {
    for (std::size_t s = 0; s < kStatCount; ++s) {
        auto& entries = byStat_[s];
        entries.clear();
        entries.reserve(pool_.size());
        for (std::size_t i = 0; i < pool_.size(); ++i) {
            entries.push_back({pool_[i].stats[s], i});
        }
        std::sort(entries.begin(), entries.end(),
                  [](const StatEntry& a, const StatEntry& b) { return a.value < b.value; });
    }
}

// Tries the stats in random order and uses the first one that has a challenger in the difficulty's
// gap range. If none does (only possible with a tiny pool), falls back to a random stat and challenger.
Engine::Deal Engine::deal(std::size_t current, Difficulty difficulty) {
    std::array<Stat, kStatCount> stats{Stat::Hp, Stat::Attack, Stat::Defense,
                                       Stat::SpecialAttack, Stat::SpecialDefense, Stat::Speed};
    std::shuffle(stats.begin(), stats.end(), rng_);

    for (Stat stat : stats) {
        if (auto challenger = pickChallenger(current, stat, difficulty)) {
            return {current, *challenger, stat};
        }
    }

    std::size_t challenger = randomIndex(pool_.size() - 1);
    if (challenger >= current) ++challenger;  // skip over current
    return {current, challenger, stats[0]};
}

// Finds every Pokémon whose value for `stat` is within the gap range of the current one's, using binary
// search on the sorted per-stat index. With gap [lo, hi] around value v, those are the entries with
// values in [v-hi, v-lo] and [v+lo, v+hi] (one merged range when lo is 0). Picks one uniformly,
// preferring Pokémon not shown recently.
std::optional<std::size_t> Engine::pickChallenger(std::size_t current, Stat stat, Difficulty difficulty) {
    const auto& entries = byStat_[static_cast<std::size_t>(stat)];
    const int v = pool_[current].stat(stat);
    const auto [lo, hi] = gapRange(difficulty);

    auto valueRange = [&](int from, int to) {
        auto first = std::lower_bound(entries.begin(), entries.end(), from,
                                      [](const StatEntry& e, int x) { return e.value < x; });
        auto last = std::upper_bound(first, entries.end(), to,
                                     [](int x, const StatEntry& e) { return x < e.value; });
        return std::pair{first, last};
    };

    const auto below = lo == 0 ? valueRange(v - hi, v + hi) : valueRange(v - hi, v - lo);
    const auto above = lo == 0 ? std::pair{entries.end(), entries.end()} : valueRange(v + lo, v + hi);

    const auto belowSize = static_cast<std::size_t>(below.second - below.first);
    const auto total = belowSize + static_cast<std::size_t>(above.second - above.first);
    auto at = [&](std::size_t k) {
        return k < belowSize ? below.first[k].poolIndex : above.first[k - belowSize].poolIndex;
    };

    if (total == 0) return std::nullopt;

    std::optional<std::size_t> recentFallback;
    for (int attempt = 0; attempt < kMaxSampleAttempts; ++attempt) {
        const std::size_t candidate = at(randomIndex(total));
        if (candidate == current) continue;
        if (!isRecent(candidate)) return candidate;
        recentFallback = candidate;
    }
    if (recentFallback) return recentFallback;

    // Random draws kept landing on current, so the range is (almost) only current.
    for (std::size_t k = 0; k < total; ++k) {
        if (at(k) != current) return at(k);
    }
    return std::nullopt;
}

std::size_t Engine::randomIndex(std::size_t size) {
    return std::uniform_int_distribution<std::size_t>(0, size - 1)(rng_);
}

Round Engine::toRound(const Deal& d) const {
    return {pool_[d.current].id, pool_[d.challenger].id, d.stat};
}

void Engine::remember(std::size_t poolIndex) {
    recent_.push_back(poolIndex);
    if (recent_.size() > kRecentHistory) recent_.pop_front();
}

bool Engine::isRecent(std::size_t poolIndex) const {
    return std::find(recent_.begin(), recent_.end(), poolIndex) != recent_.end();
}

const Engine::Deal& Engine::started() const {
    if (!round_) throw std::logic_error("no game has been started");
    return *round_;
}

}  // namespace pkmn
