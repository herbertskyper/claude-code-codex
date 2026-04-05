import { execa } from 'execa'
import { existsSync } from 'fs'
import { createInterface } from 'node:readline'
import { join } from 'path'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../../types/message.js'
import { getCwd } from '../../../utils/cwd.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  getAssistantMessageText,
  getUserMessageText,
} from '../../../utils/messages.js'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'

const DEFAULT_TIMEOUT_MS = 600 * 1000

type CodexTurnUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

type CodexCliQueuedEvent =
  | { type: 'line'; source: 'stdout' | 'stderr'; line: string }
  | { type: 'done'; source: 'stdout' | 'stderr' }

class AsyncQueue<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(value: T) => void> = []

  enqueue(item: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(item)
      return
    }
    this.items.push(item)
  }

  dequeue(): Promise<T> {
    const item = this.items.shift()
    if (item !== undefined) {
      return Promise.resolve(item)
    }

    return new Promise(resolve => {
      this.waiters.push(resolve)
    })
  }
}

export function isUsingCodexCliOpenAI(): boolean {
  return isEnvTruthy(process.env.OPENAI_USE_CODEX_CLI)
}

export function resolveCodexCliCommand(cwd: string = getCwd()): string {
  const configured = process.env.OPENAI_CODEX_CLI_PATH?.trim()
  if (configured) return configured

  const localCommand = join(
    cwd,
    '.tmp-codex-cli',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex',
  )
  if (existsSync(localCommand)) {
    return localCommand
  }

  return 'codex'
}

export async function getCodexCliLoginStatus(
  command: string = resolveCodexCliCommand(),
): Promise<{ loggedIn: boolean; message: string }> {
  const result = await execa(command, ['login', 'status'], {
    reject: false,
    timeout: 15_000,
    cwd: getCwd(),
  })

  const message = [result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .trim()

  return {
    loggedIn: result.exitCode === 0 && /logged in/i.test(message),
    message,
  }
}

function buildCodexPrompt(
  messages: Message[],
  systemPrompt: SystemPrompt,
): string {
  const sections: string[] = [
    'You are acting as the model backend for another coding assistant.',
    "Continue the conversation and produce only the assistant's next reply.",
  ]

  if (systemPrompt.length > 0) {
    sections.push(`System instructions:\n${systemPrompt.join('\n\n')}`)
  }

  const transcript: string[] = []
  for (const message of messages) {
    if (message.type === 'user') {
      const text = getUserMessageText(message)
      if (text) transcript.push(`User:\n${text}`)
      continue
    }

    if (message.type === 'assistant') {
      const text = getAssistantMessageText(message)
      if (text) transcript.push(`Assistant:\n${text}`)
    }
  }

  if (transcript.length > 0) {
    sections.push(`Conversation so far:\n\n${transcript.join('\n\n')}`)
  }

  sections.push("Respond as the assistant to the latest user message.")
  return sections.join('\n\n')
}

function parseCodexJsonl(stdout: string): {
  text: string | null
  usage?: CodexTurnUsage
} {
  let text: string | null = null
  let usage: CodexTurnUsage | undefined

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('{')) continue

    try {
      const event = JSON.parse(line) as any

      if (
        event?.type === 'item.completed' &&
        event?.item?.type === 'agent_message' &&
        typeof event.item.text === 'string'
      ) {
        text = event.item.text.trim()
      }

      if (event?.type === 'turn.completed' && event?.usage) {
        usage = {
          input_tokens: Number(event.usage.input_tokens ?? 0),
          output_tokens: Number(event.usage.output_tokens ?? 0),
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: Number(event.usage.cached_input_tokens ?? 0),
        }
      }
    } catch {
      // Ignore non-JSON and partial lines emitted by the child.
    }
  }

  return { text, usage }
}

function createCodexCliStatusEvent(message: string): StreamEvent {
  return {
    type: 'stream_event',
    event: {
      type: 'codex_cli_status',
      message,
    },
  }
}

function createCodexCliStatusClearEvent(): StreamEvent {
  return {
    type: 'stream_event',
    event: {
      type: 'codex_cli_status_clear',
    },
  }
}

function getCodexCliStatusMessage(line: string): string | null {
  const reconnectMatch =
    line.match(/Reconnecting\.\.\.\s*(\d+)\/(\d+)/i) ??
    line.match(/retrying sampling request \((\d+)\/(\d+)/i)
  if (reconnectMatch) {
    return `Codex reconnecting ${reconnectMatch[1]}/${reconnectMatch[2]}...`
  }

  if (/falling back to http/i.test(line)) {
    return 'Codex falling back to HTTP...'
  }

  return null
}

function parseCodexJsonlLine(line: string): {
  text?: string
  usage?: CodexTurnUsage
  statusMessage?: string
} {
  if (!line.startsWith('{')) {
    return {}
  }

  try {
    const event = JSON.parse(line) as any

    if (
      event?.type === 'item.completed' &&
      event?.item?.type === 'agent_message' &&
      typeof event.item.text === 'string'
    ) {
      return {
        text: event.item.text.trim(),
      }
    }

    if (event?.type === 'turn.completed' && event?.usage) {
      return {
        usage: {
          input_tokens: Number(event.usage.input_tokens ?? 0),
          output_tokens: Number(event.usage.output_tokens ?? 0),
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: Number(event.usage.cached_input_tokens ?? 0),
        },
      }
    }

    if (typeof event?.message === 'string') {
      const statusMessage = getCodexCliStatusMessage(event.message)
      if (statusMessage) {
        return { statusMessage }
      }
    }
  } catch {
    // Ignore partial or non-JSON lines while the subprocess is still running.
  }

  return {}
}

function pumpCodexCliStream(
  stream: NodeJS.ReadableStream | null,
  source: 'stdout' | 'stderr',
  queue: AsyncQueue<CodexCliQueuedEvent>,
): void {
  if (!stream) {
    return
  }

  void (async () => {
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    })

    try {
      for await (const rawLine of rl) {
        const line = rawLine.trim()
        if (!line) continue
        queue.enqueue({ type: 'line', source, line })
      }
    } finally {
      rl.close()
      queue.enqueue({ type: 'done', source })
    }
  })()
}

function summarizeCodexFailure(stderr: string, exitCode: number): string {
  const trimmed = stderr.trim()
  if (/not logged in|login/i.test(trimmed)) {
    return 'Codex CLI is not logged in. Run `codex login` and choose "Sign in with ChatGPT", then retry.'
  }
  if (trimmed) {
    const firstLine = trimmed.split(/\r?\n/).find(Boolean) ?? trimmed
    return `Codex CLI failed (${exitCode}): ${firstLine}`
  }
  return `Codex CLI failed (${exitCode}).`
}

export async function* queryModelCodexCli(
  messages: Message[],
  systemPrompt: SystemPrompt,
  signal: AbortSignal,
  model: string,
): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  try {
    const cwd = getCwd()
    const command = resolveCodexCliCommand(cwd)
    const loginStatus = await getCodexCliLoginStatus(command)

    if (!loginStatus.loggedIn) {
      yield createAssistantAPIErrorMessage({
        content:
          'Codex CLI is not logged in. Run `codex login` and choose "Sign in with ChatGPT", then retry.',
        apiError: 'authentication_error',
        error: 'authentication_failed',
      })
      return
    }

    const prompt = buildCodexPrompt(messages, systemPrompt)
    logForDebugging(
      `[CodexCLI] command=${command} model=${model} cwd=${cwd}`,
    )

    const subprocess = execa(
      command,
      [
        'exec',
        '--json',
        '--color',
        'never',
        '--skip-git-repo-check',
        '-C',
        cwd,
        '--model',
        model,
        '-',
      ],
      {
        cwd,
        input: prompt,
        all: false,
        reject: false,
        cancelSignal: signal,
        timeout: parseInt(
          process.env.API_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
          10,
        ),
      },
    )

    let lastStatusMessage: string | null = 'Connecting to ChatGPT OAuth...'
    let assistantYielded = false
    yield createCodexCliStatusEvent(lastStatusMessage)

    const queue = new AsyncQueue<CodexCliQueuedEvent>()
    let activeReaders = 0

    if (subprocess.stdout) {
      activeReaders += 1
      pumpCodexCliStream(subprocess.stdout, 'stdout', queue)
    }

    if (subprocess.stderr) {
      activeReaders += 1
      pumpCodexCliStream(subprocess.stderr, 'stderr', queue)
    }

    while (activeReaders > 0) {
      const event = await queue.dequeue()

      if (event.type === 'done') {
        activeReaders -= 1
        continue
      }

      const statusMessage =
        event.source === 'stdout'
          ? parseCodexJsonlLine(event.line).statusMessage ??
            getCodexCliStatusMessage(event.line)
          : getCodexCliStatusMessage(event.line)

      if (
        statusMessage &&
        statusMessage !== lastStatusMessage &&
        !assistantYielded
      ) {
        lastStatusMessage = statusMessage
        yield createCodexCliStatusEvent(statusMessage)
      }

      if (event.source !== 'stdout') {
        continue
      }

      const parsedLine = parseCodexJsonlLine(event.line)
      if (parsedLine.text && !assistantYielded) {
        assistantYielded = true
        if (lastStatusMessage !== null) {
          lastStatusMessage = null
          yield createCodexCliStatusClearEvent()
        }
        yield createAssistantMessage({
          content: parsedLine.text,
        })
      }
    }

    const result = await subprocess
    if (assistantYielded) {
      return
    }

    if (lastStatusMessage !== null) {
      yield createCodexCliStatusClearEvent()
    }

    const parsed = parseCodexJsonl(result.stdout)
    if (parsed.text) {
      yield createAssistantMessage({
        content: parsed.text,
        usage: parsed.usage as any,
      })
      return
    }

    yield createAssistantAPIErrorMessage({
      content: summarizeCodexFailure(result.stderr, result.exitCode),
      apiError: 'api_error',
      error: 'server_error',
    })
  } catch (error) {
    if (signal.aborted) return

    const message = error instanceof Error ? error.message : String(error)
    logForDebugging(`[CodexCLI] Error: ${message}`, { level: 'error' })
    yield createAssistantAPIErrorMessage({
      content: `Codex CLI error: ${message}`,
      apiError: 'api_error',
      error: 'server_error',
    })
  }
}
