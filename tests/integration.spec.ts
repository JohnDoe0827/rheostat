import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Rheostat from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/**
 * Full-loop integration: a scripted mock model drives the REAL rheostat tools
 * through the agent loop, exercising the same execution paths a live model
 * would — the tool/call + tool/result session events AND the rheostat/position
 * event the slide tool appends. Only the model is mocked; the tool, the prompt
 * section, and the session log are real.
 */
async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Rheostat)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function findEvent<T extends SessionEvent['type']>(
  log: readonly SessionEvent[],
  type: T,
): Extract<SessionEvent, { type: T }> {
  const found = log.findLast(event => event.type === type)
  if (!found) throw new Error(`no ${type} event in the session log`)
  return found as Extract<SessionEvent, { type: T }>
}

describe('rheostat tools through the agent loop', () => {
  it('a model slide lands a tool/call, a non-error tool/result, and a rheostat/position event', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'rheostat_set', { position: 1 }, 'Sliding the dial to full volume.'),
      textResponse('Done — full 1 mode from now on.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-rheostat-1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'be more expressive' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(findEvent(log, 'tool/call').data.name).toBe('rheostat_set')
    expect(findEvent(log, 'tool/result').data.message.content[0].isError).toBe(false)
    expect(findEvent(log, 'rheostat/position').data.position).toBe(1)
  })

  it('a model read reflects the folded position without writing', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'rheostat_get', {}, 'Reading the dial.'),
      textResponse('Got it.'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('it-rheostat-2'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'where is the dial?' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const log = agent.session.events
    expect(findEvent(log, 'tool/call').data.name).toBe('rheostat_get')
    expect(log.some(event => event.type === 'rheostat/position')).toBe(false)
  })
})
