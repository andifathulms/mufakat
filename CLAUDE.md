# CLAUDE.md — Mufakat

Raft consensus simulator with deterministic discrete-event simulation, continuous safety-invariant checking, and an ablation mode that disables individual Raft rules so the guarantee they protect visibly fails. Static site, GitHub Pages, no backend.

Read `PRD.md` before starting any task. It fixes scope; this file describes how to work in the repo.

**Three things shape everything:**

1. **This teaches, so wrongness is expensive.** A subtly incorrect Raft teaches incorrect Raft, confidently, with good animations. Correctness gates public launch, not the other way round.
2. **Implement Figure 2 literally.** The Raft paper's Figure 2 is a complete, condensed specification — RPC arguments, receiver rules, server rules. Implement it rule by rule with the rule cited in the comment. **Do not paraphrase the spec from memory.** Raft is easy to get almost right, and almost right is wrong.
3. **Determinism is load-bearing.** Virtual clock, seeded PRNG, pure state machines. Time travel, sharing, fuzzing, and reproducible bug reports all rest on it.

---

## Stack

- Next.js 14, App Router, `output: 'export'` — static only
- TypeScript, `strict: true`
- Tailwind CSS
- Vitest
- pnpm
- No distributed-systems library, no simulation framework, no state library. The scheduler and the state machine are the project.

## Commands

```bash
pnpm dev
pnpm build                  # static export to ./out
pnpm preview                # serve ./out under the production basePath
pnpm test                   # vitest watch
pnpm test:run               # vitest once — before every commit
pnpm test:fuzz              # randomized scenarios vs the five safety properties (slow)
pnpm test:ablation          # each toggle must break its named property
pnpm test:figure8           # exact reproduction of the paper's Figure 8
pnpm test:determinism       # byte-identical trace replay
pnpm typecheck
pnpm lint
```

`pnpm test:fuzz` runs in CI and gates the deploy. Do not weaken it.

## Layout

```
app/
  [locale]/                 # id (default), en
    simulasi/               # cluster + ledger + timeline
    skenario/               # scenario library
    ablasi/                 # ablation panel and explanations
components/
  cluster/                  # node ring, message slips, partitions
  ledger/                   # log columns aligned on index — signature view
  invariants/               # five-property panel
  timeline/                 # scrubber, stepping controls
  ablation/                 # rule toggles
lib/
  sim/                      # scheduler. Pure.
    clock.ts                # virtual clock, priority queue
    network.ts              # latency, drop, duplicate, reorder, partitions
    prng.ts                 # seeded PRNG
    trace.ts                # EventTrace storage, typed arrays, lazy hydration
  raft/                     # THE ALGORITHM. Pure. Figure 2, literally.
    node.ts                 # step(state, input, config) → { state, outbox, timers }
    election.ts             # RequestVote, terms, timeouts
    replication.ts          # AppendEntries, consistency check, nextIndex
    commit.ts               # commitIndex advancement, current-term rule
    rules.ts                # named ablation guards — one place each
    types.ts
  invariants/               # INDEPENDENT checker. Shares no code with lib/raft.
data/
  scenarios/                # curated (config, seed, actions, flags) + phenomenon
workers/
  sim.worker.ts
tests/
  figure2/                  # per-rule conformance fixtures
  figure8/
  fuzz/
  ablation/
  determinism/
```

## Invariants

1. **`lib/raft` is pure.** `step(state, input, config) → { state, outbox, timers }`. No clock reads, no `Date`, no `Math.random`, no I/O, no DOM, no React, no module-level mutable state. Randomness comes only from the seeded PRNG threaded through state.

2. **No wall-clock time anywhere in simulation.** The virtual clock in `lib/sim/clock.ts` is the only notion of time. No `setTimeout` driving logic, no `performance.now()`, no real delays. Animation timing in the UI is separate and never feeds back into the simulation.

3. **Never iterate an unordered collection in `lib/sim` or `lib/raft`.** No `Set` iteration, no `Object.keys`, no `Map` order dependence. Event queue ordering must be a total order with an explicit tiebreak — equal timestamps resolve by a deterministic sequence number, never by insertion luck.

4. **The invariant checker is independent of the implementation.** `lib/invariants` evaluates the five properties from their definitions over global state and imports nothing from `lib/raft` except types. A checker sharing the implementation's assumptions validates its own bugs. This isolation is not negotiable.

5. **Ablation rules are named guards in exactly one place each.** `rules.ts` holds them; each is consulted at a single call site. Never scatter `if (config.electionRestriction)` through the algorithm, and never implement a toggle as a UI-only label.

6. **Every ablation toggle has a test proving it breaks its property.** A toggle that never produces a violation is a bug in the toggle, not a well-behaved option.

7. **Modified Raft is marked as modified, everywhere.** Any run with an ablation flag off is visibly and permanently labelled, in the UI and in shared links. Nobody should screenshot a broken run and take it for real Raft.

8. **Implement Figure 2 literally, and cite it.** Every rule gets a comment naming its figure and rule — `// Figure 2, AppendEntries RPC, receiver rule 2`. This is the highest-value comment style in the repo.

9. **Message loss is the default, not an option.** Raft is designed for a lossy network; a simulator defaulting to a perfect one teaches the wrong intuition.

10. **The simulation is a pure function of `(config, seed, actions, flags)`.** Byte-identical trace on any machine. Never introduce a source of divergence for convenience.

11. **The trace is the only interface between simulation and rendering.** No component computes algorithm state, evaluates an invariant, or decides what happened.

12. **Simulation runs in a worker.** Fuzz runs and long simulations never touch the main thread.

13. **Node state is never colour alone.** Follower, candidate, and leader carry distinct shape or badge as well as colour.

14. **`vermilion` is reserved for safety violations only.** Nothing else in the app is ever red — not errors, not partitions, not crashed nodes. See PRD §10.

15. **A failing fuzz seed becomes a permanent regression test.** Never fix a fuzz failure without first committing the seed as a fixture.

## Working style

- **Read Figure 2 before writing any algorithm code.** Then implement it rule by rule. If a rule seems redundant, it is not — write the comment explaining what it defends and move on.
- **Determinism before algorithm.** M0 exists so the scheduler is proven reproducible before anything depends on it. Do not start M2 until `pnpm test:determinism` passes on the scheduler alone.
- **Invariant checker before ablation.** You cannot demonstrate a violation until you can detect one.
- **When a fuzz run fails, the algorithm is wrong.** Not the checker, not the fuzzer, not the seed. Investigate in that order and only in that order.
- **Never relax an invariant to make a fuzz run pass.** The five properties are the definition of Raft being correct. If one fails under unmodified Raft, something real is broken.
- **Ask before adding to the algorithm surface.** Membership changes and log compaction touch the state machine, the checker, the ledger view, the scenario schema, and every fixture at once.
- **Don't touch `next.config.js`, the Actions workflow, or the fuzz configuration without saying so explicitly.**
- **Don't add dependencies** for simulation, scheduling, randomness, or graph layout.

## Conventions

- Named exports; defaults only where Next requires them.
- Discriminated unions for messages, events, and node states, keyed on `type`. Exhaustive `switch` with a `never` default — this is how a new message type surfaces every handler that must deal with it.
- No `any`. No non-null `!` in `lib/sim` or `lib/raft`.
- Integers only. Terms, indices, node ids, and virtual timestamps are all integers. No floats anywhere in simulation, including in network latency — use integer ticks.
- Log indices are **1-based**, matching the paper. Do not silently switch to 0-based for array convenience; keep the paper's numbering and handle the offset in one documented place.
- Field names match the paper exactly: `currentTerm`, `votedFor`, `commitIndex`, `lastApplied`, `nextIndex`, `matchIndex`, `prevLogIndex`, `prevLogTerm`. A reader should be able to hold the paper beside the code.
- Algorithm terms stay in English in code and UI. Interface copy is Indonesian.
- Scenario ids stable and readable: `split-vote`, `partition-stranded-leader`, `figure-8`, `log-divergence-repair`. They appear in shared URLs.
- Tailwind utilities inline; semantic tokens in `tailwind.config.ts` — `stock`, `ink`, `follower`, `candidate`, `leader`, `committed`, `vermilion`. Never raw hex in components.

## Testing rules

- `pnpm test:run` before every commit; `pnpm test:fuzz` before any commit touching `lib/raft`, `lib/sim`, or `lib/invariants`.
- New algorithm behaviour → a Figure 2 conformance fixture citing the rule it implements.
- New ablation toggle → a test asserting the violation occurs when off and does not occur when on. Both directions.
- New scenario → determinism assertion plus a documented `phenomenon` field.
- Fuzz failure → commit the seed as a fixture before fixing anything.
- Bug fix → failing test first.
- Never update a fixture without reading the diff and confirming the change was intended.

## Deployment

`main` builds and deploys via Actions; the fuzz suite gates it. `basePath` must match the repository name; `.nojekyll` must exist in `out/`. Verify with `pnpm preview` before pushing.

## Framing

RaftScope and the Raft paper are linked prominently and warmly — RaftScope was written by the paper's author and is the canonical visualiser. This project's contribution is ablation and invariant checking, not replacement. State that plainly rather than competing.

## Current state

M0–M6 built. `pnpm test:run` is green: 134 tests, including 49 Figure 2 conformance
fixtures, the panel-by-panel Figure 8 reproduction in both directions, both directions
of all six ablation toggles, and the fuzz suite.

All five safety properties hold across **10,000 randomized runs** under unmodified
Raft. The static export builds and has been verified under the production `basePath`.

Not done, and deliberately so:

- **M7 is untouched.** No membership changes, no log compaction. §4 of the PRD is
  binding, and both would double the state space and every fixture at once.
- **Two ablation scenarios are fuzz-discovered rather than hand-built** —
  `log-matching-break` and `double-candidacy`. Both say so in their `phenomenon`.
  They are correct and reproducible, but they are not curated content: the runs reach
  term 18 and are hard to follow. Hand-built replacements would be an improvement.
- **The exact Figure 8 lives in `tests/figure8`, driven by a director** that replaces
  only the network, and hits the paper's terms 2/3/4/5 precisely. The playable
  `figure-8` scenario reproduces the same shape in the full simulator but takes an
  extra election or two to get there, because the scheduler will not be told who wins.
- **`tests/fuzz/regressions.test.ts` has no entries yet**, because no fuzz failure has
  occurred. It exists so the next one has an obvious home.
