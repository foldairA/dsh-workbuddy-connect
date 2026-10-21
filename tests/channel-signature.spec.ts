import { describe, expect, it } from 'vitest'
import { prepareChatBody, prepareCnChatBody, prepareInternationalChatBody } from '../src/upstream.ts'

/**
 * Regression specs for the 2026-10-20 channel check.
 *
 * The CN gateway answers HTTP 400 code 11128 ("Illegal API invocation from an
 * unapproved channel") — surfaced as 「请求被拦截，请重新发送」 — whenever the
 * leading system/developer message begins with the DeepSeek Harness opener,
 * and for `role: "developer"` regardless of content. Both are neutralised in
 * the prepare step, so these specs pin the wire shape: opener replaced, rest of
 * the prompt byte-identical, and nothing else touched.
 */

const OPENER = 'You are an AI agent powered by DeepSeek Harness.'
const NEUTRAL = 'You are an AI agent.'
const PROMPT_BODY = 'You are interacting with the user through the DeepSeek Harness Web GUI.'

const openerOf = (source: string): string => {
  const body = JSON.parse(source) as { messages: Array<Record<string, unknown>> }
  return body.messages[0]?.['content'] as string
}

describe('channel signature neutralisation', () => {
  it('replaces the harness opener with a neutral one and keeps the rest verbatim', () => {
    const source = JSON.stringify({
      model: 'auto',
      messages: [{ role: 'system', content: `${OPENER}\n\n${PROMPT_BODY}` }],
    })
    expect(openerOf(prepareChatBody(source))).toBe(`${NEUTRAL}\n\n${PROMPT_BODY}`)
  })

  it('does not leave the fingerprint anywhere in the prepared body', () => {
    const source = JSON.stringify({ messages: [{ role: 'system', content: `${OPENER}\nbody` }] })
    expect(prepareChatBody(source)).not.toContain('powered by DeepSeek Harness')
  })

  it('tolerates a BOM and leading whitespace', () => {
    for (const prefix of ['\uFEFF', '  ', '\n\n', '\uFEFF \t']) {
      const source = JSON.stringify({ messages: [{ role: 'system', content: `${prefix}${OPENER}\nbody` }] })
      expect(openerOf(prepareChatBody(source))).toBe(`${NEUTRAL}\nbody`)
    }
  })

  it('is idempotent', () => {
    const source = JSON.stringify({ messages: [{ role: 'system', content: `${OPENER}\nbody` }] })
    const once = prepareChatBody(source)
    expect(prepareChatBody(once)).toBe(once)
  })

  it('rewrites the first text part of an array-shaped system prompt only', () => {
    const source = JSON.stringify({
      messages: [{
        role: 'system',
        content: [
          { type: 'text', text: `${OPENER}\nhead` },
          { type: 'text', text: `mentions ${OPENER} later` },
        ],
      }],
    })
    const body = JSON.parse(prepareChatBody(source)) as { messages: Array<Record<string, unknown>> }
    const parts = body.messages[0]?.['content'] as Array<Record<string, unknown>>
    expect(parts[0]?.['text']).toBe(`${NEUTRAL}\nhead`)
    // A literal mention deeper in the prompt is content, not a channel marker.
    expect(parts[1]?.['text']).toBe(`mentions ${OPENER} later`)
  })

  it('leaves prompts without the opener untouched', () => {
    const source = JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: `please read: ${OPENER}` },
      ],
    })
    const body = JSON.parse(prepareChatBody(source)) as { messages: Array<Record<string, unknown>> }
    expect(body.messages[0]?.['content']).toBe('You are a helpful assistant.')
    expect(body.messages[1]?.['content']).toBe(`please read: ${OPENER}`)
  })

  it('never touches a user message even when it opens with the fingerprint', () => {
    const source = JSON.stringify({ messages: [{ role: 'user', content: OPENER }] })
    const body = JSON.parse(prepareChatBody(source)) as { messages: Array<Record<string, unknown>> }
    expect(body.messages[0]?.['content']).toBe(OPENER)
  })

  it('applies to the CN path, which the shim does not always precede', () => {
    const source = JSON.stringify({ messages: [{ role: 'system', content: `${OPENER}\nbody` }] })
    expect(openerOf(prepareCnChatBody(source))).toBe(`${NEUTRAL}\nbody`)
  })

  it('rewrites developer to system on the CN path as well', () => {
    const source = JSON.stringify({
      messages: [{ role: 'developer', content: `${OPENER}\nbody` }],
    })
    const body = JSON.parse(prepareCnChatBody(source)) as { messages: Array<Record<string, unknown>> }
    expect(body.messages[0]?.['role']).toBe('system')
    expect(body.messages[0]?.['content']).toBe(`${NEUTRAL}\nbody`)
  })

  it('applies to the international path', () => {
    const source = JSON.stringify({
      messages: [{ role: 'developer', content: `${OPENER}\nbody` }],
    })
    const body = JSON.parse(prepareInternationalChatBody(source)) as { messages: Array<Record<string, unknown>> }
    expect(body.messages[0]?.['role']).toBe('system')
    expect(body.messages[0]?.['content']).toBe(`${NEUTRAL}\nbody`)
  })
})
