import { describe, expect, it } from 'vitest'

import {
  InboxAliasValidationError,
  createDefaultInboxLocalPart,
  normalizeInboxAlias,
  validateInboxAlias,
} from './inboxes'

describe('inbox aliases', () => {
  it('normalizes aliases before validation', () => {
    expect(normalizeInboxAlias('  Agent-Desk  ')).toBe('agent-desk')
    expect(validateInboxAlias('  Agent-Desk  ')).toBe('agent-desk')
  })

  it('rejects reserved aliases', () => {
    expect(() => validateInboxAlias('support')).toThrow(InboxAliasValidationError)
  })

  it('rejects invalid characters', () => {
    expect(() => validateInboxAlias('agent_desk')).toThrow(InboxAliasValidationError)
    expect(() => validateInboxAlias('-agent')).toThrow(InboxAliasValidationError)
  })

  it('builds a stable default inbox local part from the inbox id', () => {
    expect(createDefaultInboxLocalPart('in_01jng0f3p5q8rqm3x7f4a9w2bz')).toBe(
      'u_01jng0f3p5q8rqm3x7f4a9w2bz',
    )
  })
})
