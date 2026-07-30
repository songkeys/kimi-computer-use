# Kimi Computer Use

An experimental, unofficial bridge that lets
[Kimi Code CLI](https://github.com/MoonshotAI/kimi-code) control local macOS
applications through an existing OpenAI Computer Use installation.

The package contains no OpenAI binaries. It starts the Computer Use client
already installed on the user's Mac and translates the small MCP compatibility
gap between Kimi Code and that client.

## Requirements

- macOS. The installed OpenAI runtime currently declares macOS 14.4 or later.
- Kimi Code CLI with plugin support. Version 0.29.1 is verified.
- ChatGPT or Codex with OpenAI Computer Use installed and working.
- Accessibility and Screen Recording permissions granted to the OpenAI
  Computer Use runtime.

The bridge looks for the Computer Use client at:

```text
$CODEX_HOME/computer-use/Codex Computer Use.app/Contents/SharedSupport/
SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient
```

When `CODEX_HOME` is unset, it defaults to `~/.codex`.

## Install as a Kimi plugin

In a Kimi Code session:

```text
/plugins install https://github.com/songkeys/kimi-computer-use
/reload
```

Kimi installs a managed copy under
`$KIMI_CODE_HOME/plugins/managed/kimi-computer-use`. New sessions load the
Computer Use Skill and MCP server automatically.

Inspect the installation with:

```text
/plugins info kimi-computer-use
/mcp
```

## Install the MCP bridge from npm

The GitHub plugin installation is recommended because it includes both the MCP
bridge and the Kimi Skill. The npm package can also be used as a standalone
stdio MCP server:

```sh
npx -y kimi-computer-use@latest
```

For example, a direct Kimi `mcp.json` entry can use:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "npx",
      "args": ["-y", "kimi-computer-use@latest"]
    }
  }
}
```

This MCP-only installation does not load the bundled Kimi Skill. Prefer the
GitHub plugin unless the MCP client supplies its own Computer Use instructions.

## Usage

Ask Kimi to use Computer Use explicitly, or describe a desktop task:

```text
Use Computer Use to inspect Calculator and enter 42.
```

```text
Open System Settings with Computer Use and tell me what page is visible.
```

The bundled Skill instructs Kimi to use an observable state/action/state loop:

1. Read the target app with `get_app_state`.
2. Use accessibility elements when available and screenshot coordinates only
   as a fallback.
3. Perform the action.
4. Fetch a fresh app state before deciding the next action.

## How it works

The OpenAI Computer Use service authenticates the client process ancestry.
Launching its MCP client directly from Kimi is rejected as an unauthenticated
sender. The bridge therefore uses the signed Codex executable bundled with
ChatGPT or Codex as a process launcher:

```text
Kimi Code
  -> kimi-computer-use bridge
  -> signed Codex launcher
  -> OpenAI Computer Use MCP client
  -> OpenAI Computer Use service
```

Codex is not used as an agent and no OpenAI model request is made by the
bridge. It runs `codex sandbox` with Codex's disabled/unrestricted permission
profile so the signed client can access its normal caches, macOS services, and
Unix sockets.

Kimi Code 0.29.1 does not advertise the MCP elicitation capability required by
the Computer Use client. The bridge adds that capability to `initialize` and
automatically accepts the app-access elicitation. All other JSON-RPC messages,
including screenshot image blocks, pass through unchanged.

## Configuration

Environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEX_HOME` | Override the Codex data directory. Defaults to `~/.codex`. |
| `COMPUTER_USE_CLIENT_PATH` | Override the full path to `SkyComputerUseClient`. |
| `COMPUTER_USE_CODEX_LAUNCHER_PATH` | Override the signed Codex executable path. |
| `COMPUTER_USE_BRIDGE_DEBUG=1` | Write bridge diagnostics to stderr. |

The signed launcher is discovered in this order:

1. `COMPUTER_USE_CODEX_LAUNCHER_PATH`
2. `/Applications/ChatGPT.app/Contents/Resources/codex`
3. `/Applications/Codex.app/Contents/Resources/codex`

## Security and data flow

Installing this package gives Kimi access to the local Computer Use tools,
which can read screenshots, click, type, scroll, drag, and interact with
applications.

The bridge intentionally:

- automatically accepts the Computer Use MCP app-access elicitation;
- launches the signed client with an unrestricted Codex permission profile;
- passes accessibility text and screenshots back to Kimi as MCP tool results.

Kimi may send those tool results to the configured model provider as part of
the conversation. Do not install the plugin unless that behavior is acceptable
for the applications and data on the Mac.

## Compatibility

The initial release was verified with:

| Component | Verified version |
| --- | --- |
| Kimi Code CLI | 0.29.1 |
| ChatGPT bundled Codex | 0.146.0-alpha.3.1 |
| OpenAI Computer Use runtime | 26.721.1000502 |
| macOS / architecture | macOS 27.0 / arm64 |
| MCP protocol | 2025-11-25 |

OpenAI Computer Use is an internal desktop integration rather than a stable
third-party SDK. ChatGPT, Codex, or Computer Use updates may change binary
paths, process-authentication rules, or protocol behavior.

## Development

The bridge has no runtime npm dependencies.

```sh
pnpm install
pnpm test
pnpm smoke
```

`pnpm test` uses a fake Computer Use server and is safe to run anywhere.
`pnpm smoke` connects to the real local service, calls `list_apps`, and verifies
that `get_app_state` returns both text and a JPEG screenshot.

## Troubleshooting

### `Sender process is not authenticated`

The Computer Use client was started directly instead of through the signed
Codex launcher. Ensure ChatGPT or Codex is installed in `/Applications`, or set
`COMPUTER_USE_CODEX_LAUNCHER_PATH`.

### Computer Use client is missing

Enable or reinstall OpenAI Computer Use first, then verify that its client
exists below `$CODEX_HOME/computer-use`.

### Client and server version mismatch

Quit and relaunch ChatGPT so its Computer Use client and runtime update
together, then retry the smoke test.

### Plugin changes do not appear

Run `/reload` or start a new Kimi session. Kimi runs its managed plugin copy, so
editing the original checkout does not affect an existing installation until
the plugin is reinstalled.

## License and trademarks

The bridge code is available under the [MIT License](./LICENSE).

This project is independent and is not affiliated with, endorsed by, or
sponsored by OpenAI or Moonshot AI. OpenAI, ChatGPT, Codex, Kimi, and related
names may be trademarks of their respective owners. Users must supply and be
licensed to use their own OpenAI and Kimi software and accounts.
