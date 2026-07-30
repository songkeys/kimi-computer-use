#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEBUG = process.env.COMPUTER_USE_BRIDGE_DEBUG === "1";

function debug(message) {
  if (DEBUG) {
    process.stderr.write(`[computer-use-bridge] ${message}\n`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveUpstreamPath() {
  const override = process.env.COMPUTER_USE_CLIENT_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }

  const configuredCodexHome = process.env.CODEX_HOME?.trim();
  const codexHome = configuredCodexHome || path.join(os.homedir(), ".codex");

  return path.join(
    codexHome,
    "computer-use",
    "Codex Computer Use.app",
    "Contents",
    "SharedSupport",
    "SkyComputerUseClient.app",
    "Contents",
    "MacOS",
    "SkyComputerUseClient",
  );
}

async function resolveTrustedLauncherPath() {
  const override = process.env.COMPUTER_USE_CODEX_LAUNCHER_PATH?.trim();
  const candidates = [
    override,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next signed Codex launcher location.
    }
  }

  throw new Error(
    `OpenAI's signed Codex launcher was not found. Checked: ${candidates.join(
      ", ",
    )}`,
  );
}

function withElicitationCapability(message) {
  if (!isObject(message) || message.method !== "initialize") {
    return null;
  }

  const params = isObject(message.params) ? message.params : {};
  const capabilities = isObject(params.capabilities)
    ? { ...params.capabilities }
    : {};
  const existingElicitation = isObject(capabilities.elicitation)
    ? { ...capabilities.elicitation }
    : {};
  const protocolVersion =
    typeof params.protocolVersion === "string" ? params.protocolVersion : "";

  if (protocolVersion >= "2025-11-25") {
    existingElicitation.form = isObject(existingElicitation.form)
      ? existingElicitation.form
      : {};
  }

  capabilities.elicitation = existingElicitation;

  return {
    ...message,
    params: {
      ...params,
      capabilities,
    },
  };
}

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function pumpJsonLines(stream, onLine, onEnd) {
  let buffer = "";
  stream.setEncoding("utf8");

  stream.on("data", (chunk) => {
    buffer += chunk;

    for (;;) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if (line.length > 0) {
        onLine(line);
      }
    }
  });

  stream.on("end", () => {
    let line = buffer;
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    if (line.length > 0) {
      onLine(line);
    }
    onEnd?.();
  });
}

function writeJsonLine(stream, value) {
  if (!stream.destroyed && stream.writable) {
    stream.write(`${JSON.stringify(value)}\n`);
  }
}

const upstreamPath = resolveUpstreamPath();
const directLaunch =
  process.env.COMPUTER_USE_BRIDGE_DIRECT_LAUNCH === "1";

try {
  await access(upstreamPath, fsConstants.X_OK);
} catch {
  process.stderr.write(
    `Computer Use client is missing or not executable: ${upstreamPath}\n`,
  );
  process.exit(1);
}

let launchCommand = upstreamPath;
let launchArgs = ["mcp"];

if (!directLaunch) {
  try {
    launchCommand = await resolveTrustedLauncherPath();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  const sandboxState = JSON.stringify({
    permissionProfile: {
      type: "disabled",
      fileSystem: {
        type: "unrestricted",
      },
    },
    sandboxCwd: pathToFileURL(process.cwd()).href,
  });
  launchArgs = [
    "sandbox",
    "--sandbox-state-json",
    sandboxState,
    "--",
    upstreamPath,
    "mcp",
  ];
}

debug(`starting ${launchCommand} ${launchArgs.join(" ")}`);

const upstream = spawn(launchCommand, launchArgs, {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});

let stopping = false;

upstream.stderr.pipe(process.stderr);

upstream.on("error", (error) => {
  process.stderr.write(
    `Failed to start the Computer Use MCP client: ${error.message}\n`,
  );
  process.exitCode = 1;
});

upstream.stdin.on("error", (error) => {
  if (error.code !== "EPIPE") {
    process.stderr.write(
      `Computer Use MCP stdin failed: ${error.message}\n`,
    );
  }
});

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") {
    stopping = true;
    upstream.kill("SIGTERM");
    return;
  }
  throw error;
});

pumpJsonLines(
  process.stdin,
  (line) => {
    const message = parseJson(line);
    const rewritten = withElicitationCapability(message);

    if (rewritten !== null) {
      debug("advertised form elicitation support");
      writeJsonLine(upstream.stdin, rewritten);
      return;
    }

    if (!upstream.stdin.destroyed && upstream.stdin.writable) {
      upstream.stdin.write(`${line}\n`);
    }
  },
  () => {
    upstream.stdin.end();
  },
);

pumpJsonLines(upstream.stdout, (line) => {
  const message = parseJson(line);

  if (
    isObject(message) &&
    message.method === "elicitation/create" &&
    Object.hasOwn(message, "id")
  ) {
    debug(
      `auto-accepted elicitation: ${
        typeof message.params?.message === "string"
          ? message.params.message
          : "Computer Use request"
      }`,
    );
    writeJsonLine(upstream.stdin, {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        action: "accept",
        content: {},
      },
    });
    return;
  }

  if (!process.stdout.destroyed && process.stdout.writable) {
    process.stdout.write(`${line}\n`);
  }
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    if (stopping) {
      return;
    }
    stopping = true;
    debug(`forwarding ${signal}`);
    upstream.kill(signal);
  });
}

upstream.on("close", (code, signal) => {
  debug(`upstream closed (code=${String(code)}, signal=${String(signal)})`);
  if (signal) {
    process.exitCode = signal === "SIGINT" ? 130 : 1;
  } else {
    process.exitCode = code ?? 0;
  }
  process.stdout.end();
});
