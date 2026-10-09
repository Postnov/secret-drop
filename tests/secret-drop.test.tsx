import { describe, expect, test } from 'claude-code/testing'

import { applyMaskedEdit, quoteEnv, redactSecrets, upsertEnv } from '../hooks/lib'

describe('masked field', () => {
  test('typing, pasting and deleting through dots', () => {
    let real = ''
    real = applyMaskedEdit(real, 'sk-abc') // paste into the empty field
    expect(real).toBe('sk-abc')
    real = applyMaskedEdit(real, '••••••d') // one more key after the redraw
    expect(real).toBe('sk-abcd')
    real = applyMaskedEdit(real, '••••••') // backspace
    expect(real).toBe('sk-abc')
    real = applyMaskedEdit(real, '•••X•••') // typed in the middle
    expect(real).toBe('sk-Xabc')
    real = applyMaskedEdit(real, '••••ef') // two keys before the redraw caught up
    expect(real).toBe('sk-Xef')
    real = applyMaskedEdit(real, 'new') // select all, paste
    expect(real).toBe('new')
  })
})

describe('dotenv', () => {
  test('replaces in place and appends the rest', () => {
    const before = '# keys\nexport OPENAI_API_KEY=old\nPORT=3000'
    const after = upsertEnv(
      before,
      new Map([
        ['OPENAI_API_KEY', 'sk-new'],
        ['TELEGRAM_BOT_TOKEN', '123:AA b'],
      ]),
    )
    expect(after).toBe("# keys\nexport OPENAI_API_KEY=sk-new\nPORT=3000\nTELEGRAM_BOT_TOKEN='123:AA b'\n")
  })

  test('quotes what needs quoting', () => {
    expect(quoteEnv('abc=')).toBe('abc=')
    expect(quoteEnv('pa ss#1')).toBe("'pa ss#1'")
    expect(quoteEnv("it's\nmulti")).toBe('"it\'s\\nmulti"')
  })
})

describe('prompt guard', () => {
  test('cuts known key shapes out of a prompt', () => {
    const key = `sk-ant-api03-${'x'.repeat(40)}`
    const bot = `1234567890:AA${'y'.repeat(33)}`
    const { found, text } = redactSecrets(`here is my key ${key} and bot ${bot}`)
    expect(found.map(item => item.kind)).toEqual(['Anthropic', 'Telegram bot'])
    expect(text).toBe('here is my key [Anthropic key removed] and bot [Telegram bot key removed]')
  })

  test('leaves ordinary text alone', () => {
    expect(redactSecrets('set OPENAI_API_KEY in .env, see sk-learn docs').found).toEqual([])
  })
})

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

describe('secure input flow', () => {
  test('a tool call shows the band above the prompt; typed value goes to .env, the model only hears the length', async ($, on) => {
    const writes: Array<{ path: string; text: string }> = []
    const submitted: string[] = []
    on('session.cwd', () => ({ value: '/proj' }))
    on('fs.exists', () => ({ value: false }))
    on('fs.write', (_$, e) => {
      writes.push({ path: e.path, text: e.text })
      return { value: undefined }
    })
    on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('ui.focus', () => ({}))
    on('ui.close', () => ({ value: undefined }))
    on('prompt.submit', (_$, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })

    const called = await $.tool.call({
      tool: 'mcp__secret-drop__request_secret',
      secrets: [{ name: 'OPENAI_API_KEY', hint: 'platform.openai.com' }],
      reason: 'for the bot',
    })
    expect(JSON.stringify(called)).toContain('End your turn')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'secret-drop', surface, component: 'AbovePrompt', props: BAND_PROPS })
      if (surface === 'desktop') {
        const head = await ui.find({ type: 'Svg' })
        expect(String((head?.props as { alt?: string } | undefined)?.alt)).toContain('OPENAI_API_KEY')
      } else {
        expect(await ui.find({ type: 'Text', text: 'OPENAI_API_KEY' })).toBeDefined()
      }
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: 'secret-drop', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const field = await ui.find({ type: 'Input' })
    const key = field?.key ?? ''
    await ui.input({ key, text: 'sk-secret-123', kind: 'change' })
    expect((await ui.find({ type: 'Input' }))?.text).toBe('•'.repeat(13))
    await ui.input({ key, text: '•'.repeat(13) })

    expect(writes).toEqual([{ path: '/proj/.env', text: 'OPENAI_API_KEY=sk-secret-123\n' }])
    expect(submitted.length).toBe(1)
    expect(submitted[0]).toContain('OPENAI_API_KEY (13 chars)')
    expect(submitted[0]).not.toContain('sk-secret-123')
    await ui.unmount()
  })
})
