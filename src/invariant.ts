/** Package-owned durable style-dial invariants. @module @deepseek-ai/dsh-rheostat/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-rheostat'

/** Cordis companion plugin name. */
export const name = 'rheostat-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one style-dial snapshot before it reaches the durable log.
 * The tool and command already reject invalid positions at the source; this
 * guards the log itself so a replay or fork of a malformed record fails loud.
 */
function validatePosition(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`rheostat/position must carry a finite number in [0, 1], got ${String(value)}`)
  }
}

/** Validate one on/off snapshot: the payload must be a boolean. */
function validateActive(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'boolean') {
    fail(`rheostat/active must carry a boolean, got ${String(value)}`)
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'rheostat/position') validatePosition(event.data.position, fail)
  if (event.type === 'rheostat/active') validateActive(event.data.active, fail)
}

/** Install validation for loaded and newly appended style-dial snapshots. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the rheostat invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
