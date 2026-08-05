<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/lockup-dark.png">
  <img src=".github/assets/lockup-light.png" alt="Raft Simulator" width="520">
</picture>

**A Raft consensus simulator where you can break the algorithm on purpose.**

[![Deploy](https://github.com/andifathulms/raft-simulator/actions/workflows/deploy.yml/badge.svg)](https://github.com/andifathulms/raft-simulator/actions/workflows/deploy.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-3E6B4C)](LICENSE)
[![No dependencies](https://img.shields.io/badge/sim%20dependencies-none-4B5750)](#architecture)

### [→ Open the simulator](https://andifathulms.github.io/raft-simulator/)

Works offline after first load · English and Indonesian

</div>

---

Deterministic discrete-event simulation, continuous safety-invariant checking, and an
ablation mode that turns individual Raft rules off so you can watch the guarantee they
protect actually fail.

## The idea

Every non-obvious rule in Raft defends one specific safety property. Reading the rule
tells you what it does; it does not tell you why it is there. The fastest route to
that is to remove the rule and watch the property break.

So each rule is a switch. Turn one off and the run is permanently labelled **modified
Raft** — in the UI and in any link you share — because nobody should screenshot a
broken run and mistake it for the real algorithm.

**Each of these links opens the live simulator with that rule already switched off and
the scenario that breaks without it already loaded:**

| Rule | Defends | Paper | Watch it break |
|---|---|---|---|
| Election restriction | Leader Completeness | §5.4.1 | [election-restriction-overwrite](https://andifathulms.github.io/raft-simulator/en/simulasi/#s=election-restriction-overwrite&off=er) |
| Current-term commit rule | State Machine Safety | §5.4.2 | [figure-8](https://andifathulms.github.io/raft-simulator/en/simulasi/#s=figure-8&off=ct) |
| AppendEntries consistency check | Log Matching | §5.3 | [log-matching-break](https://andifathulms.github.io/raft-simulator/en/simulasi/#s=log-matching-break&off=ae) |
| Term increment on candidacy | Election Safety | §5.2 | [double-candidacy](https://andifathulms.github.io/raft-simulator/en/simulasi/#s=double-candidacy&off=ti) |
| Step down on higher term | Election Safety | §5.1 | [partition-stranded-leader](https://andifathulms.github.io/raft-simulator/en/simulasi/#s=partition-stranded-leader&off=sd) |
| Persistent `votedFor` | Election Safety | §5.2 | [double-vote-restart](https://andifathulms.github.io/raft-simulator/en/simulasi/#s=double-vote-restart&off=pv) |
| Joint consensus | Election Safety | §6 | [membership-change](https://andifathulms.github.io/raft-simulator/en/simulasi/#s=membership-change&off=jc) |

Every switch has a test proving the violation actually occurs with the rule off, and
does not occur with it on. A toggle that never breaks anything is a bug in the toggle.

## The five safety properties

Evaluated after every single event, across all nodes, by a checker in `lib/invariants`
that shares no code with the implementation — one that reused the algorithm's
assumptions would validate its own bugs.

| Property | Statement |
|---|---|
| **Election Safety** | At most one leader per term |
| **Leader Append-Only** | A leader never overwrites or deletes entries in its own log |
| **Log Matching** | If two logs hold an entry with the same index and term, the logs are identical through that index |
| **Leader Completeness** | An entry committed in a term is present in the log of every leader of every later term |
| **State Machine Safety** | If a node applies an entry at an index, no node ever applies a different entry at that index |

In normal operation all five stay green, which is itself informative: it shows the
algorithm holding under an adversarial network.

## Prior art

[**RaftScope**](https://raft.github.io/) exists, it is excellent, and it was written by
Diego Ongaro — the author of the Raft paper. It is the canonical Raft visualiser, and if
you want to watch Raft run, start there. [*The Secret Lives of
Data*](http://thesecretlivesofdata.com/raft/) is a fine scroll-driven explainer.

This project is not a replacement for either. Its contribution is narrower: **ablation
and invariant checking**. RaftScope shows you the mechanism; this lets you switch a rule
off and watch the safety property it defends break, while five indicators tell you
exactly which one failed and why.

Nor is it a replacement for [the paper](https://raft.github.io/raft.pdf). It should make
you want to read Figure 2.

## Architecture

```
config + seed + actions + ablation flags
  → scheduler (virtual clock, event queue)
  → node.step (pure)  →  outbox, timers
  → network model     →  scheduled deliveries
  → EventTrace
        → cluster view | log ledger | invariant panel | timeline
```

| Module | Role |
|---|---|
| `lib/sim` | Virtual clock, seeded PRNG, network model, trace. Pure. |
| `lib/raft` | The algorithm. Pure. Figure 2 literally, plus §6 joint consensus and §7 log compaction with Figure 13's InstallSnapshot. |
| `lib/invariants` | The five properties, evaluated from their definitions. Imports only types from `lib/raft`. |

Three things hold the whole design up:

- **The simulation is a pure function of `(config, seed, actions, flags)`.** Same inputs,
  byte-identical trace, any machine. Time travel, sharing and reproducible bug reports
  all rest on that.
- **No wall-clock time anywhere in the simulation.** A virtual clock and a priority
  queue; advancing means popping the next event, not waiting.
- **The trace is the only interface between simulation and rendering.** No component
  computes algorithm state or decides what happened.

No distributed-systems library, no simulation framework, no state-management library.
The scheduler and the state machine are the project.

## Testing

Correctness gates everything here, because this teaches — and a subtly wrong Raft
teaches wrong Raft, confidently and with good animations.

| Suite | Tests | What it holds down |
|---|---:|---|
| `tests/figure2` | 49 | Per-rule conformance, each fixture citing its figure and rule |
| `tests/ablation` | 35 | Every toggle breaks its property, and only with the rule off |
| `tests/figure13` | 23 | InstallSnapshot and log compaction, §7 |
| `tests/section6` | 16 | Joint consensus and membership changes |
| `tests/determinism` | 38 | Byte-identical trace replay, scheduler, network, share links |
| `tests/fuzz` | 14 | Five safety properties vs. randomized adversarial runs |
| `tests/figure8` | 5 | The paper's Figure 8, panel by panel |

**Invariant fuzzing is the backbone** and gates the deploy: 2,000 randomized runs on
every push — random partitions, drops, reorderings, crashes and restarts at random
moments — asserting all five properties at every event of every run. Raise it with
`FUZZ_RUNS=10000 pnpm test:fuzz`.

A failing fuzz seed becomes a permanent fixture in `tests/fuzz/regressions.test.ts`
before anything is fixed.

## Development

```bash
pnpm dev            # development server
pnpm build          # static export to ./out, then generate the service worker
pnpm preview        # serve ./out under the production basePath
pnpm test:run       # full suite, once
pnpm typecheck
```

<details>
<summary>Targeted test suites</summary>

```bash
pnpm test:fuzz         # randomized scenarios vs the five safety properties
pnpm test:ablation     # each toggle must break its named property
pnpm test:figure2      # per-rule conformance fixtures
pnpm test:figure8      # exact reproduction of the paper's Figure 8
pnpm test:figure13     # InstallSnapshot and log compaction (§7)
pnpm test:section6     # joint consensus and membership changes (§6)
pnpm test:determinism  # byte-identical trace replay
```

</details>

`pnpm build` generates `out/sw.js` from the export it just produced, so the offline
manifest *is* the build rather than a list that drifts. CI fails if any emitted file or
route is missing from it.

## Normative source

Ongaro & Ousterhout, [*In Search of an Understandable Consensus
Algorithm*](https://raft.github.io/raft.pdf) (USENIX ATC 2014), extended version —
**Figure 2** in particular. Every rule in `lib/raft` cites the figure and rule number it
implements, so you can read the code with the paper open beside it.

See [`CLAUDE.md`](CLAUDE.md) for working rules and [`PRD.md`](PRD.md) for scope.

## Licence

[MIT](LICENSE). Built by [Andi Fathul Mukminin](https://andifathulms.github.io/en/).
