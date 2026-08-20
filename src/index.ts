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
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'rheostat'

/** Services the plugin registers on. */
export const inject = ['tools', 'systemPrompt']

/** The dial's neutral middle position used before any `rheostat/position` event. */
export const DEFAULT_POSITION = 0.5

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
 * The model-visible style section for one position: the dial reading plus the
 * style instruction for the current mode band.
 * @param position - a validated dial position in [0, 1].
 * @returns the section text rendered at each assembly.
 */
export function styleText(position: number): string {
  const rounded = position.toFixed(2)
  if (position <= TERSE_THRESHOLD) {
    return `滑动变阻器（style dial）位于 ${rounded}，处于 0 模式 · 极简静默。`
      + ' 调整回答风格：只给结论，不给铺垫；能用一句话绝不用两句；删掉寒暄、修饰与重复；列表尽量短。'
      + ' 像 0 一样安静、克制、留白。用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。'
  }
  if (position >= EXPRESSIVE_THRESHOLD) {
    return `滑动变阻器（style dial）位于 ${rounded}，处于 1 模式 · 饱满热烈。`
      + ' 调整回答风格：尽情展开；主动补充背景、细节和例子；表达有温度、有存在感；可以热情、夸张、有节奏；把每个想法点亮，绝不缺席。'
      + ' 像 1 一样明亮、响亮、内容丰富。用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。'
  }
  return `滑动变阻器（style dial）位于 ${rounded}，处于 0 与 1 之间 · 均衡。`
    + ' 调整回答风格：按比例混合两种模式，靠近 0 则简洁克制，靠近 1 则饱满热烈；当前以均衡为主，视内容需要微调。'
    + ' 用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。'
}

/** The user-change notice appended to the next request after a `/rheostat` slide. */
function narration(position: number): UserMessage {
  const text = `The user slid the style dial (滑动变阻器) to ${position.toFixed(2)} (${modeLabel(position)}).`
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
  // A user's /rheostat selection made during an open turn, awaiting the next
  // accepted in-turn pre-step. The section reads it so the next assembly
  // already renders the new style; the pre-step commits it durably.
  const pending = new WeakMap<Session, number>()

  /** The position in force: a pending user selection, else the folded log. */
  function positionIn(agent: Agent): number {
    return pending.get(agent.session) ?? foldPosition(agent.session.events)
  }

  /** Append one pending selection before the next request assembly. */
  function commitPending(session: Session, position: number): void {
    if (position === foldPosition(session.events)) {
      pending.delete(session)
      return
    }
    session.append('rheostat/position', { position })
    // Delete only after append succeeds so a later accepted in-turn pre-step
    // can retry a failed durable write.
    pending.delete(session)
  }

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    const position = pending.get(agent.session)
    if (decision.kind === 'reject' || signal.aborted || position === undefined) return decision
    const changed = position !== foldPosition(agent.session.events)
    try {
      commitPending(agent.session, position)
    } catch (error) {
      ctx.logger.warn('dsh-rheostat: failed to append selected position at step start: %o', error)
      return decision
    }
    return changed
      ? { ...decision, messages: [...decision.messages, narration(position)] }
      : decision
  })

  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (context) => {
      if (context.agent === undefined) return ''
      return styleText(positionIn(context.agent))
    },
  })

  // The command child activates only when a command registry is composed.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'rheostat',
      description: 'Slide the style dial (滑动变阻器) between 0 (terse) and 1 (expressive)',
      input: { hint: '[0..1]' },
      handler: ({ agent, rawInput }) => {
        const input = rawInput.trim()
        if (input === '') {
          const position = positionIn(agent)
          return {
            kind: 'success',
            text: `Style dial (滑动变阻器) at ${position.toFixed(2)} — ${modeLabel(position)}. Use /rheostat <0..1> to slide it.`,
          }
        }
        let position: number
        try {
          position = parsePosition(input)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { kind: 'error', text: `Invalid dial position: ${message}` }
        }
        const current = positionIn(agent)
        if (position === current) {
          return {
            kind: 'success',
            text: `Style dial is already at ${position.toFixed(2)} — ${modeLabel(position)}.`,
          }
        }
        if (hasOpenTurn(agent.session.events)) {
          pending.set(agent.session, position)
          return {
            kind: 'success',
            text: `Sliding the style dial to ${position.toFixed(2)} (applies from the next step).`,
          }
        }
        agent.session.append('rheostat/position', { position })
        agent.inject(narration(position))
        return {
          kind: 'success',
          text: `Style dial slid to ${position.toFixed(2)} — ${modeLabel(position)}.`,
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
      exec.agent.session.append('rheostat/position', { position })
      return Promise.resolve({ position, mode: modeOf(position) })
    },
    presentCall: args => ({ card: 'generic', title: 'Slide style dial', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: RHEOSTAT_GET,
    description: 'Read the current style dial (滑动变阻器) position of this session, between 0 (terse) '
      + 'and 1 (expressive). The prompt section already states it; use this when you need the position '
      + 'programmatically.',
    parameters: {},
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
        text: `Style dial at ${value.position.toFixed(2)} — ${modeLabel(value.position)}.`,
      }],
    },
    execute(_args, exec) {
      if (exec.agent === undefined) {
        throw new Error(`${RHEOSTAT_GET} requires an owning agent session`)
      }
      const position = positionIn(exec.agent)
      return Promise.resolve({ position, mode: modeOf(position) })
    },
    presentCall: () => ({ card: 'generic', title: 'Read style dial', kind: 'other' }),
  }))
}
