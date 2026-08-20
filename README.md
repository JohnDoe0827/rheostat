# dsh-rheostat (滑动变阻器)

A session style dial for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one position in [0, 1] that slides the model's response style between **0 mode** (terse, quiet, minimal) and **1 mode** (expressive, lively, detailed), with a blend in between.

- The user slides the dial with the `/rheostat [<0..1>]` command (bare `/rheostat` reads it).
- The model slides it with the `rheostat_set` tool and reads it with `rheostat_get`.
- Every request renders a `rheostat:style` prompt section describing the current position and its style instruction.
- The position is durable per-session state (`rheostat/position` session event, last write wins, default 0.5), so resume and fork restore it.

## Install for others

The package is not yet on the npm registry; install it directly from this repository. **Run this outside a pnpm workspace** (npm does not support the `workspace:` protocol):

```sh
mkdir my-dsh-project && cd my-dsh-project
npm init -y
npm install github:JohnDoe0827/rheostat
```

Installation builds the package automatically (`prepare` runs `tsc`). Then mount it in your `cordis.yml`:

```yaml
- name: '@deepseek-ai/dsh-rheostat'
```

It injects `tools` and `systemPrompt`; the `/rheostat` command activates when a `commands` service is composed.

> **Using the DeepSeek Harness monorepo?** The plugin already ships inside [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) at `packages/context/rheostat` (pending upstream merge), mounted in the base bundle — nothing to install. If you are on a pnpm workspace, use `pnpm add github:JohnDoe0827/rheostat` instead of npm.

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

## Same prompt, different positions

One prompt (`你喜欢花生吗` — "Do you like peanuts?"), three dial positions (recorded from a live session):

| Position | Mode | Response |
| --- | --- | --- |
| `0.00` | 0 mode · 极简静默 | 喜欢。 |
| `0.50` | 0 与 1 之间 · 均衡 | 喜欢。花生这东西朴素又实在：脆、香、耐嚼……你呢，平时怎么吃花生比较多？ |
| `1.00` | 1 mode · 饱满热烈 | 哈哈，喜欢！而且不是一般的喜欢——花生在我这儿简直是"食材界的六边形战士"……你更喜欢花生的哪种吃法？油炸、水煮、还是磨成酱抹面包？ |

## Development

```sh
npm install
npm run build   # tsc → lib/
npm test        # vitest: unit + invariant + real-Loader composition + full-loop mock-model
```

## Publishing to npm (maintainers)

Once an npm account with access to the `@deepseek-ai` scope is available:

```sh
npm login
npm publish
```

After publishing, `npm install @deepseek-ai/dsh-rheostat` works anywhere. The upstream merge into `deepseek-ai/deepseek-harness` is tracked in the pull request for `feat/dsh-rheostat`.
