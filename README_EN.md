# Claude Code Codex 666

This is my personal modified branch built on top of Claude Code source ideas and [claude-code-best/claude-code](https://github.com/claude-code-best/claude-code).

Source note:

- The overall capability model and engineering direction come from the Claude Code source ecosystem
- This branch also references parts of the engineering work in `claude-code-best`

This README focuses on what this branch adds and how to use it.

## What this branch changes

- Adds an OpenAI-compatible provider path
- Adds ChatGPT OAuth reuse through the official local `Codex CLI`
- Defaults the model route to `gpt-5.4`
- Uses an isolated config directory so it does not touch your original Claude Code setup
- Adds global launchers so it can be started from any folder
- Surfaces Codex reconnect progress instead of silently waiting

## Current build

- Version: `666.0.0-V666`
- Isolated config directory: `~/.claude-666`
- Preferred global command: `ccb666`
- Compatible launchers: `claude-code-codex`, `claude-code-v666`

## Project structure

The directories and files most relevant to this branch are:

- `src/entrypoints/cli.tsx`
  Startup entrypoint. This is where the `666` build bootstraps an isolated config directory and seeds the default `Codex CLI + gpt-5.4` settings.
- `src/services/api/openai/`
  OpenAI-compatible routing lives here. This branch adds `codexCli.ts` to bridge the official `codex` command into the existing request flow.
- `src/components/ConsoleOAuthFlow.tsx`
  `/login` UI flow. This is where the `Codex / ChatGPT OAuth` option was added.
- `src/utils/model/` and `src/utils/logoV2Utils.ts`
  Model display and provider labels. This branch adjusts the UI to show `GPT-5.4` and `ChatGPT OAuth (Codex CLI)`.
- `src/utils/messages.ts` and `src/screens/REPL.tsx`
  Stream handling and terminal UI. This is where reconnect progress is surfaced to the user.
- `scripts/install-global-launchers.ps1`
  Windows launcher installer for `ccb666`, `claude-code-codex`, and `claude-code-v666`.
- `README.md` / `README_EN.md`
  Branch-specific documentation.

## Main differences from the base repository

At a high level, this branch adds:

- A `Codex CLI` backend bridge
  Main file: `src/services/api/openai/codexCli.ts`
- A `Codex CLI` execution path inside the OpenAI provider
  Main file: `src/services/api/openai/index.ts`
- `/login -> Codex / ChatGPT OAuth`
  Main file: `src/components/ConsoleOAuthFlow.tsx`
- An isolated `666` config/bootstrap path
  Main files: `src/entrypoints/cli.tsx`, `src/utils/envUtils.ts`, `src/utils/settings/settings.ts`
- Correct model/provider display updates
  Main files: `src/utils/model/model.ts`, `src/utils/logoV2Utils.ts`
- Reconnect progress feedback in the terminal UI
  Main files: `src/utils/messages.ts`, `src/screens/REPL.tsx`
- Windows global launch commands
  Main files: `package.json`, `scripts/install-global-launchers.ps1`, `scripts/defines.ts`

## How it works

This ChatGPT route is not API-key based and does not scrape browser cookies.

The flow is:

- Log into ChatGPT with the official `codex login`
- This project invokes the local `codex` binary
- Authentication remains managed by the official `Codex CLI`
- This repository only bridges that model backend into the Claude Code-style shell

As a result:

- `OPENAI_API_KEY` is not required for this path
- ChatGPT cookies are not stored in this repository
- Browser sessions are not stored in this repository
- The login state is not written into project source files

## Requirements

- [Bun](https://bun.sh/) >= `1.3.11`
- Official `Codex CLI` available on the local machine

Make sure Codex is logged in first:

```bash
codex login
codex login status
```

Continue only after you see `Logged in using ChatGPT`.

If you have already logged into the official Codex tooling in VS Code, a VS Code terminal, or another local environment, and `codex login status` shows that you are logged in, this branch can reuse that same local login state directly.

## Install and build

From the repository root:

```bash
bun install
bun run build
bun run install:launcher
```

After that, you can start it from any directory:

```bash
ccb666
```

Alternative commands:

```bash
claude-code-codex
claude-code-v666
```

## First-time setup

1. Start `ccb666`
2. Run `/login`
3. Choose `Codex / ChatGPT OAuth`
4. If login is missing, run `codex login` in another terminal first

This branch uses:

```text
~/.claude-666
```

It does not overwrite the original:

```text
~/.claude
```

## Smoke test

```bash
ccb666 --print "Reply with exactly OK"
```

Expected output:

```text
OK
```

## Runtime notes

Codex may reconnect multiple times before returning a final answer. This branch now shows progress such as:

```text
Connecting to ChatGPT OAuth...
Codex reconnecting 1/5...
Codex reconnecting 2/5...
Codex falling back to HTTP...
```

So the UI no longer appears frozen during that wait.

## Open-source hygiene

Temporary local folders are already ignored:

- `.tmp-codex-cli/`
- `.tmp-codex-inspect/`

Before open-sourcing, do not commit:

- `~/.codex/`
- `~/.claude/`
- `~/.claude-666/`
- any exported cookie, token, or session files

One extra note:

- `.vscode/launch.json` should not keep a machine-local Bun inspector URL. The repository copy has been sanitized to `ws://localhost:8888/replace-me`.

I also re-checked a few tracked areas:

- `node_modules/`, `dist/`, `.env`, `.tmp-codex-cli/`, and `.tmp-codex-inspect/` are already ignored
- `.claude/agents/hello-agent.md` currently looks like a sample agent file, not a secret
- `.vscode/tasks.json` is generic and fine to publish
- `.vscode/launch.json` previously contained a local debug URL and has now been de-localized

## Disclaimer

This project is for learning, research, and personal engineering experiments only.

Claude Code related rights belong to their original owners. The customizations here are specific to this branch. 
