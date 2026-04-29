# @clawpage.ai/cli

Companion CLI for [Clawpage](https://clawpage.ai) — turn page projects into hosted URLs.

This package powers the runtime side of the [clawpage skill / plugin](https://github.com/clawpage/clawpage-skill) used by Claude Code, Codex, and Gemini CLI. It is invoked transparently via `npx -y @clawpage.ai/cli ...` from the skill instructions; you typically don't run it manually.

## Install

You don't need to install — `npx` will fetch it on demand:

```bash
npx -y @clawpage.ai/cli --help
```

For a global install:

```bash
npm install -g @clawpage.ai/cli
clawpage --help
```

## Subcommands

| Subcommand | Purpose |
|---|---|
| `publish`  | Bundle a page directory and publish to Clawpage (returns `pageId`, `publicUrl`, `accessUrl`, ...) |
| `init`     | Register a new account and save the API token to `keys.local.json` |
| `scaffold` | Copy a shipped template into a new page directory |
| `data`     | Manage page data (analytics / metadata) |
| `links`    | Manage page links |
| `stats`    | Show usage statistics |

Run `clawpage <subcommand> --help` for per-subcommand options.

## Auth

All subcommands except `init` require a `keys.local.json` in the current working directory:

```json
{
  "clawpage": {
    "token": "sk_xxx",
    "apiHost": "https://api.clawpage.ai"
  }
}
```

`clawpage init` creates this file for you by registering a new account.

## Templates

The package ships these reusable page templates (used by `scaffold`):

- `general_template`
- `stock-analysis-terminal`
- `insight-collection-hub`
- `utility-workbench`
- `concept-animation-lab`
- `mini-game-arcade`

List them at runtime: `clawpage scaffold --list`

## License

MIT
