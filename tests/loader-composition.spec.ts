// Boots the REAL plugin through the REAL Loader from a cordis.yml and proves
// the assembled product surface: the prompt section renders the folded style,
// both tools register, and the /rheostat command executes — the non-unit
// REAL-composition coverage the testing policy requires of a product-visible
// plugin.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as Rheostat from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('rheostat-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: (message) => { session.append('user/message', message, { surfaceOp: 'append' }) }, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-rheostat-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-rheostat'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-rheostat', Rheostat],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('dsh-rheostat real Loader composition through cordis.yml', () => {
  it('registers both tools and renders the style section from the session log', async () => {
    const ctx = await boot()
    const names = ctx.tools.schemas().map(s => s.name).sort()
    expect(names).toEqual(['rheostat_get', 'rheostat_set'])

    const owner = agent(ctx)
    const defaulted = await ctx.systemPrompt.assemble({ agent: owner, scope: owner })
    expect(defaulted.sections.find(s => s.name === 'rheostat:style')?.text).toContain('0 与 1 之间 · 均衡')

    owner.session.append('rheostat/position', { position: 0 })
    const slid = await ctx.systemPrompt.assemble({ agent: owner, scope: owner })
    expect(slid.sections.find(s => s.name === 'rheostat:style')?.text).toContain('0 模式 · 极简静默')
  }, 30_000)

  it('executes the /rheostat command end to end', async () => {
    const ctx = await boot()
    const owner = agent(ctx)
    const signal = new AbortController().signal
    const slid = await ctx.commands.execute(owner, '/rheostat 1', [], signal)
    expect(slid?.result).toEqual({
      kind: 'success',
      text: 'Style dial slid to 1.00 — 1 模式 · 饱满热烈.',
    })
    expect(owner.session.events.findLast(e => e.type === 'rheostat/position')?.data.position).toBe(1)
    const read = await ctx.commands.execute(owner, '/rheostat', [], signal)
    expect(read?.result).toEqual({
      kind: 'success',
      text: 'Style dial (滑动变阻器) at 1.00 — 1 模式 · 饱满热烈. Use /rheostat <0..1> to slide it.',
    })
  }, 30_000)
})
