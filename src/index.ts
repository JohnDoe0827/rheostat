/**
 * The style dial (滑动变阻器): one per-session position in [0, 1] that slides
 * the model's response style between 0 mode (terse, quiet) and 1 mode
 * (expressive, lively). The position is logged as `rheostat/position`
 * (last write wins, default 0.5) so resume and fork restore it; the folded
 * value renders a `rheostat:style` prompt section at every request assembly.
 * The model slides the dial through `rheostat_set` (and reads it through
 * `rheostat_get`); the user slides it with the `/rheostat <0..1>` command.
 * A user's in-turn selection stays pending until the next accepted in-turn
 * pre-step, which commits it and narrates the change — the same boundary the
 * plan-mode plugin uses, because `Session.append` from an arbitrary command
 * handler during an open turn is not a supported publication point.
 *
 * @module @deepseek-ai/dsh-rheostat
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The style-dial position in force from this point on: log-only,
     * non-surface, whole-value replace. The last `rheostat/position` wins; a
     * log with none folds to {@link DEFAULT_POSITION}.
     */
    'rheostat/position': { position: number }
    /**
     * Whether the style dial is on from this point on: log-only,
     * non-surface, whole-value replace. The last `rheostat/active` wins; a
     * log with none folds to {@link DEFAULT_ACTIVE}. The dial is on by
     * default; `/rheostat off` turns it off, and sliding the dial turns it
     * back on.
     */
    'rheostat/active': { active: boolean }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'rheostat'

/** Services the plugin registers on. */
export const inject = ['tools', 'systemPrompt']

/** The dial's neutral middle position used before any `rheostat/position` event. */
export const DEFAULT_POSITION = 0.5

/** The dial's default state: on. `/rheostat off` turns it off until the next slide. */
export const DEFAULT_ACTIVE = true

/** The dial's complete per-session state: whether it is on, plus its position. */
export interface DialState {
  active: boolean
  position: number
}

/** Classify a user-initiated change from the current to the target state. */
function describeChange(current: DialState, target: DialState): DialChange {
  if (target.active !== current.active) {
    return target.active ? { kind: 'on', position: target.position } : { kind: 'off' }
  }
  // Same active state: an explicit /rheostat off on an off dial stays an off
  // change (so the no-op reads "already off"), anything else on an on dial is
  // a slide, and /rheostat on on an on dial degrades to a no-op slide.
  return target.active ? { kind: 'slide', position: target.position } : { kind: 'off' }
}

/** Whether a classified change actually alters the current state. */
function changeHappens(current: DialState, change: DialChange): boolean {
  switch (change.kind) {
    case 'off':
      return current.active
    case 'on':
      return !current.active || change.position !== current.position
    case 'slide':
      return change.position !== current.position
  }
}

/** Positions at or below this value render the terse 0 mode. */
export const TERSE_THRESHOLD = 0.25

/** Positions at or above this value render the expressive 1 mode. */
export const EXPRESSIVE_THRESHOLD = 0.75

/** The model-facing name of the slide tool. */
export const RHEOSTAT_SET = 'rheostat_set'

/** The model-facing name of the read tool. */
export const RHEOSTAT_GET = 'rheostat_get'

/** Prompt section name; order 40 renders after the persona (0) and before plan policy (50). */
export const SECTION_NAME = 'rheostat:style'

/** Prompt section order: after the deployment persona, before plan-mode guidance. */
export const SECTION_ORDER = 40

/** The plugin's stable name used in `user/message` source attribution. */
const PLUGIN = 'rheostat'

/**
 * Whether the log holds an opened turn without its closing `turn/end`.
 * An open turn means a command selection must wait for the next accepted
 * in-turn pre-step instead of appending directly.
 * @param events - the session log or any prefix of it.
 * @returns whether a turn is currently open.
 */
export function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

/**
 * Whether the dial is at the terse 0 mode, the expressive 1 mode, or balanced.
 * @param position - a validated dial position in [0, 1].
 * @returns the stable machine-readable mode name.
 */
export function modeOf(position: number): 'terse' | 'balanced' | 'expressive' {
  if (position <= TERSE_THRESHOLD) return 'terse'
  if (position >= EXPRESSIVE_THRESHOLD) return 'expressive'
  return 'balanced'
}

/**
 * The human-readable mode label used in results and command output.
 * @param position - a validated dial position in [0, 1].
 * @returns the labeled mode name.
 */
export function modeLabel(position: number): string {
  if (position <= TERSE_THRESHOLD) return '0 模式 · 极简静默'
  if (position >= EXPRESSIVE_THRESHOLD) return '1 模式 · 饱满热烈'
  return '0 与 1 之间 · 均衡'
}

/**
 * Validate a dial position. Rejects non-finite values and out-of-range values
 * loud so a bad model argument or bad `/rheostat` input never silently clamps.
 * @param value - the raw position.
 * @returns the validated position.
 * @throws TypeError for non-finite values; RangeError for values outside [0, 1].
 */
export function validatePosition(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`rheostat position must be a finite number, got ${String(value)}`)
  }
  if (value < 0 || value > 1) {
    throw new RangeError(`rheostat position must be between 0 and 1, got ${value}`)
  }
  return value
}

/**
 * Parse a `/rheostat` argument into a validated position.
 * @param input - the trimmed raw command input.
 * @returns the validated position.
 * @throws TypeError or RangeError from {@link validatePosition} on invalid input.
 */
export function parsePosition(input: string): number {
  return validatePosition(Number(input))
}

/**
 * The dial position in force after `events[0, end)`. The last
 * `rheostat/position` wins; a prefix with none folds to {@link DEFAULT_POSITION}.
 * @param events - the session log or any prefix of it.
 * @param end - fold `events[0, end)`; defaults to the whole log.
 * @returns the folded position.
 */
export function foldPosition(events: readonly SessionEvent[], end = events.length): number {
  let position = DEFAULT_POSITION
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'rheostat/position') position = event.data.position
  }
  return position
}

/**
 * Whether the dial is on after `events[0, end)`. The last `rheostat/active`
 * wins; a prefix with none is on ({@link DEFAULT_ACTIVE}).
 * @param events - the session log or any prefix of it.
 * @param end - fold `events[0, end)`; defaults to the whole log.
 * @returns whether the dial is active.
 */
export function foldActive(events: readonly SessionEvent[], end = events.length): boolean {
  let active = DEFAULT_ACTIVE
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'rheostat/active') active = event.data.active
  }
  return active
}

/**
 * The model-visible style section language: `zh` follows the product's
 * Chinese mode names, `en` renders English guidance and mode names.
 */
export type StyleLanguage = 'zh' | 'en'

/** One mode band's label and guidance in both section languages. */
interface BandText {
  readonly zh: { label: string; guidance: string }
  readonly en: { label: string; guidance: string }
}

const BANDS: Readonly<Record<'terse' | 'balanced' | 'expressive', BandText>> = {
  terse: {
    zh: {
      label: '0 模式 · 极简静默',
      guidance: '调整回答风格：只给结论，不给铺垫；能用一句话绝不用两句；删掉寒暄、修饰与重复；列表尽量短。像 0 一样安静、克制、留白。',
    },
    en: {
      label: '0 mode · Terse & Quiet',
      guidance: 'Adjust your response style: give conclusions only, no buildup; one sentence where two would do; drop pleasantries, ornament, and repetition; keep lists as short as possible. Be as quiet, restrained, and reserved as 0.',
    },
  },
  balanced: {
    zh: {
      label: '0 与 1 之间 · 均衡',
      guidance: '调整回答风格：按比例混合两种模式，靠近 0 则简洁克制，靠近 1 则饱满热烈；当前以均衡为主，视内容需要微调。',
    },
    en: {
      label: 'Balanced (between 0 and 1)',
      guidance: 'Adjust your response style by blending the two modes proportionally: lean terse near 0 and expressive near 1; right now you are balanced — fine-tune as the content requires.',
    },
  },
  expressive: {
    zh: {
      label: '1 模式 · 饱满热烈',
      guidance: '调整回答风格：尽情展开；主动补充背景、细节和例子；表达有温度、有存在感；可以热情、夸张、有节奏；把每个想法点亮，绝不缺席。像 1 一样明亮、响亮、内容丰富。',
    },
    en: {
      label: '1 mode · Expressive & Lively',
      guidance: 'Adjust your response style: expand freely; add background, detail, and examples unprompted; be warm and present; enthusiasm, emphasis, and rhythm are welcome; light up every thought and never go missing. Be as bright, loud, and rich as 1.',
    },
  },
}

/** The closing sentence telling how the dial can be moved, per language. */
function dialTail(language: StyleLanguage): string {
  return language === 'zh'
    ? '用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。'
    : 'The user can slide it with /rheostat <0..1>, and you can call the rheostat_set tool.'
}

/**
 * The model-visible style section for one position: the dial reading plus the
 * style instruction for the current mode band, in the conversation's language.
 * @param position - a validated dial position in [0, 1].
 * @param language - section language; defaults to `zh`.
 * @returns the section text rendered at each assembly.
 */
export function styleText(position: number, language: StyleLanguage = 'zh'): string {
  const rounded = position.toFixed(2)
  const band = position <= TERSE_THRESHOLD
    ? BANDS.terse
    : position >= EXPRESSIVE_THRESHOLD
      ? BANDS.expressive
      : BANDS.balanced
  const text = band[language]
  const head = language === 'zh'
    ? `滑动变阻器（style dial）位于 ${rounded}，处于 ${text.label}。`
    : `The style dial (滑动变阻器) is at ${rounded} — ${text.label}.`
  return `${head} ${text.guidance} ${dialTail(language)}`
}

/**
 * Detect the conversation language from recent user-authored messages.
 * Scans backwards until roughly 40 letters or CJK characters accumulate;
 * a CJK share of 30% or more classifies as `zh`, otherwise `en`. Sessions
 * with no user-authored message yet (the first turn's assembly runs before
 * the current message is logged) fall back to `zh`.
 * @param events - the session log.
 * @returns the detected section language.
 */
export function detectLanguage(events: readonly SessionEvent[]): StyleLanguage {
  for (const event of [...events].reverse()) {
    if (event.type !== 'user/message') continue
    if (event.data.source.kind !== 'user') continue
    const text = event.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
    const latin = (text.match(/[A-Za-z]/g) ?? []).length
    if (cjk === 0 && latin === 0) continue
    return cjk >= latin / 2 ? 'zh' : 'en'
  }
  return 'zh'
}

/** One user-initiated dial change, narrated into the next request. */
type DialChange =
  | { kind: 'off' }
  | { kind: 'on'; position: number }
  | { kind: 'slide'; position: number }

/** The mode band's label in one section language. */
function bandLabel(position: number, language: StyleLanguage): string {
  const band = position <= TERSE_THRESHOLD
    ? BANDS.terse
    : position >= EXPRESSIVE_THRESHOLD
      ? BANDS.expressive
      : BANDS.balanced
  return band[language].label
}

/** The user-change notice appended to the next request after a `/rheostat` change. */
function narration(change: DialChange, language: StyleLanguage): UserMessage {
  const zh = language === 'zh'
  const text = change.kind === 'off'
    ? zh
      ? '用户关闭了风格变阻器（滑动变阻器）。'
      : 'The user turned the style dial (滑动变阻器) off.'
    : change.kind === 'on'
      ? zh
        ? `用户开启了风格变阻器（滑动变阻器），位置 ${change.position.toFixed(2)}（${bandLabel(change.position, language)}）。`
        : `The user turned the style dial (滑动变阻器) on at ${change.position.toFixed(2)} (${bandLabel(change.position, language)}).`
      : zh
        ? `用户把风格变阻器（滑动变阻器）滑动到了 ${change.position.toFixed(2)}（${bandLabel(change.position, language)}）。`
        : `The user slid the style dial (滑动变阻器) to ${change.position.toFixed(2)} (${bandLabel(change.position, language)}).`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN, form: 'notice', summary: text },
  })
}

/**
 * Register the style dial: the pending-selection boundary, the prompt section,
 * the `/rheostat` command child, and the two model-facing tools.
 * @param ctx - registrant context carrying the tool registry and prompt assembly.
 */
export function apply(ctx: Context): void {
  // A user's /rheostat change made during an open turn, awaiting the next
  // accepted in-turn pre-step. The section reads it so the next assembly
  // already renders the new style; the pre-step commits it durably.
  const pending = new WeakMap<Session, DialState>()

  /** The position in force: a pending change, else the folded log. */
  function positionIn(agent: Agent): number {
    return pending.get(agent.session)?.position ?? foldPosition(agent.session.events)
  }

  /** Whether the dial is on: a pending change, else the folded log. */
  function activeIn(agent: Agent): boolean {
    return pending.get(agent.session)?.active ?? foldActive(agent.session.events)
  }

  /** The full dial state in force, considering any pending change. */
  function stateIn(agent: Agent): DialState {
    const pendingState = pending.get(agent.session)
    return pendingState ?? {
      active: foldActive(agent.session.events),
      position: foldPosition(agent.session.events),
    }
  }

  /** Append the pending changes that differ from the log, then clear. */
  function commitPending(session: Session, target: DialState): void {
    const activeChanged = target.active !== foldActive(session.events)
    const positionChanged = target.position !== foldPosition(session.events)
    if (!activeChanged && !positionChanged) {
      pending.delete(session)
      return
    }
    if (activeChanged) session.append('rheostat/active', { active: target.active })
    if (positionChanged) session.append('rheostat/position', { position: target.position })
    // Delete only after appends succeed so a later accepted in-turn pre-step
    // can retry a failed durable write.
    pending.delete(session)
  }

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    const target = pending.get(agent.session)
    if (decision.kind === 'reject' || signal.aborted || target === undefined) return decision
    // Compare against the durable log, not stateIn: the pending selection is
    // not yet committed and must not mask the change it represents.
    const current: DialState = {
      active: foldActive(agent.session.events),
      position: foldPosition(agent.session.events),
    }
    const change = describeChange(current, target)
    const changed = changeHappens(current, change)
    try {
      commitPending(agent.session, target)
    } catch (error) {
      ctx.logger.warn('dsh-rheostat: failed to append selected state at step start: %o', error)
      return decision
    }
    return changed
      ? { ...decision, messages: [...decision.messages, narration(change, detectLanguage(agent.session.events))] }
      : decision
  })

  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (context) => {
      if (context.agent === undefined) return ''
      if (!activeIn(context.agent)) return ''
      return styleText(positionIn(context.agent), detectLanguage(context.agent.session.events))
    },
  })

  // The command child activates only when a command registry is composed.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'rheostat',
      description: 'Turn the style dial (滑动变阻器) off/on or slide it between 0 (terse) and 1 (expressive)',
      input: { hint: '[off|on|<0..1>]' },
      handler: ({ agent, rawInput }) => {
        const input = rawInput.trim().toLowerCase()
        if (input === '') {
          const state = stateIn(agent)
          if (!state.active) {
            return {
              kind: 'success',
              text: 'Style dial (滑动变阻器) is off. Use /rheostat <0..1> or /rheostat on to turn it on.',
            }
          }
          return {
            kind: 'success',
            text: `Style dial (滑动变阻器) at ${state.position.toFixed(2)} — ${modeLabel(state.position)}. Use /rheostat <0..1> to slide it, /rheostat off to turn it off.`,
          }
        }
        let target: DialState
        if (input === 'off') {
          target = { active: false, position: positionIn(agent) }
        } else if (input === 'on') {
          target = { active: true, position: positionIn(agent) }
        } else {
          let position: number
          try {
            position = parsePosition(input)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return { kind: 'error', text: `Invalid dial position: ${message}` }
          }
          target = { active: true, position }
        }
        const current = stateIn(agent)
        const change = describeChange(current, target)
        if (!changeHappens(current, change)) {
          if (change.kind === 'off') {
            return { kind: 'success', text: 'Style dial is already off.' }
          }
          if (change.kind === 'on') {
            return {
              kind: 'success',
              text: `Style dial is already on at ${current.position.toFixed(2)} — ${modeLabel(current.position)}.`,
            }
          }
          return {
            kind: 'success',
            text: `Style dial is already at ${current.position.toFixed(2)} — ${modeLabel(current.position)}.`,
          }
        }
        if (hasOpenTurn(agent.session.events)) {
          pending.set(agent.session, target)
          if (change.kind === 'off') {
            return { kind: 'success', text: 'Turning the style dial off (applies from the next step).' }
          }
          if (change.kind === 'on') {
            return {
              kind: 'success',
              text: `Turning the style dial on at ${target.position.toFixed(2)} (applies from the next step).`,
            }
          }
          return {
            kind: 'success',
            text: `Sliding the style dial to ${target.position.toFixed(2)} (applies from the next step).`,
          }
        }
        if (target.active !== foldActive(agent.session.events)) {
          agent.session.append('rheostat/active', { active: target.active })
        }
        if (target.position !== foldPosition(agent.session.events)) {
          agent.session.append('rheostat/position', { position: target.position })
        }
        agent.inject(narration(change, detectLanguage(agent.session.events)))
        if (change.kind === 'off') {
          return { kind: 'success', text: 'Style dial turned off.' }
        }
        if (change.kind === 'on') {
          return {
            kind: 'success',
            text: `Style dial turned on at ${target.position.toFixed(2)} — ${modeLabel(target.position)}.`,
          }
        }
        return {
          kind: 'success',
          text: `Style dial slid to ${target.position.toFixed(2)} — ${modeLabel(target.position)}.`,
        }
      },
    })
  })

  ctx.tools.register(defineTool({
    name: RHEOSTAT_SET,
    description: 'Slide the style dial (滑动变阻器) of this session to a position between 0 and 1. '
      + '0 means terse, quiet, minimal answers (0 模式); 1 means expressive, detailed, lively answers '
      + '(1 模式); values in between blend the two. Call this when the user asks for shorter/quieter or '
      + 'fuller/more expressive answers, or to set your own preferred style.',
    parameters: {
      position: {
        type: 'number',
        required: true,
        description: 'The new dial position, a number between 0 and 1 inclusive.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          position: { type: 'number', required: true },
          mode: { type: 'string', required: true, enum: ['terse', 'balanced', 'expressive'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Style dial slid to ${value.position.toFixed(2)} — ${modeLabel(value.position)}.`,
      }],
    },
    execute(args, exec) {
      if (exec.agent === undefined) {
        // The dial is per-session state; a non-agent caller has no session to slide.
        throw new Error(`${RHEOSTAT_SET} requires an owning agent session`)
      }
      const position = validatePosition(args.position)
      // Sliding always turns the dial on: a position is an explicit request
      // for the style to apply.
      if (!foldActive(exec.agent.session.events)) {
        exec.agent.session.append('rheostat/active', { active: true })
      }
      exec.agent.session.append('rheostat/position', { position })
      return Promise.resolve({ position, mode: modeOf(position) })
    },
    presentCall: args => ({ card: 'generic', title: 'Slide style dial', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: RHEOSTAT_GET,
    description: 'Read the current style dial (滑动变阻器) state of this session: whether it is on, its '
      + 'position between 0 (terse) and 1 (expressive), and the mode. The prompt section already states '
      + 'the position; use this when you need the state programmatically.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          active: { type: 'boolean', required: true },
          position: { type: 'number', required: true },
          mode: { type: 'string', required: true, enum: ['terse', 'balanced', 'expressive'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.active
          ? `Style dial at ${value.position.toFixed(2)} — ${modeLabel(value.position)}.`
          : 'Style dial is off.',
      }],
    },
    execute(_args, exec) {
      if (exec.agent === undefined) {
        throw new Error(`${RHEOSTAT_GET} requires an owning agent session`)
      }
      const state = stateIn(exec.agent)
      return Promise.resolve({
        active: state.active,
        position: state.position,
        mode: modeOf(state.position),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read style dial', kind: 'other' }),
  }))
}
