# dsh-rheostat (滑动变阻器)

A session style dial for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one position in [0, 1] that slides the model's response style between **0 mode** (terse, quiet, minimal) and **1 mode** (expressive, lively, detailed), with a blend in between.

- The user slides the dial with the `/rheostat [<0..1>]` command (bare `/rheostat` reads it).
- The model slides it with the `rheostat_set` tool and reads it with `rheostat_get`.
- Every request renders a `rheostat:style` prompt section describing the current position and its style instruction.
- The position is durable per-session state (`rheostat/position` session event, last write wins, default 0.5), so resume and fork restore it.

## Install

```sh
npm install @deepseek-ai/dsh-rheostat
```

Mount it in your `cordis.yml`:

```yaml
- name: '@deepseek-ai/dsh-rheostat'
```

It injects `tools` and `systemPrompt`; the `/rheostat` command activates when a `commands` service is composed.

## Usage

| Control | Effect |
| --- | --- |
| `/rheostat` | read the current position |
| `/rheostat 0` | switch to 0 mode (terse, quiet) |
| `/rheostat 1` | switch to 1 mode (expressive, lively) |
| `/rheostat 0.7` | blend, leaning expressive |
| `rheostat_set(position)` | model slides the dial (0..1) |
| `rheostat_get()` | model reads the dial programmatically |

Mode bands: position ≤ 0.25 renders 0 mode · 极简静默; position ≥ 0.75 renders 1 mode · 饱满热烈; in between renders 0 与 1 之间 · 均衡.

## Development

```sh
npm install
npm run build   # tsc → lib/
npm test        # vitest: unit + invariant + real-Loader composition + full-loop mock-model
```

## Publish to npm

Requires an npm account with access to the `@deepseek-ai` scope (or republish under your own scope):

```sh
npm login
npm publish
```

## Part of the DeepSeek Harness monorepo

This package ships inside [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) at `packages/context/rheostat`, mounted in the base bundle by default. This repository is a standalone mirror for direct use and contribution.
