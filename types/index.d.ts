export type SecretAsk = { name: string; hint?: string }

export type SecretRequest = {
  id: string
  secrets: SecretAsk[]
  reason?: string
  /** Absolute path of the env file to write, when saving to one. */
  envFile?: string
  /** The env file as the window names it: relative to the project, or with ~. */
  envLabel?: string
  /** Set when saving to GitHub Actions secrets. */
  github?: { repo?: string; environment?: string }
  /** Who started it: the model's tool call or the person's /secret. */
  from: 'model' | 'person'
  index: number
  captured: string[]
  skipped: string[]
  phase: 'input' | 'saving' | 'finished'
  report: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'secret-drop': {
      request: SecretRequest | null
      rev: number
      isRevealed: boolean
    }
  }
}
