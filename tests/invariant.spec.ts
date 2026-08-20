import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as Rheostat from '../src/index.ts'
import * as RheostatInvariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(RheostatInvariant)
  return ctx
}

function event(position: unknown): SessionEvent {
  return { type: 'rheostat/position', seq: 0, time: 0, data: { position } } as SessionEvent
}

describe('style-dial invariants', () => {
  it('accepts the plugin-written positions across the whole dial', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('rheostat/position', { position: 1 })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(RheostatInvariant).then(() => undefined)).resolves.toBeUndefined()
    expect(() => { ctx.emit('session/event', {} as Session, event(0)) }).not.toThrow()
  })

  it.each([
    ['not-a-number', 'banana', /finite number/],
    ['nan', Number.NaN, /finite number/],
    ['negative', -0.01, /in \[0, 1\]/],
    ['oversized', 1.01, /in \[0, 1\]/],
    ['infinity', Number.POSITIVE_INFINITY, /finite number/],
  ])('rejects an incoherent durable position (%s)', async (_label, position, message) => {
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, event(position)) }).toThrow(message)
  })

  it('ignores unrelated dispatches and session events', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('tools/change')
      ctx.emit('session/event', {} as Session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects an invalid existing position on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('rheostat/position', { position: 2 })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(RheostatInvariant).then(() => undefined)).rejects.toThrow(/in \[0, 1\]/)
  })

  it('keeps the plugin and its companion source-consistent with the tools', () => {
    expect(Rheostat.name).toBe('rheostat')
    expect(RheostatInvariant.name).toBe('rheostat-invariant')
    expect(RheostatInvariant.inject).toEqual(['invariants'])
  })
})
