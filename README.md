# @deepseek-ai/dsh-rheostat

English | [中文](README.zh.md)

The style dial (滑动变阻器): one per-session position in [0, 1] that slides the model's response style between 0 mode (terse, quiet) and 1 mode (expressive, lively).

## What it does

The dial is a number in [0, 1], defaulting to the neutral middle 0.5. Every request assembly renders a `rheostat:style` prompt section describing the current position and the style instruction for its mode band:

- positions ≤ 0.25 — 0 mode · Terse & Quiet: answers are terse, conclusion-first, no filler.
- positions ≥ 0.75 — 1 mode · Expressive & Lively: answers are full, detailed, expressive.
- in between — Balanced (between 0 and 1): a blend, leaning terse near 0 and expressive near 1.

The position is logged as a `rheostat/position` session event (whole-value replace, last write wins), so resume and fork restore it without a live mirror. Anyone can slide it:

- the model calls `rheostat_set(position)` and reads `rheostat_get()` (the prompt section already states the position, so the get tool exists for programmatic consumers);
- the user runs the `/rheostat [<0..1>]` command (bare `/rheostat` reads the position).

## Same prompt, different positions

One prompt (`你喜欢花生吗` — "Do you like peanuts?"), three dial positions (recorded from a live session). Full responses (translated):

| Position | Mode | Response |
| --- | --- | --- |
| `0.00` | 0 mode · Terse & Quiet | Yes. |
| `0.50` | Balanced (between 0 and 1) | Yes. Peanuts are plain and solid: crisp, fragrant, chewy — raw ones are crunchy, boiled ones soft, fried ones flaky, each way has its own charm. Salted fried peanuts go with beer, peanut-and-trotter soup for slow-cooking, and peanut butter for spreading on bread. Xu Dishan's essay *The Peanut* puts it well too — dug out of the earth dusty and plain, yet genuinely good and dependable.<br><br>As for the downsides: fried ones are easy to overeat, and allergy sufferers can't touch them; other than that, no complaints. How do you usually eat peanuts? |
| `1.00` | 1 mode · Expressive & Lively | Haha, I love them! And not just a little — for me, the peanut is basically the "hexagonal all-rounder of the food world," and it deserves a proper shout-out! 🥜<br><br>**Texture first**: raw peanuts are crunchy, boiled ones soft, fried ones flaky, roasted ones fragrant. One tiny bean (strictly speaking, the seed of a legume) can pull off four completely different textures — isn't that amazing?<br><br>**Then flavor**: that nutty oil aroma with a hint of sweetness — the kind of fragrance that keeps you reaching for more. Whether it's the late-night street-stall plate of salted fried peanuts, perfect with beer; the vinegar-soaked peanuts Sichuan diners snack on before hotpot, tangy and appetite-whetting; the rich old-Beijing millet porridge (面茶) topped with crushed peanuts; or the peanut-and-trotter soup southerners slow-cook until it melts in the mouth.<br><br>**And the sentimental bonus**: even Lu Xun wrote about the "falling peanut" — Xu Dishan's school essay *The Peanut* is etched into generations of DNA: "A person should be useful, not merely respectable." A peanut, dug out of the earth dusty and plain, is the real deal — so much character!<br><br>**Even its bad reputation is endearing**: people say peanuts make you fat — please, that's on the frying oil and sugar coating; plain peanuts are a source of good fats and protein, and gym-goers eat peanut butter on purpose. The only real pity is that allergy sufferers have to keep away — and we should respect that, gently.<br><br>So the verdict: **yes, I love them**. On a rainy evening, a plate of freshly roasted peanuts and a pot of hot tea on the table — the night is already half won. 🌰✨<br><br>What about you? Which way do you like your peanuts — fried, boiled, or ground into butter for bread? |

## The sliding boundary

A model slide appends the `rheostat/position` event directly during tool execution. A user's `/rheostat` selection made between turns also appends immediately and injects a short notice; a selection made during an open turn stays pending until the next accepted in-turn pre-step, which commits it durably and narrates the change into that request — the same boundary plan-mode uses, because `Session.append` from an arbitrary command handler during an open turn is not a supported publication point. The pending selection is visible to the very next prompt assembly (the section reads it before the durable commit), so the style switch is not delayed by the boundary.

## Configuration

None. The default position (0.5) and the style text are product definitions, not deployment choices.

## The prompt section

`rheostat:style` registers at order 40 — after the deployment persona (0) and before plan-mode guidance (50), so plan-mode rules can still override the dial when a plan is under review. The section is empty when an assembly has no agent.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Prompt section

#### What the model sees

One section in every request that carries an agent, rendered from the folded (or pending) position in the conversation's language: `detectLanguage` classifies the most recent user-authored message (CJK-dominant → Chinese, Latin-dominant → English), defaulting to Chinese before any user message exists. The verbatim band bodies live in [src/index.ts](src/index.ts) (`styleText`): the terse 0 band, the balanced middle band, and the expressive 1 band each replace the `{position}` and `{mode label}` placeholders in the template below and append their own guidance sentence.

##### Verbatim template (Chinese)

```markdown
滑动变阻器（style dial）位于 {position}，处于 {mode label}。
{band guidance}
用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。
```

##### Verbatim template (English)

```markdown
The style dial (滑动变阻器) is at {position} — {mode label}.
{band guidance}
The user can slide it with /rheostat <0..1>, and you can call the rheostat_set tool.
```

##### Rendered example at position 0.00

```markdown
滑动变阻器（style dial）位于 0.00，处于 0 模式 · 极简静默。 调整回答风格：只给结论，不给铺垫；能用一句话绝不用两句；删掉寒暄、修饰与重复；列表尽量短。 像 0 一样安静、克制、留白。用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。
```

##### Rendered English example at position 1.00

```markdown
The style dial (滑动变阻器) is at 1.00 — 1 mode · Expressive & Lively. Adjust your response style: expand freely; add background, detail, and examples unprompted; be warm and present; enthusiasm, emphasis, and rhythm are welcome; light up every thought and never go missing. Be as bright, loud, and rich as 1. The user can slide it with /rheostat <0..1>, and you can call the rheostat_set tool.
```

#### Token effect

Fixed small cost on every request where an agent is present (one section of ~120 characters); the position value changes the interpolated number, not the structure.

#### KV Cache effect

Prefix-stable while the section registration and position are unchanged. A slide appends a new `rheostat/position` event, which changes the section's interpolated text and invalidates reuse from the point the new position first renders. Between slides the section is byte-identical across requests and does not invalidate reuse.

### Tool schema

#### What the model sees

The generated [`rheostat_set` and `rheostat_get` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-rheostat).

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

`rheostat_set` returns exactly `{ position, mode }` with `mode` one of `terse` / `balanced` / `expressive`, rendered as `Style dial slid to <position> — <mode label>.`; `rheostat_get` returns the same value rendered as `Style dial at <position> — <mode label>.` Stable failures are `Error: rheostat_set requires an owning agent session`, `Error: rheostat_get requires an owning agent session`, and `Error: rheostat position must be between 0 and 1, got <n>` (or `Error: rheostat position must be a finite number, got <value>`). A `/rheostat` slide also appends a `user/message` notice (`The user slid the style dial (滑动变阻器) to <position> (<mode label>).`), which the next request sees as plugin-sourced context.

#### Token effect

Growth is fixed-shape per call and independent of dial history; the `rheostat/position` event itself is UI/replay state, not a second model message.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Per-session scope only** — the dial belongs to the one agent session that set it; there is no shared/global dial across sessions, and a non-agent caller is rejected.
- **Style is guidance, not enforcement** — the section instructs the model's style; the model may still deviate, and there is no post-processing to force terse or verbose output.
- **Discrete mode bands, continuous position** — the mode label switches at 0.25/0.75 while the position stays continuous; a finer-grained interpolation of the guidance itself is deferred.
