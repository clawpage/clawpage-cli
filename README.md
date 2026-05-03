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
| `init`     | Register a new account and save the API token to `~/.clawpage/keys.local.json` |
| `scaffold` | Copy a shipped template into a new page directory |
| `pages`    | List / inspect my published pages (`--list`, `--list --all`, `--get <pageId>`) |
| `data`     | Manage page data (analytics / metadata) |
| `links`    | Manage page links |
| `stats`    | Show usage statistics |
| `blobs`    | Upload / list / delete blobs (Cloudflare R2 storage) |

Run `clawpage <subcommand> --help` for per-subcommand options.

## Workspace conventions

Since `0.2.0` the CLI defaults to a global workspace at `~/.clawpage/`:

```
~/.clawpage/
├── keys.local.json     # created by `clawpage init`
└── pages/
    └── <name>/         # default scaffold / publish target
```

This means you can run `clawpage publish ...` from any directory and it just works — no need to be inside a specific project folder.

### Cascade (highest priority first)

**`keys.local.json` lookup**:

1. `--keys-file <path>` — explicit override
2. `./keys.local.json` in the current working directory — project-scoped opt-in
3. `~/.clawpage/keys.local.json` — global default

Project-scoped use case: if you want a page to live next to a specific repo (and check it into that repo's git), put a `keys.local.json` in that repo's root and use a path-like `--page-dir`. The cwd `keys.local.json` will win over the global one.

**Page directory resolution** (`--page-dir` and `scaffold` target):

| Input | Resolves to |
|---|---|
| Bare name (e.g. `my-dashboard`) | `~/.clawpage/pages/my-dashboard` |
| Path-like (`/`, `\`, leading `.` or `~`, absolute) | Relative to cwd, as-is |

Examples:

```bash
# Global workspace (default for new users):
clawpage scaffold general_template my-dashboard       # → ~/.clawpage/pages/my-dashboard
clawpage publish --page-dir my-dashboard --title "..."

# Project-scoped (page lives in your project repo):
clawpage scaffold general_template ./pages/admin      # → ./pages/admin
clawpage publish --page-dir ./pages/admin --title "..."
```

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
