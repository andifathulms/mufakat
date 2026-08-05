# Mufakat

**A Raft consensus simulator where you can break the algorithm on purpose.**

Deterministic discrete-event simulation, continuous safety-invariant checking, and an
ablation mode that turns individual Raft rules off so you can watch the guarantee they
protect actually fail.

> *mufakat* (Indonesian) — consensus, agreement reached through deliberation.

**[andifathulms.github.io/mufakat](https://andifathulms.github.io/mufakat/)** — works
offline after first load.

## Prior art

[**RaftScope**](https://raft.github.io/) exists, it is excellent, and it was written by
Diego Ongaro — the author of the Raft paper. It is the canonical Raft visualiser, and if
you want to watch Raft run, start there. [*The Secret Lives of
Data*](http://thesecretlivesofdata.com/raft/) is a fine scroll-driven explainer.

This project is not a replacement for either. Its contribution is narrower: **ablation and
invariant checking**. RaftScope shows you the mechanism; Mufakat lets you switch a rule off
and watch the safety property it defends break, while five invariant indicators tell you
exactly which one failed and why.

Nor is it a replacement for [the
paper](https://raft.github.io/raft.pdf). It should make you want to read Figure 2.

## Normative source

Ongaro & Ousterhout, *In Search of an Understandable Consensus Algorithm* (USENIX ATC
2014), extended version — **Figure 2** in particular. Every rule in `lib/raft` cites the
figure and rule number it implements.

## Development

```bash
pnpm dev            # development server
pnpm build          # static export to ./out
pnpm preview        # serve ./out under the production basePath

pnpm test:run       # full suite, once
pnpm test:fuzz      # randomized scenarios vs the five safety properties
pnpm test:ablation  # each toggle must break its named property
pnpm test:figure8   # exact reproduction of the paper's Figure 8
pnpm test:figure13  # InstallSnapshot and log compaction (section 7)
pnpm test:determinism
pnpm typecheck
```

`pnpm build` also generates `out/sw.js` from the export it just produced, so the
offline manifest is the build rather than a list that drifts. CI fails if any emitted
file or route is missing from it.

## Architecture

```
config + seed + actions + ablation flags
  → scheduler (virtual clock, event queue)
  → node.step (pure)  →  outbox, timers
  → network model     →  scheduled deliveries
  → EventTrace
        → cluster view | log ledger | invariant panel | timeline
```

- `lib/sim` — virtual clock, seeded PRNG, network model, trace. Pure.
- `lib/raft` — the algorithm. Pure. Figure 2 literally, plus §7 log compaction and
  Figure 13's InstallSnapshot. Compaction is off unless a scenario asks for it.
- `lib/invariants` — the five safety properties, evaluated from their definitions.
  Independent of `lib/raft`; imports only types. A checker sharing the implementation's
  assumptions would validate its own bugs.

See [`CLAUDE.md`](CLAUDE.md) for working rules and [`PRD.md`](PRD.md) for scope.

## Licence

MIT.
