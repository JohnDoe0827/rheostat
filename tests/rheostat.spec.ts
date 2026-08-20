import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'

import * as rheostat from '../src/index.ts'

const testSignal = new AbortController().signal

/**
 * Drives the REAL plugin: mounts `dsh-rheostat` beside real `SystemPrompt`,
 * `ToolRuntime`, and `CommandRuntime` services, with fake Agents carrying real
 * `Session`s. Request boundaries are simulated by dispatching the real
 * pre-step waterfall and the following `step/start` session event used by the
 * loop, exactly as the plan-mode suite does.
 */

async function agentWithSession(
  ctx: Context,
  id = 'agent-1',
): Promise<Agent & { session: Session }> {
  const session = Session.create(SessionId(id))
  const agent = {
    id: SessionId(id),
    session,
    options: {},
    inject(message: UserMessage) {
      session.append('user/message', message, { surfaceOp: 'append' })
    },
  } as unknown as Agent & { session: Session }
  const agents = ctx.get('agents')
  if (agents === undefined) {
    ctx.emit('agent/created', { agent })
  } else {
    agents.enter(agent, undefined)
    agents.announce(agent)
  }
  return agent
}

/** Assemble exactly as the loop does: the agent is both subject and scope. */
function assembleFor(ctx: Context, agent: Agent) {
  return ctx.systemPrompt.assemble({ agent, scope: agent })
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(rheostat)
  return ctx
}

async function setupWithCommands(): Promise<Context> {
  const ctx = await setup()
  await ctx.plugin(CommandRuntime)
  // The `ctx.inject` child mounts asynchronously once `commands` resolves.
  await new Promise(resolve => setImmediate(resolve))
  return ctx
}

/**
 * Dispatch pre-step processing and optionally its following step-start commit.
 */
async function boundary(ctx: Context, agent: Agent & { session: Session }, type: 'pre-step' | 'step-start'): Promise<void> {
  const events = agentEvents(ctx, agent)
  const message = createUserMessage({
    content: [{ type: 'text', text: 'boundary probe' }],
    source: { kind: 'user' },
  })
  const signal = new AbortController().signal
  const decision = await events.waterfall(
    'agent/pre-step',
    { messages: [message], turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages.slice(1)) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
  if (type === 'step-start') {
    const event = agent.session.append('step/start', { turn: 1, step: 1 })
    ctx.emit('session/event', agent.session, event)
  }
}

/** Open a turn so a selection queues for the boundary flush (the mid-turn shape). */
function openTurn(session: Session, turn = 0): void {
  session.append('turn/start', { turn })
}

function positions(session: Session): number[] {
  return session.events
    .filter(event => event.type === 'rheostat/position')
    .map(event => event.data.position)
}

function pluginNotices(session: Session): string[] {
  return session.events
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    .map(event => (event.data as { content: { type: string; text?: string }[] }).content.map(block => block.text ?? '').join(''))
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('style dial state', () => {
  it('folds to the neutral middle before any position event and last-write-wins afterwards', () => {
    const ev = (position: number, seq: number): SessionEvent => ({
      type: 'rheostat/position',
      seq,
      time: seq,
      data: { position },
    })
    expect(rheostat.foldPosition([])).toBe(rheostat.DEFAULT_POSITION)
    expect(rheostat.foldPosition([ev(0.25, 1)])).toBe(0.25)
    expect(rheostat.foldPosition([ev(1, 1), ev(0, 2)])).toBe(0)
    expect(rheostat.foldPosition([ev(1, 1), ev(0, 2)], 2)).toBe(0)
    // An `end` prefix stops before later writes.
    expect(rheostat.foldPosition([ev(1, 1), ev(0, 2)], 1)).toBe(1)
  })

  it('classifies modes and labels by the 0.25 / 0.75 thresholds', () => {
    expect(rheostat.modeOf(0)).toBe('terse')
    expect(rheostat.modeOf(0.25)).toBe('terse')
    expect(rheostat.modeOf(0.26)).toBe('balanced')
    expect(rheostat.modeOf(0.5)).toBe('balanced')
    expect(rheostat.modeOf(0.74)).toBe('balanced')
    expect(rheostat.modeOf(0.75)).toBe('expressive')
    expect(rheostat.modeOf(1)).toBe('expressive')
    expect(rheostat.modeLabel(0)).toContain('0 模式')
    expect(rheostat.modeLabel(0.5)).toContain('均衡')
    expect(rheostat.modeLabel(1)).toContain('1 模式')
  })

  it('rejects non-finite and out-of-range positions loud instead of clamping', () => {
    expect(rheostat.validatePosition(0)).toBe(0)
    expect(rheostat.validatePosition(1)).toBe(1)
    expect(() => rheostat.validatePosition(NaN)).toThrow('finite number')
    expect(() => rheostat.validatePosition(Number.POSITIVE_INFINITY)).toThrow('finite number')
    expect(() => rheostat.validatePosition(-0.01)).toThrow('between 0 and 1')
    expect(() => rheostat.validatePosition(1.01)).toThrow('between 0 and 1')
  })

  it('parses /rheostat input strictly', () => {
    expect(rheostat.parsePosition('0.5')).toBe(0.5)
    expect(rheostat.parsePosition('1')).toBe(1)
    expect(() => rheostat.parsePosition('abc')).toThrow('finite number')
    expect(() => rheostat.parsePosition('1.5')).toThrow('between 0 and 1')
  })

  it('renders the band-appropriate style section text', () => {
    expect(rheostat.styleText(0)).toContain('0 模式 · 极简静默')
    expect(rheostat.styleText(0.5)).toContain('0 与 1 之间 · 均衡')
    expect(rheostat.styleText(1)).toContain('1 模式 · 饱满热烈')
  })

  it('detects an open turn from the log brackets', () => {
    const session = Session.create(SessionId('open-turn'))
    expect(rheostat.hasOpenTurn(session.events)).toBe(false)
    openTurn(session)
    expect(rheostat.hasOpenTurn(session.events)).toBe(true)
    session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    expect(rheostat.hasOpenTurn(session.events)).toBe(false)
  })
})

describe('prompt section', () => {
  it('renders the style section from the folded position and stays empty without an agent', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'section-default')
    const assembled = await assembleFor(ctx, agent)
    const section = assembled.sections.find(s => s.name === rheostat.SECTION_NAME)
    expect(section?.text).toContain('0 与 1 之间 · 均衡')

    const agentless = await ctx.systemPrompt.assemble()
    const agentlessSection = agentless.sections.find(s => s.name === rheostat.SECTION_NAME)
    expect(agentlessSection?.text).toBe('')
  })

  it('reflects a model slide on the very next assembly (the log is the source)', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'section-slide')
    agent.session.append('rheostat/position', { position: 1 })
    const assembled = await assembleFor(ctx, agent)
    const section = assembled.sections.find(s => s.name === rheostat.SECTION_NAME)
    expect(section?.text).toContain('1 模式 · 饱满热烈')
  })
})

describe('dsh-rheostat tools', () => {
  it('registers rheostat_set and rheostat_get with the expected schemas', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(s => s.name).sort()
    expect(names).toEqual([rheostat.RHEOSTAT_GET, rheostat.RHEOSTAT_SET])
    const setSchema = ctx.tools.schemas().find(s => s.name === rheostat.RHEOSTAT_SET)
    expect((setSchema?.parameters as { properties?: Record<string, unknown> }).properties).toHaveProperty('position')
  })

  it('rheostat_set appends a durable position event and returns the canonical value', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'setter')
    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('set-1'),
      name: rheostat.RHEOSTAT_SET,
      arguments: { position: 0.8 },
      agent,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected rheostat_set success')
    expect(result.value).toEqual({ position: 0.8, mode: 'expressive' })
    expect(text(result)).toContain('1 模式 · 饱满热烈')
    expect(positions(agent.session)).toEqual([0.8])
  })

  it('rejects an out-of-range slide as an isError result without touching the log', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'bad-setter')
    const result = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('set-bad'),
      name: rheostat.RHEOSTAT_SET,
      arguments: { position: 1.5 },
      agent,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('between 0 and 1')
    expect(positions(agent.session)).toEqual([])
  })

  it('rejects a non-agent caller (the dial has no owning session)', async () => {
    const ctx = await setup()
    for (const name of [rheostat.RHEOSTAT_SET, rheostat.RHEOSTAT_GET]) {
      const result = await ctx.tools.execute({
        signal: testSignal,
        callId: CallId(`no-agent-${name}`),
        name,
        arguments: name === rheostat.RHEOSTAT_SET ? { position: 0.5 } : {},
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('owning agent session')
    }
  })

  it('rheostat_get reads the folded position, defaulting to the neutral middle', async () => {
    const ctx = await setup()
    const agent = await agentWithSession(ctx, 'getter')
    const before = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('get-1'),
      name: rheostat.RHEOSTAT_GET,
      arguments: {},
      agent,
    })
    expect(before.isError).toBe(false)
    if (before.isError) throw new Error('expected rheostat_get success')
    expect(before.value).toEqual({ position: rheostat.DEFAULT_POSITION, mode: 'balanced' })

    agent.session.append('rheostat/position', { position: 0 })
    const after = await ctx.tools.execute({
      signal: testSignal,
      callId: CallId('get-2'),
      name: rheostat.RHEOSTAT_GET,
      arguments: {},
      agent,
    })
    if (after.isError) throw new Error('expected rheostat_get success')
    expect(after.value).toEqual({ position: 0, mode: 'terse' })
  })

  it('presents the calls with stable titles', async () => {
    const ctx = await setup()
    expect(ctx.tools.get(rheostat.RHEOSTAT_SET)?.presentCall?.({ position: 0.5 }))
      .toEqual({ card: 'generic', title: 'Slide style dial', kind: 'other', rawInput: { position: 0.5 } })
    expect(ctx.tools.get(rheostat.RHEOSTAT_GET)?.presentCall?.({}))
      .toEqual({ card: 'generic', title: 'Read style dial', kind: 'other' })
  })
})

describe('/rheostat', () => {
  it('registers only when a commands service is composed', async () => {
    const bare = await setup()
    expect(bare.get('commands')).toBeUndefined()

    const ctx = await setupWithCommands()
    const agent = await agentWithSession(ctx, 'command-list')
    expect(ctx.commands.list(agent)).toEqual([
      { name: 'rheostat', description: 'Slide the style dial (滑动变阻器) between 0 (terse) and 1 (expressive)', input: { hint: '[0..1]' } },
    ])
  })

  it('reads the current position with a bare /rheostat', async () => {
    const ctx = await setupWithCommands()
    const agent = await agentWithSession(ctx, 'command-read')
    const result = await ctx.commands.execute(agent, '/rheostat', [], testSignal)
    expect(result?.result).toEqual({
      kind: 'success',
      text: 'Style dial (滑动变阻器) at 0.50 — 0 与 1 之间 · 均衡. Use /rheostat <0..1> to slide it.',
    })
  })

  it('rejects an invalid position with an error result', async () => {
    const ctx = await setupWithCommands()
    const agent = await agentWithSession(ctx, 'command-bad')
    const result = await ctx.commands.execute(agent, '/rheostat banana', [], testSignal)
    expect(result?.result).toEqual({
      kind: 'error',
      text: 'Invalid dial position: rheostat position must be a finite number, got NaN',
    })
  })

  it('is a no-op when the position is unchanged', async () => {
    const ctx = await setupWithCommands()
    const agent = await agentWithSession(ctx, 'command-noop')
    const result = await ctx.commands.execute(agent, '/rheostat 0.5', [], testSignal)
    expect(result?.result).toEqual({
      kind: 'success',
      text: 'Style dial is already at 0.50 — 0 与 1 之间 · 均衡.',
    })
    expect(positions(agent.session)).toEqual([])
  })

  it('commits immediately between turns and narrates the slide', async () => {
    const ctx = await setupWithCommands()
    const agent = await agentWithSession(ctx, 'command-idle')
    const result = await ctx.commands.execute(agent, '/rheostat 1', [], testSignal)
    expect(result?.result).toEqual({
      kind: 'success',
      text: 'Style dial slid to 1.00 — 1 模式 · 饱满热烈.',
    })
    expect(positions(agent.session)).toEqual([1])
    expect(pluginNotices(agent.session)).toEqual(['The user slid the style dial (滑动变阻器) to 1.00 (1 模式 · 饱满热烈).'])
  })

  it('queues during an open turn, commits at the next accepted pre-step, and narrates into the request', async () => {
    const ctx = await setupWithCommands()
    const agent = await agentWithSession(ctx, 'command-mid-turn')
    openTurn(agent.session)
    const queued = await ctx.commands.execute(agent, '/rheostat 0', [], testSignal)
    expect(queued?.result).toEqual({
      kind: 'success',
      text: 'Sliding the style dial to 0.00 (applies from the next step).',
    })
    // Pending renders on the next assembly even before the durable commit.
    const assembled = await assembleFor(ctx, agent)
    expect(assembled.sections.find(s => s.name === rheostat.SECTION_NAME)?.text).toContain('0 模式 · 极简静默')
    expect(positions(agent.session)).toEqual([])

    await boundary(ctx, agent, 'step-start')
    expect(positions(agent.session)).toEqual([0])
    expect(pluginNotices(agent.session)).toEqual(['The user slid the style dial (滑动变阻器) to 0.00 (0 模式 · 极简静默).'])
  })

  it('a later /rheostat replaces an earlier queued selection, and a selection matching the committed position cancels silently', async () => {
    const ctx = await setupWithCommands()
    const agent = await agentWithSession(ctx, 'command-cancel')
    openTurn(agent.session)
    await ctx.commands.execute(agent, '/rheostat 0.8', [], testSignal)
    await ctx.commands.execute(agent, '/rheostat 0.5', [], testSignal)
    // The pending map keeps the last selection; the boundary sees it equals the
    // committed fold, so it clears without appending or narrating.
    await boundary(ctx, agent, 'step-start')
    expect(positions(agent.session)).toEqual([])
    expect(pluginNotices(agent.session)).toEqual([])
  })
})

describe('export shape and disposal', () => {
  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in rheostat).toBe(false)
    expect(rheostat.name).toBe('rheostat')
    expect(rheostat.inject).toEqual(['tools', 'systemPrompt'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(rheostat) as Record<string, unknown>
    expect(unwrapped).toBe(rheostat)
    expect(unwrapped.name).toBe('rheostat')
    expect(unwrapped.inject).toEqual(['tools', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('unregisters tools and the prompt section when its fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(rheostat)
    expect(ctx.tools.schemas().some(s => s.name === rheostat.RHEOSTAT_SET)).toBe(true)
    const before = await ctx.systemPrompt.assemble()
    expect(before.sections.some(s => s.name === rheostat.SECTION_NAME)).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === rheostat.RHEOSTAT_SET)).toBe(false)
    const after = await ctx.systemPrompt.assemble()
    expect(after.sections.some(s => s.name === rheostat.SECTION_NAME)).toBe(false)
  })
})
