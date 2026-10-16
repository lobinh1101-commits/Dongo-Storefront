import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthRevision, getAccountPresentation } from './auth-state.js'

test('anonymous visitors are offered sign-in and registration instead of an account avatar', () => {
  assert.deepEqual(getAccountPresentation(null, false), {
    status: 'anonymous',
    initial: null,
    actions: ['login', 'register'],
  })
})

test('the authenticated account view uses the current session user', () => {
  assert.deepEqual(getAccountPresentation({
    id: 4,
    name: 'Binh Nguyen',
    email: 'binh@example.test',
    role: 'customer',
  }, false), {
    status: 'authenticated',
    name: 'Binh Nguyen',
    email: 'binh@example.test',
    initial: 'B',
  })
})

test('logout invalidates a pending session restore so old account data cannot return', () => {
  const authRevision = createAuthRevision()
  const pendingRestore = authRevision.next()

  authRevision.next()

  assert.equal(authRevision.isCurrent(pendingRestore), false)
  assert.deepEqual(getAccountPresentation(null, false), {
    status: 'anonymous',
    initial: null,
    actions: ['login', 'register'],
  })
})

test('session state stays in loading view until the server restore completes', () => {
  assert.deepEqual(getAccountPresentation(null, true), { status: 'loading' })
})
