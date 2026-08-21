# dsh-rheostat (滑动变阻器)

English | [中文](README.zh.md)

A session style dial for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one position in [0, 1] that slides the model's response style between **0 mode** (terse, quiet, minimal) and **1 mode** (expressive, lively, detailed), with a blend in between.

- The user slides the dial with the `/rheostat [<0..1>]` command (bare `/rheostat` reads it).
- The model slides it with the `rheostat_set` tool and reads it with `rheostat_get`.
- Every request renders a `rheostat:style` prompt section describing the current position and its style instruction.
- The position is durable per-session state (`rheostat/position` session event, last write wins, default 0.5), so resume and fork restore it.

## Install for others

The package is published to the npm registry:

```sh
npm install @johndoe0827/dsh-rheostat
```

**Run this outside a pnpm workspace** (npm does not support the `workspace:` protocol). Then mount it in your `cordis.yml`:

```yaml
- name: '@deepseek-ai/dsh-rheostat'
```

It injects `tools` and `systemPrompt`; the `/rheostat` command activates when a `commands` service is composed.

> **Using the DeepSeek Harness monorepo?** The plugin already ships inside [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) at `packages/context/rheostat` (pending upstream merge), mounted in the base bundle — nothing to install. If you are on a pnpm workspace, use `pnpm add github:JohnDoe0827/rheostat` instead of npm.

## Usage

| Control | Effect |
| --- | --- |
| `/rheostat` | read the current state |
| `/rheostat off` | turn the dial off (no style instructions) |
| `/rheostat on` | turn it back on at the last position |
| `/rheostat 0` | switch to 0 mode (terse, quiet) |
| `/rheostat 1` | switch to 1 mode (expressive, lively) |
| `/rheostat 0.7` | blend, leaning expressive |
| `rheostat_set(position)` | model slides the dial (0..1) — auto-enables |
| `rheostat_get()` | model reads the state programmatically |

Sliding the dial (command or tool) always turns it on; `/rheostat off` turns it off until the next slide.

Mode bands: position ≤ 0.25 renders 0 mode · Terse & Quiet; position ≥ 0.75 renders 1 mode · Expressive & Lively; in between renders Balanced (between 0 and 1).

## Same prompt, different positions

One prompt (`你喜欢花生吗` — "Do you like peanuts?"), three dial positions (recorded from a live session). Full responses:

| Position | Mode | Response (translated) |
| --- | --- | --- |
| `0.00` | 0 mode · Terse & Quiet | Yes. |
| `0.50` | Balanced (between 0 and 1) | Yes. Peanuts are plain and solid: crisp, fragrant, chewy — raw ones are crunchy, boiled ones soft, fried ones flaky, each way has its own charm. Salted fried peanuts go with beer, peanut-and-trotter soup for slow-cooking, and peanut butter for spreading on bread. Xu Dishan's essay *The Peanut* puts it well too — dug out of the earth dusty and plain, yet genuinely good and dependable.<br><br>As for the downsides: fried ones are easy to overeat, and allergy sufferers can't touch them; other than that, no complaints. How do you usually eat peanuts? |
| `1.00` | 1 mode · Expressive & Lively | Haha, I love them! And not just a little — for me, the peanut is basically the "hexagonal all-rounder of the food world," and it deserves a proper shout-out! 🥜<br><br>**Texture first**: raw peanuts are crunchy, boiled ones soft, fried ones flaky, roasted ones fragrant. One tiny bean (strictly speaking, the seed of a legume) can pull off four completely different textures — isn't that amazing?<br><br>**Then flavor**: that nutty oil aroma with a hint of sweetness — the kind of fragrance that keeps you reaching for more. Whether it's the late-night street-stall plate of salted fried peanuts, perfect with beer; the vinegar-soaked peanuts Sichuan diners snack on before hotpot, tangy and appetite-whetting; the rich old-Beijing millet porridge (面茶) topped with crushed peanuts; or the peanut-and-trotter soup southerners slow-cook until it melts in the mouth.<br><br>**And the sentimental bonus**: even Lu Xun wrote about the "falling peanut" — Xu Dishan's school essay *The Peanut* is etched into generations of DNA: "A person should be useful, not merely respectable." A peanut, dug out of the earth dusty and plain, is the real deal — so much character!<br><br>**Even its bad reputation is endearing**: people say peanuts make you fat — please, that's on the frying oil and sugar coating; plain peanuts are a source of good fats and protein, and gym-goers eat peanut butter on purpose. The only real pity is that allergy sufferers have to keep away — and we should respect that, gently.<br><br>So the verdict: **yes, I love them**. On a rainy evening, a plate of freshly roasted peanuts and a pot of hot tea on the table — the night is already half won. 🌰✨<br><br>What about you? Which way do you like your peanuts — fried, boiled, or ground into butter for bread? |

## Development

```sh
npm install
npm run build   # tsc → lib/
npm test        # vitest: unit + invariant + real-Loader composition + full-loop mock-model
```

