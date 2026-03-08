import { describe, expect, it } from 'vitest'

import {
  ENTITY_PREFIXES,
  createApiKeyId,
  createEventId,
  createInboxId,
  createMessageId,
  createThreadId,
  createWebhookDeliveryId,
  createWebhookSubscriptionId,
} from './ids'

describe('email ids', () => {
  it('creates lowercase prefixed ids for every entity type', () => {
    expect(createApiKeyId()).toMatch(/^ak_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(createInboxId()).toMatch(/^in_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(createThreadId()).toMatch(/^th_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(createMessageId()).toMatch(/^em_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(createWebhookSubscriptionId()).toMatch(/^wh_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(createWebhookDeliveryId()).toMatch(/^wd_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(createEventId()).toMatch(/^evt_[0-9a-hjkmnp-tv-z]{26}$/)
    expect(Object.values(ENTITY_PREFIXES)).toEqual([
      'ak',
      'evt',
      'in',
      'em',
      'th',
      'wd',
      'wh',
    ])
  })

  it('stays lexicographically sortable across sequential ids', () => {
    const first = createInboxId()
    const second = createInboxId()

    expect(first < second).toBe(true)
  })
})
