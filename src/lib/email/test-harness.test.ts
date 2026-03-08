import { describe, expect, it } from 'vitest'

import { createEmailTestHarness, createUserRecord } from './test-harness'

describe('email test harness', () => {
  it('provides working D1, R2, queue, and email doubles', async () => {
    const harness = createEmailTestHarness()

    try {
      const userId = await createUserRecord(harness.db)

      expect(userId).toBe('user_test_01')

      await harness.storage.put('fixtures/test.txt', 'hello harness')
      await harness.queue.send({ ok: true })
      await harness.email.send({ subject: 'Harness' })

      expect(await (await harness.storage.get('fixtures/test.txt'))?.text()).toBe('hello harness')
      expect(harness.queue.sent).toEqual([{ body: { ok: true }, options: undefined }])
      expect(harness.email.sent).toEqual([{ subject: 'Harness' }])
    } finally {
      harness.cleanup()
    }
  })
})
