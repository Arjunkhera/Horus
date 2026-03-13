#!/usr/bin/env node

// src/index.ts
import { Command as Command10 } from "commander";
import chalk10 from "chalk";

// src/commands/setup.ts
import { Command as Command2 } from "commander";
import chalk2 from "chalk";
import ora2 from "ora";
import { execSync } from "child_process";
import { existsSync as existsSync5, mkdirSync as mkdirSync3 } from "fs";
import { join as join4 } from "path";
import { input, confirm, number, select, password } from "@inquirer/prompts";

// src/lib/config.ts
import { readFileSync as readFileSync2, writeFileSync, mkdirSync, existsSync as existsSync2, readdirSync, statSync } from "fs";
import { resolve, join as pathJoin, relative } from "path";
import { homedir as homedir2 } from "os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// src/lib/constants.ts
import { homedir } from "os";
import { join, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
function findPackageJson() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg2 = JSON.parse(readFileSync(candidate, "utf-8"));
      if (pkg2.name === "@arkhera30/cli") return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error("Could not find @arkhera30/cli package.json");
}
var pkg = JSON.parse(readFileSync(findPackageJson(), "utf-8"));
var CLI_VERSION = pkg.version;
var HORUS_DIR = join(homedir(), ".horus");
var CONFIG_PATH = join(HORUS_DIR, "config.yaml");
var ENV_PATH = join(HORUS_DIR, ".env");
var COMPOSE_PATH = join(HORUS_DIR, "docker-compose.yml");
var DEFAULT_PORTS = {
  anvil: 8100,
  vault_rest: 8e3,
  vault_mcp: 8300,
  forge: 8200
};
var DEFAULT_REPOS = {
  anvil_notes: "",
  vault_knowledge: "",
  forge_registry: ""
};
var DEFAULT_DATA_DIR = join(homedir(), ".horus", "data");
var SERVICES = [
  "qmd-daemon",
  "anvil",
  "vault",
  "vault-mcp",
  "forge"
];
var CONFIG_VERSION = "1.0";

// src/lib/config.ts
function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    data_dir: DEFAULT_DATA_DIR,
    runtime: "docker",
    ports: { ...DEFAULT_PORTS },
    git_host: "github.com",
    repos: { ...DEFAULT_REPOS },
    host_repos_path: "",
    host_repos_extra_scan_dirs: [],
    github_token: ""
  };
}
function ensureHorusDir() {
  mkdirSync(HORUS_DIR, { recursive: true });
}
function configExists() {
  return existsSync2(CONFIG_PATH);
}
function loadConfig() {
  if (!existsSync2(CONFIG_PATH)) {
    return defaultConfig();
  }
  const raw = readFileSync2(CONFIG_PATH, "utf-8");
  const parsed = parseYaml(raw);
  const defaults = defaultConfig();
  return {
    version: parsed.version ?? defaults.version,
    data_dir: parsed.data_dir ?? defaults.data_dir,
    runtime: parsed.runtime ?? defaults.runtime,
    ports: {
      anvil: parsed.ports?.anvil ?? defaults.ports.anvil,
      vault_rest: parsed.ports?.vault_rest ?? defaults.ports.vault_rest,
      vault_mcp: parsed.ports?.vault_mcp ?? defaults.ports.vault_mcp,
      forge: parsed.ports?.forge ?? defaults.ports.forge
    },
    git_host: parsed.git_host ?? defaults.git_host,
    repos: {
      anvil_notes: parsed.repos?.anvil_notes ?? defaults.repos.anvil_notes,
      vault_knowledge: parsed.repos?.vault_knowledge ?? defaults.repos.vault_knowledge,
      forge_registry: parsed.repos?.forge_registry ?? defaults.repos.forge_registry
    },
    host_repos_path: parsed.host_repos_path ?? defaults.host_repos_path,
    host_repos_extra_scan_dirs: parsed.host_repos_extra_scan_dirs ?? defaults.host_repos_extra_scan_dirs,
    github_token: parsed.github_token ?? defaults.github_token
  };
}
function saveConfig(config) {
  ensureHorusDir();
  const yaml = stringifyYaml(config, { lineWidth: 0 });
  writeFileSync(CONFIG_PATH, yaml, "utf-8");
}
function resolvePath(p) {
  if (p.startsWith("~")) {
    return resolve(homedir2(), p.slice(2));
  }
  return resolve(p);
}
function discoverRepoDirs(rootDir, maxDepth = 4) {
  const repoDirs = /* @__PURE__ */ new Set();
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = pathJoin(dir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync2(pathJoin(full, ".git"))) {
        repoDirs.add(dir);
      }
      walk(full, depth + 1);
    }
  }
  if (existsSync2(rootDir)) {
    walk(rootDir, 0);
  }
  return [...repoDirs];
}
function generateEnv(config) {
  const dataDir = resolvePath(config.data_dir);
  const hostReposPath = config.host_repos_path ? resolvePath(config.host_repos_path) : "";
  const baseScanPath = "/data/repos";
  let forgeScanPaths;
  if (hostReposPath) {
    const discoveredDirs = discoverRepoDirs(hostReposPath);
    const containerPaths = discoveredDirs.map((dir) => {
      const rel = relative(hostReposPath, dir);
      return rel ? `${baseScanPath}/${rel}` : baseScanPath;
    });
    const allPaths = [baseScanPath, ...containerPaths];
    const extraScanPaths = (config.host_repos_extra_scan_dirs ?? []).map((d) => d.trim()).filter(Boolean).map((d) => `${baseScanPath}/${d}`);
    const uniquePaths = [.../* @__PURE__ */ new Set([...allPaths, ...extraScanPaths])];
    forgeScanPaths = uniquePaths.join(":");
  } else {
    const extraScanPaths = (config.host_repos_extra_scan_dirs ?? []).map((d) => d.trim()).filter(Boolean).map((d) => `${baseScanPath}/${d}`);
    forgeScanPaths = [baseScanPath, ...extraScanPaths].join(":");
  }
  const lines = [
    "# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "# Horus \u2014 Generated .env file",
    "# Do not edit manually. Use `horus config set <key> <value>` instead.",
    "# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "",
    `HORUS_RUNTIME=${config.runtime}`,
    `HORUS_DATA_PATH=${dataDir}`,
    `HOST_REPOS_PATH=${hostReposPath}`,
    `FORGE_SCAN_PATHS=${forgeScanPaths}`,
    "",
    "# Ports",
    `ANVIL_PORT=${config.ports.anvil}`,
    `VAULT_PORT=${config.ports.vault_rest}`,
    `VAULT_MCP_PORT=${config.ports.vault_mcp}`,
    `FORGE_PORT=${config.ports.forge}`,
    "",
    "# Repository URLs (must be HTTPS \u2014 container services do not have SSH keys)",
    `ANVIL_REPO_URL=${config.repos.anvil_notes}`,
    `VAULT_KNOWLEDGE_REPO_URL=${config.repos.vault_knowledge}`,
    `FORGE_REGISTRY_REPO_URL=${config.repos.forge_registry}`,
    "",
    "# Authentication",
    `GITHUB_TOKEN=${config.github_token}`,
    ""
  ];
  return lines.join("\n");
}
function writeEnvFile(config) {
  ensureHorusDir();
  const content = generateEnv(config);
  writeFileSync(ENV_PATH, content, "utf-8");
}
var CONFIG_KEYS = [
  "data-dir",
  "host-repos-path",
  "host-repos-extra-scan-dirs",
  "runtime",
  "port.anvil",
  "port.vault-rest",
  "port.vault-mcp",
  "port.forge",
  "github-token",
  "git-host",
  "repo.anvil-notes",
  "repo.vault-knowledge",
  "repo.forge-registry"
];
function getConfigValue(config, key) {
  switch (key) {
    case "data-dir":
      return config.data_dir;
    case "host-repos-path":
      return config.host_repos_path;
    case "host-repos-extra-scan-dirs":
      return (config.host_repos_extra_scan_dirs ?? []).join(", ");
    case "runtime":
      return config.runtime;
    case "port.anvil":
      return String(config.ports.anvil);
    case "port.vault-rest":
      return String(config.ports.vault_rest);
    case "port.vault-mcp":
      return String(config.ports.vault_mcp);
    case "port.forge":
      return String(config.ports.forge);
    case "github-token":
      return config.github_token;
    case "git-host":
      return config.git_host;
    case "repo.anvil-notes":
      return config.repos.anvil_notes;
    case "repo.vault-knowledge":
      return config.repos.vault_knowledge;
    case "repo.forge-registry":
      return config.repos.forge_registry;
  }
}
function setConfigValue(config, key, value) {
  const updated = { ...config };
  switch (key) {
    case "data-dir":
      updated.data_dir = value;
      break;
    case "host-repos-path":
      updated.host_repos_path = value;
      break;
    case "host-repos-extra-scan-dirs":
      updated.host_repos_extra_scan_dirs = value.split(",").map((d) => d.trim()).filter(Boolean);
      break;
    case "runtime":
      if (value !== "docker" && value !== "podman") {
        throw new Error(`Invalid runtime: ${value}. Must be "docker" or "podman".`);
      }
      updated.runtime = value;
      break;
    case "port.anvil":
      updated.ports = { ...updated.ports, anvil: parseInt(value, 10) };
      break;
    case "port.vault-rest":
      updated.ports = { ...updated.ports, vault_rest: parseInt(value, 10) };
      break;
    case "port.vault-mcp":
      updated.ports = { ...updated.ports, vault_mcp: parseInt(value, 10) };
      break;
    case "port.forge":
      updated.ports = { ...updated.ports, forge: parseInt(value, 10) };
      break;
    case "github-token":
      updated.github_token = value;
      break;
    case "git-host":
      updated.git_host = value;
      break;
    case "repo.anvil-notes":
      updated.repos = { ...updated.repos, anvil_notes: value };
      break;
    case "repo.vault-knowledge":
      updated.repos = { ...updated.repos, vault_knowledge: value };
      break;
    case "repo.forge-registry":
      updated.repos = { ...updated.repos, forge_registry: value };
      break;
  }
  return updated;
}
function maskApiKey(key) {
  if (!key || key.length < 12) return key ? "****" : "(not set)";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

// src/lib/runtime.ts
import { execa } from "execa";
function toResult(result) {
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.exitCode ?? 0
  };
}
async function tryCommand(command, args) {
  try {
    const result = await execa(command, args, { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
async function commandExists(command) {
  try {
    await execa(command, ["--version"], { reject: false });
    return true;
  } catch {
    return false;
  }
}
function createRuntime(name) {
  const bin = name;
  const composeEnv = { ...process.env, HORUS_RUNTIME: name };
  return {
    name,
    async compose(...args) {
      const result = await execa(bin, ["compose", ...args], {
        cwd: HORUS_DIR,
        env: composeEnv,
        reject: false
      });
      if (result.exitCode !== 0) {
        const error = new Error(
          `${bin} compose ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr}`
        );
        error.result = toResult(result);
        throw error;
      }
      return toResult(result);
    },
    async exec(container, ...cmd) {
      const result = await execa(bin, ["exec", container, ...cmd], {
        reject: false
      });
      return toResult(result);
    },
    async inspect(container, format) {
      const result = await execa(bin, ["inspect", "--format", format, container], {
        reject: false
      });
      if (result.exitCode !== 0) {
        throw new Error(`inspect failed: ${result.stderr}`);
      }
      return result.stdout?.toString().trim() ?? "";
    },
    async isRunning() {
      try {
        const result = await execa(bin, ["compose", "ps", "--format", "json"], {
          cwd: HORUS_DIR,
          env: composeEnv,
          reject: false
        });
        return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
      } catch {
        return false;
      }
    }
  };
}
function parseComposeJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
    }
  }
  return trimmed.split("\n").filter((line) => line.trim()).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter((item) => item !== null);
}
async function checkRuntime(name) {
  return tryCommand(name, ["compose", "version"]);
}
async function detectRuntime(preferred) {
  if (preferred) {
    const hasPreferred = await tryCommand(preferred, ["compose", "version"]);
    if (hasPreferred) {
      return createRuntime(preferred);
    }
  }
  const hasDocker = await tryCommand("docker", ["compose", "version"]);
  if (hasDocker) {
    return createRuntime("docker");
  }
  const hasPodman = await tryCommand("podman", ["compose", "version"]);
  if (hasPodman) {
    return createRuntime("podman");
  }
  const podmanInstalled = await commandExists("podman");
  if (podmanInstalled) {
    throw new Error(
      "Podman is installed but `podman compose` is not working.\n\nFix options:\n  1. Ensure your Podman machine is running:  podman machine start\n  2. Install podman-compose:                 pip3 install podman-compose\n  3. Upgrade Podman to v5+:                  brew upgrade podman\n"
    );
  }
  throw new Error(
    "No container runtime found.\n\nHorus requires Docker or Podman with the Compose plugin.\n\nInstall one of:\n  - Docker Desktop: https://www.docker.com/products/docker-desktop/\n  - Podman Desktop:  https://podman-desktop.io/\n"
  );
}
async function composeStreaming(runtime, args) {
  const bin = runtime.name;
  const result = await execa(bin, ["compose", ...args], {
    cwd: HORUS_DIR,
    env: { ...process.env, HORUS_RUNTIME: runtime.name },
    stdio: "inherit",
    reject: false
  });
  if (result.exitCode !== 0) {
    throw new Error(`${bin} compose ${args.join(" ")} failed with exit code ${result.exitCode}`);
  }
}

// src/lib/health.ts
async function checkContainerHealth(runtime, service) {
  const candidates = [`horus-${service}-1`, `horus_${service}_1`];
  for (const containerName of candidates) {
    try {
      const healthStatus = await runtime.inspect(containerName, "{{.State.Health.Status}}");
      if (healthStatus && !healthStatus.includes("<nil>") && healthStatus.trim() !== "") {
        return { name: service, status: mapStatus(healthStatus) };
      }
      const stateStatus = await runtime.inspect(containerName, "{{.State.Status}}");
      if (stateStatus && stateStatus.trim() !== "") {
        return { name: service, status: mapStateStatus(stateStatus) };
      }
    } catch {
      continue;
    }
  }
  return { name: service, status: "stopped" };
}
function mapStatus(raw) {
  switch (raw.trim().toLowerCase()) {
    case "healthy":
      return "healthy";
    case "starting":
      return "starting";
    case "unhealthy":
      return "unhealthy";
    default:
      return "unknown";
  }
}
function mapStateStatus(raw) {
  switch (raw.trim().toLowerCase()) {
    case "running":
      return "healthy";
    case "created":
    case "restarting":
      return "starting";
    case "exited":
    case "dead":
    case "removing":
      return "unhealthy";
    default:
      return "unknown";
  }
}
async function checkAllHealth(runtime) {
  const results = await Promise.all(
    SERVICES.map((service) => checkContainerHealth(runtime, service))
  );
  return results;
}
async function pollUntilHealthy(runtime, onUpdate, timeoutMs = 3e5, intervalMs = 5e3) {
  const startTime = Date.now();
  while (true) {
    const states = await checkAllHealth(runtime);
    if (onUpdate) {
      onUpdate(states);
    }
    const allHealthy = states.every((s) => s.status === "healthy");
    if (allHealthy) {
      return states;
    }
    const hasUnhealthy = states.some((s) => s.status === "unhealthy");
    if (hasUnhealthy) {
      const unhealthyServices = states.filter((s) => s.status === "unhealthy").map((s) => s.name).join(", ");
      throw new Error(
        `Services failed health check: ${unhealthyServices}
Run '${runtime.name} compose logs <service>' from ~/.horus/ to investigate.`
      );
    }
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      const notReady = states.filter((s) => s.status !== "healthy").map((s) => `${s.name} (${s.status})`).join(", ");
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1e3)}s waiting for services: ${notReady}
Run '${runtime.name} compose logs' from ~/.horus/ to investigate.`
      );
    }
    await new Promise((resolve2) => setTimeout(resolve2, intervalMs));
  }
}

// src/lib/compose.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2, existsSync as existsSync3 } from "fs";
import { join as join2, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
var __filename = fileURLToPath2(import.meta.url);
var __dirname = dirname2(__filename);
function getBundledComposePath() {
  const candidates = [
    join2(__dirname, "..", "..", "compose", "docker-compose.yml"),
    join2(__dirname, "..", "compose", "docker-compose.yml")
  ];
  for (const candidate of candidates) {
    if (existsSync3(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Bundled docker-compose.yml not found. The CLI package may be corrupted.
Searched: ${candidates.join(", ")}`
  );
}
function applyPodmanUserOverride(compose) {
  return compose.replace(
    /^(    image: .+)$/gm,
    '$1\n    user: "0:0"'
  );
}
function composeFileExists() {
  return existsSync3(COMPOSE_PATH);
}
function installComposeFile(runtime) {
  ensureHorusDir();
  const bundledPath = getBundledComposePath();
  let content = readFileSync3(bundledPath, "utf-8");
  if (runtime === "podman") {
    content = applyPodmanUserOverride(content);
  }
  writeFileSync2(COMPOSE_PATH, content, "utf-8");
}

// src/commands/connect.ts
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { checkbox } from "@inquirer/prompts";
import { readFileSync as readFileSync4, writeFileSync as writeFileSync3, mkdirSync as mkdirSync2, existsSync as existsSync4 } from "fs";
import { join as join3 } from "path";
import { homedir as homedir3 } from "os";
import { execa as execa2 } from "execa";
function detectInstalledClients() {
  const detected = [];
  const home = homedir3();
  const claudeDesktopDir = join3(home, "Library", "Application Support", "Claude");
  if (existsSync4(claudeDesktopDir)) {
    detected.push("claude-desktop");
  }
  const claudeCodeDir = join3(home, ".claude");
  if (existsSync4(claudeCodeDir)) {
    detected.push("claude-code");
  }
  const cursorDir = join3(home, ".cursor");
  const cursorAppDir = join3(home, "Library", "Application Support", "Cursor");
  if (existsSync4(cursorDir) || existsSync4(cursorAppDir)) {
    detected.push("cursor");
  }
  return detected;
}
function getConfigPath(target) {
  const home = homedir3();
  switch (target) {
    case "claude-desktop":
      return join3(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "claude-code":
      return join3(home, ".claude", "settings.json");
    case "cursor":
      return join3(home, ".cursor", "mcp.json");
  }
}
function mergeAndWriteConfig(configPath, mcpServers) {
  let existing = {};
  if (existsSync4(configPath)) {
    try {
      const raw = readFileSync4(configPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      existing = {};
    }
  }
  const existingServers = existing.mcpServers ?? {};
  existing.mcpServers = { ...existingServers, ...mcpServers };
  const dir = configPath.substring(0, configPath.lastIndexOf("/"));
  mkdirSync2(dir, { recursive: true });
  writeFileSync3(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
}
async function isClaudeCliAvailable() {
  try {
    const result = await execa2("claude", ["--version"], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
async function registerWithClaudeCode(mcpServers) {
  const registered = [];
  const failed = [];
  for (const [name, entry] of Object.entries(mcpServers)) {
    const baseUrl = entry.url.replace(/\/sse$/, "");
    const result = await execa2(
      "claude",
      ["mcp", "add", "--transport", "http", "--scope", "user", name, baseUrl],
      { reject: false }
    );
    if (result.exitCode === 0) {
      registered.push(name);
    } else {
      failed.push(name);
    }
  }
  return { registered, failed };
}
async function syncSkills(runtime) {
  const home = homedir3();
  const skillsBase = join3(home, ".claude", "skills");
  const skills = ["horus-anvil", "horus-vault", "horus-forge"];
  const forgeContainer = "horus-forge-1";
  for (const skill of skills) {
    const destDir = join3(skillsBase, skill);
    mkdirSync2(destDir, { recursive: true });
    const src = `/home/forge/.claude/skills/${skill}/SKILL.md`;
    const dest = join3(destDir, "SKILL.md");
    const result = await runtime.exec(forgeContainer, "cat", src);
    if (result.exitCode === 0 && result.stdout.trim()) {
      writeFileSync3(dest, result.stdout, "utf-8");
    }
  }
}
async function syncSkillsForCursor(runtime) {
  const home = homedir3();
  const rulesDir = join3(home, ".cursor", "rules");
  const skills = ["horus-anvil", "horus-vault", "horus-forge"];
  const forgeContainer = "horus-forge-1";
  mkdirSync2(rulesDir, { recursive: true });
  for (const skill of skills) {
    const src = `/home/forge/.claude/skills/${skill}/SKILL.md`;
    const dest = join3(rulesDir, `${skill}.mdc`);
    const result = await runtime.exec(forgeContainer, "cat", src);
    if (result.exitCode === 0 && result.stdout.trim()) {
      const frontmatter = `---
description: Horus ${skill} reference
alwaysApply: true
---

`;
      writeFileSync3(dest, frontmatter + result.stdout, "utf-8");
    }
  }
}
function printNextSteps(targets) {
  console.log("");
  console.log(chalk.bold("Next steps:"));
  for (const target of targets) {
    switch (target) {
      case "claude-desktop":
        console.log(`  ${chalk.cyan("Claude Desktop")}  Restart Claude Desktop to pick up the new MCP configuration`);
        break;
      case "claude-code":
        console.log(`  ${chalk.cyan("Claude Code")}     Start a new Claude Code session`);
        break;
      case "cursor":
        console.log(`  ${chalk.cyan("Cursor")}          Restart Cursor to pick up the new MCP configuration and rules`);
        break;
    }
  }
  console.log("");
}
async function runConnect(config, runtime, targets, host = "localhost") {
  const mcpServers = {
    anvil: { url: `http://${host}:${config.ports.anvil}/sse` },
    vault: { url: `http://${host}:${config.ports.vault_mcp}/sse` },
    forge: { url: `http://${host}:${config.ports.forge}/sse` }
  };
  const configured = [];
  for (const target of targets) {
    if (target === "claude-code") {
      const cliSpinner = ora("Registering MCP servers with Claude Code CLI...").start();
      const cliAvailable = await isClaudeCliAvailable();
      if (cliAvailable) {
        const { registered, failed } = await registerWithClaudeCode(mcpServers);
        if (failed.length === 0) {
          cliSpinner.succeed(
            `Registered with Claude Code: ${registered.map((n) => chalk.cyan(n)).join(", ")}`
          );
          configured.push(target);
        } else if (registered.length > 0) {
          cliSpinner.warn(
            `Partially registered \u2014 ok: ${registered.join(", ")}, failed: ${failed.join(", ")}`
          );
          configured.push(target);
        } else {
          cliSpinner.fail("Failed to register MCP servers with Claude Code CLI");
        }
      } else {
        cliSpinner.warn("claude CLI not found on PATH \u2014 register manually:");
        for (const [name, entry] of Object.entries(mcpServers)) {
          const baseUrl = entry.url.replace(/\/sse$/, "");
          console.log(
            chalk.dim(`  claude mcp add --transport http --scope user ${name} ${baseUrl}`)
          );
        }
      }
    } else {
      const configPath = getConfigPath(target);
      const writeSpinner = ora(`Configuring ${chalk.cyan(target)}...`).start();
      try {
        mergeAndWriteConfig(configPath, mcpServers);
        writeSpinner.succeed(`Configured ${chalk.cyan(target)} \u2014 ${chalk.dim(configPath)}`);
        configured.push(target);
      } catch (error) {
        writeSpinner.fail(`Failed to configure ${target}`);
        console.log(chalk.dim(error.message));
      }
    }
  }
  if (targets.includes("claude-code")) {
    const skillsSpinner = ora("Syncing horus-core skills...").start();
    try {
      await syncSkills(runtime);
      skillsSpinner.succeed("horus-core skills synced to ~/.claude/skills/");
    } catch (error) {
      skillsSpinner.warn("Could not sync skills (Forge container may not be running)");
      console.log(chalk.dim(error.message));
    }
  }
  if (targets.includes("cursor")) {
    const cursorRulesSpinner = ora("Syncing horus-core rules for Cursor...").start();
    try {
      await syncSkillsForCursor(runtime);
      cursorRulesSpinner.succeed("horus-core rules synced to ~/.cursor/rules/");
    } catch (error) {
      cursorRulesSpinner.warn("Could not sync Cursor rules (Forge container may not be running)");
      console.log(chalk.dim(error.message));
    }
  }
  if (configured.length > 0) {
    printNextSteps(configured);
  }
  return configured;
}
var connectCommand = new Command("connect").description("Configure Claude/Cursor MCP integration").option("--target <client>", "Client to configure: claude-desktop, claude-code, cursor, all (default: auto-detect)").option("--host <host>", "MCP host (default: localhost)", "localhost").option("-y, --yes", "Skip confirmation prompts").action(async (opts) => {
  console.log("");
  console.log(chalk.bold("Horus Connect"));
  console.log(chalk.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log("");
  const config = loadConfig();
  const runtimeSpinner = ora("Detecting runtime...").start();
  let runtime;
  try {
    runtime = await detectRuntime(config.runtime);
    runtimeSpinner.succeed(`Using ${chalk.cyan(runtime.name)}`);
  } catch (error) {
    runtimeSpinner.fail("No container runtime found");
    console.log(error.message);
    process.exit(1);
  }
  const runningSpinner = ora("Checking Horus status...").start();
  const running = await runtime.isRunning();
  if (!running) {
    runningSpinner.fail("Horus is not running");
    console.log(chalk.dim("Run `horus up` first, then re-run `horus connect`."));
    process.exit(1);
  }
  runningSpinner.succeed("Horus is running");
  let targets = [];
  if (opts.target === "all") {
    targets = ["claude-desktop", "claude-code", "cursor"];
  } else if (opts.target) {
    const valid = ["claude-desktop", "claude-code", "cursor"];
    if (!valid.includes(opts.target)) {
      console.log(chalk.red(`Invalid target: ${opts.target}`));
      console.log(chalk.dim("Valid targets: claude-desktop, claude-code, cursor, all"));
      process.exit(1);
    }
    targets = [opts.target];
  } else {
    const detected = detectInstalledClients();
    if (detected.length === 0) {
      console.log(chalk.yellow("No supported clients detected (Claude Desktop, Claude Code, or Cursor)."));
      console.log(chalk.dim("Use --target to specify a client manually."));
      process.exit(1);
    }
    if (opts.yes) {
      targets = detected;
      console.log(`Detected clients: ${detected.map((t) => chalk.cyan(t)).join(", ")}`);
    } else {
      const chosen = await checkbox({
        message: "Select clients to configure:",
        choices: detected.map((t) => ({ name: t, value: t, checked: true })),
        validate: (input2) => input2.length > 0 ? true : "Select at least one client."
      });
      targets = chosen;
    }
  }
  if (targets.length === 0) {
    console.log(chalk.yellow("No clients selected. Exiting."));
    return;
  }
  await runConnect(config, runtime, targets, opts.host);
});

// src/commands/setup.ts
function injectToken(url, token) {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    parsed.username = "oauth2";
    parsed.password = token;
    return parsed.toString();
  } catch {
    return url;
  }
}
var setupCommand = new Command2("setup").description("Interactive first-run setup for Horus").option("-y, --yes", "Non-interactive mode (use defaults + env vars)").option("--runtime <runtime>", "Container runtime to use: docker or podman (non-interactive only)").option("--data-dir <path>", "Data directory path").option("--repos-path <path>", "Host repos path for Forge scanning").option("--git-host <host>", "Git server hostname (e.g., github.com, gitlab.corp.com)").option("--anvil-repo <url>", "Anvil notes repository URL").option("--vault-repo <url>", "Vault knowledge-base repository URL").option("--forge-repo <url>", "Forge registry repository URL").option("--github-token <token>", "GitHub personal access token for private repos").action(async (opts) => {
  console.log("");
  console.log(chalk2.bold("Horus Setup"));
  console.log(chalk2.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log("");
  if (configExists()) {
    if (opts.yes) {
      console.log(chalk2.yellow("Existing configuration found. Overwriting in non-interactive mode."));
    } else {
      const proceed = await confirm({
        message: "Horus is already configured. Reconfigure?",
        default: false
      });
      if (!proceed) {
        console.log(chalk2.dim("Setup cancelled."));
        return;
      }
    }
  }
  const checkSpinner = ora2("Checking for container runtimes...").start();
  const [hasDocker, hasPodman] = await Promise.all([
    checkRuntime("docker"),
    checkRuntime("podman")
  ]);
  checkSpinner.stop();
  const available = [
    ...hasDocker ? ["docker"] : [],
    ...hasPodman ? ["podman"] : []
  ];
  if (available.length === 0) {
    console.log(chalk2.red("No container runtime found."));
    console.log("");
    console.log("Horus requires Docker or Podman with the Compose plugin.");
    console.log("");
    console.log("Install one of:");
    console.log("  Docker Desktop: https://www.docker.com/products/docker-desktop/");
    console.log("  Podman Desktop: https://podman-desktop.io/");
    process.exit(1);
  }
  let selectedRuntime;
  if (opts.yes) {
    const requested = opts.runtime;
    if (requested && !available.includes(requested)) {
      console.log(chalk2.red(`Requested runtime "${requested}" is not installed.`));
      console.log(chalk2.dim(`Available: ${available.join(", ")}`));
      process.exit(1);
    }
    selectedRuntime = requested ?? available[0];
    console.log(`Using ${chalk2.cyan(selectedRuntime)}`);
  } else {
    selectedRuntime = await select({
      message: "Which container runtime would you like to use?",
      choices: available.map((r) => ({
        value: r,
        name: r === "docker" ? "Docker" : "Podman"
      }))
    });
  }
  const runtime = await detectRuntime(selectedRuntime);
  let config;
  if (opts.yes) {
    const defaults = defaultConfig();
    config = {
      ...defaults,
      runtime: runtime.name,
      data_dir: opts.dataDir || DEFAULT_DATA_DIR,
      host_repos_path: opts.reposPath || "",
      git_host: opts.gitHost || defaults.git_host,
      repos: {
        anvil_notes: opts.anvilRepo || process.env.ANVIL_REPO_URL || defaults.repos.anvil_notes,
        vault_knowledge: opts.vaultRepo || process.env.VAULT_KNOWLEDGE_REPO_URL || defaults.repos.vault_knowledge,
        forge_registry: opts.forgeRepo || process.env.FORGE_REGISTRY_REPO_URL || defaults.repos.forge_registry
      },
      github_token: opts.githubToken || process.env.GITHUB_TOKEN || ""
    };
  } else {
    const data_dir = await input({
      message: "Data directory:",
      default: DEFAULT_DATA_DIR
    });
    const host_repos_path = await input({
      message: "Host repos path (for Forge repo scanning, leave empty to skip):",
      default: ""
    });
    const host_repos_extra_scan_dirs = [];
    const customize_ports = await confirm({
      message: "Customize port assignments?",
      default: false
    });
    let ports = { ...DEFAULT_PORTS };
    if (customize_ports) {
      const anvil = await number({
        message: "Anvil port:",
        default: DEFAULT_PORTS.anvil
      });
      const vault_rest = await number({
        message: "Vault REST port:",
        default: DEFAULT_PORTS.vault_rest
      });
      const vault_mcp = await number({
        message: "Vault MCP port:",
        default: DEFAULT_PORTS.vault_mcp
      });
      const forge = await number({
        message: "Forge port:",
        default: DEFAULT_PORTS.forge
      });
      ports = {
        anvil: anvil ?? DEFAULT_PORTS.anvil,
        vault_rest: vault_rest ?? DEFAULT_PORTS.vault_rest,
        vault_mcp: vault_mcp ?? DEFAULT_PORTS.vault_mcp,
        forge: forge ?? DEFAULT_PORTS.forge
      };
    }
    console.log("");
    console.log(chalk2.bold("Repository Configuration"));
    console.log(chalk2.dim("Horus stores notes and knowledge in Git repos you own."));
    console.log(chalk2.dim("Create empty repos on your Git server, then paste the URLs below."));
    console.log("");
    console.log(chalk2.yellow("  Use HTTPS URLs \u2014 container services do not have SSH keys."));
    console.log(chalk2.dim("  SSH URLs (git@github.com:...) will fail at runtime inside Docker/Podman."));
    console.log("");
    const git_host = await input({
      message: "Git server hostname:",
      default: "github.com"
    });
    const host = git_host.trim();
    const example = (repo) => chalk2.dim(`  e.g., https://${host}/<owner>/${repo}`);
    console.log("");
    const anvil_notes = await input({
      message: `Anvil notes repo URL:
${example("horus-notes")}
`,
      validate: (v) => v.trim().length > 0 || "Anvil needs a notes repo to store your data."
    });
    const vault_knowledge = await input({
      message: `Vault knowledge-base repo URL:
${example("knowledge-base")}
`,
      validate: (v) => v.trim().length > 0 || "Vault needs a knowledge-base repo."
    });
    const forge_registry = await input({
      message: `Forge registry repo URL:
${example("forge-registry")}
`,
      validate: (v) => v.trim().length > 0 || "Forge needs a registry repo."
    });
    console.log("");
    console.log(chalk2.bold("Authentication"));
    console.log(chalk2.dim("A personal access token is required for private repositories."));
    console.log("");
    const github_token = await password({
      message: "GitHub personal access token (leave empty to skip):",
      mask: "*"
    });
    config = {
      ...defaultConfig(),
      data_dir,
      host_repos_path,
      host_repos_extra_scan_dirs,
      runtime: runtime.name,
      ports,
      git_host: git_host.trim(),
      repos: {
        anvil_notes: anvil_notes.trim(),
        vault_knowledge: vault_knowledge.trim(),
        forge_registry: forge_registry.trim()
      },
      github_token: github_token.trim()
    };
  }
  const configSpinner = ora2("Saving configuration...").start();
  try {
    saveConfig(config);
    configSpinner.succeed("Configuration saved to ~/.horus/config.yaml");
  } catch (error) {
    configSpinner.fail("Failed to save configuration");
    console.error(error.message);
    process.exit(1);
  }
  const envSpinner = ora2("Generating .env file...").start();
  try {
    writeEnvFile(config);
    envSpinner.succeed("Environment file written to ~/.horus/.env");
  } catch (error) {
    envSpinner.fail("Failed to generate .env");
    console.error(error.message);
    process.exit(1);
  }
  const composeSpinner = ora2("Installing docker-compose.yml...").start();
  try {
    installComposeFile(runtime.name);
    composeSpinner.succeed("Compose file installed to ~/.horus/docker-compose.yml");
  } catch (error) {
    composeSpinner.fail("Failed to install compose file");
    console.error(error.message);
    process.exit(1);
  }
  const dataDir = resolvePath(config.data_dir);
  const reposToClone = [
    { url: config.repos.anvil_notes, dest: join4(dataDir, "notes"), label: "Anvil notes" },
    { url: config.repos.vault_knowledge, dest: join4(dataDir, "knowledge-base"), label: "Vault knowledge-base" },
    { url: config.repos.forge_registry, dest: join4(dataDir, "registry"), label: "Forge registry" }
  ].filter((r) => r.url);
  if (reposToClone.length > 0) {
    console.log("");
    console.log(chalk2.bold("Cloning repositories..."));
    mkdirSync3(dataDir, { recursive: true });
    for (const repo of reposToClone) {
      const spinner = ora2(`Cloning ${repo.label}...`).start();
      if (existsSync5(join4(repo.dest, ".git"))) {
        spinner.succeed(`${repo.label} already cloned`);
        continue;
      }
      try {
        mkdirSync3(repo.dest, { recursive: true });
        const cloneUrl = injectToken(repo.url, config.github_token);
        execSync(`git clone "${cloneUrl}" "${repo.dest}"`, {
          stdio: "pipe",
          timeout: 6e4
        });
        spinner.succeed(`${repo.label} cloned`);
      } catch (error) {
        spinner.fail(`Failed to clone ${repo.label}`);
        const msg = error.message || "";
        if (msg.includes("already exists and is not an empty directory")) {
          console.log(chalk2.dim("  Directory exists but has no .git \u2014 check the path."));
        } else {
          console.log(chalk2.dim(`  ${msg.split("\n")[0]}`));
        }
        console.log(chalk2.dim(`  URL: ${repo.url}`));
        if (!config.github_token) {
          console.log(chalk2.dim("  Tip: Re-run setup and provide a GitHub token if the repo is private."));
        }
        process.exit(1);
      }
    }
  }
  console.log("");
  console.log(chalk2.bold("Pulling container images..."));
  try {
    await composeStreaming(runtime, ["pull", "--ignore-pull-failures"]);
  } catch {
    console.log(chalk2.yellow("Some images could not be pulled."));
    console.log(chalk2.dim("Continuing \u2014 services will be built from source if build contexts are available."));
  }
  console.log("");
  console.log(chalk2.bold("Starting Horus services..."));
  try {
    await composeStreaming(runtime, ["up", "-d"]);
  } catch (error) {
    console.log(chalk2.red("Failed to start services."));
    console.log(chalk2.dim(error.message));
    process.exit(1);
  }
  console.log("");
  const healthSpinner = ora2("Waiting for services to become healthy...").start();
  let lastStates = [];
  try {
    const states = await pollUntilHealthy(
      runtime,
      (current) => {
        lastStates = current;
        const summary = current.map((s) => {
          const icon = s.status === "healthy" ? chalk2.green("*") : s.status === "starting" ? chalk2.yellow("~") : chalk2.red("x");
          return `${icon} ${s.name}`;
        }).join("  ");
        healthSpinner.text = `Waiting for services...  ${summary}`;
      },
      6e5,
      5e3
    );
    healthSpinner.succeed("All services are healthy");
    lastStates = states;
  } catch (error) {
    healthSpinner.fail("Some services did not become healthy");
    console.log(chalk2.dim(error.message));
    console.log("");
    console.log(chalk2.dim("Tip: Check logs with `docker compose logs` from ~/.horus/"));
    process.exit(1);
  }
  console.log("");
  const detectedClients = detectInstalledClients();
  if (detectedClients.length > 0) {
    console.log(chalk2.bold("Configuring AI clients..."));
    try {
      await runConnect(config, runtime, detectedClients, "localhost");
    } catch (error) {
      console.log(chalk2.yellow("Could not configure AI clients automatically."));
      console.log(chalk2.dim(`Run ${chalk2.cyan("horus connect")} to configure them manually.`));
    }
  } else {
    console.log(chalk2.dim(`No AI clients detected. Run ${chalk2.cyan("horus connect")} after installing Claude Desktop, Claude Code, or Cursor.`));
  }
  console.log("");
  console.log(chalk2.bold.green("Setup complete!"));
  console.log(chalk2.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log("");
  console.log(`  ${chalk2.bold("Runtime:")}    ${runtime.name}`);
  console.log(`  ${chalk2.bold("Config:")}     ~/.horus/config.yaml`);
  console.log(`  ${chalk2.bold("Data:")}       ${config.data_dir}`);
  console.log("");
  console.log(chalk2.bold("  Service URLs:"));
  console.log(`    Anvil:      http://localhost:${config.ports.anvil}`);
  console.log(`    Vault REST: http://localhost:${config.ports.vault_rest}`);
  console.log(`    Vault MCP:  http://localhost:${config.ports.vault_mcp}`);
  console.log(`    Forge:      http://localhost:${config.ports.forge}`);
  console.log("");
});

// src/commands/up.ts
import { Command as Command3 } from "commander";
import chalk3 from "chalk";
import ora3 from "ora";
var upCommand = new Command3("up").description("Start the Horus stack").option("--no-pull", "Skip pulling latest images before starting").action(async (opts) => {
  if (!configExists() || !composeFileExists()) {
    console.log(chalk3.red("Horus is not set up yet."));
    console.log(chalk3.dim("Run `horus setup` first."));
    process.exit(1);
  }
  const config = loadConfig();
  const spinner = ora3("Detecting runtime...").start();
  let runtime;
  try {
    runtime = await detectRuntime(config.runtime);
    spinner.succeed(`Using ${chalk3.cyan(runtime.name)}`);
  } catch (error) {
    spinner.fail("No container runtime found");
    console.log(error.message);
    process.exit(1);
  }
  if (opts.pull) {
    const pullSpinner = ora3("Pulling latest images...").start();
    try {
      await composeStreaming(runtime, ["pull", "--ignore-pull-failures"]);
      pullSpinner.succeed("Images up to date");
    } catch {
      pullSpinner.warn("Could not pull images, using cached");
    }
  }
  console.log("");
  console.log(chalk3.bold("Starting Horus services..."));
  try {
    await composeStreaming(runtime, ["up", "-d"]);
  } catch (error) {
    console.log(chalk3.red("Failed to start services."));
    console.log(chalk3.dim(error.message));
    process.exit(1);
  }
  console.log("");
  const statusSpinner = ora3("Checking service status...").start();
  try {
    const states = await checkAllHealth(runtime);
    statusSpinner.stop();
    console.log(chalk3.bold("Service Status:"));
    for (const s of states) {
      const color = s.status === "healthy" ? chalk3.green : s.status === "starting" ? chalk3.yellow : chalk3.red;
      console.log(`  ${color(s.status.padEnd(10))} ${s.name}`);
    }
    const allHealthy = states.every((s) => s.status === "healthy");
    if (!allHealthy) {
      console.log("");
      console.log(
        chalk3.yellow("Some services are still starting. Run `horus status` to check progress.")
      );
    }
  } catch {
    statusSpinner.warn("Could not check service status");
  }
  console.log("");
});

// src/commands/down.ts
import { Command as Command4 } from "commander";
import chalk4 from "chalk";
import ora4 from "ora";
var downCommand = new Command4("down").description("Stop the Horus stack").action(async () => {
  if (!configExists() || !composeFileExists()) {
    console.log(chalk4.red("Horus is not set up yet."));
    console.log(chalk4.dim("Run `horus setup` first."));
    process.exit(1);
  }
  const config = loadConfig();
  const spinner = ora4("Detecting runtime...").start();
  let runtime;
  try {
    runtime = await detectRuntime(config.runtime);
    spinner.succeed(`Using ${chalk4.cyan(runtime.name)}`);
  } catch (error) {
    spinner.fail("No container runtime found");
    console.log(error.message);
    process.exit(1);
  }
  console.log("");
  console.log(chalk4.bold("Stopping Horus services..."));
  try {
    await composeStreaming(runtime, ["down"]);
  } catch (error) {
    console.log(chalk4.red("Failed to stop services."));
    console.log(chalk4.dim(error.message));
    process.exit(1);
  }
  console.log("");
  console.log(chalk4.green("All services stopped."));
  console.log(chalk4.dim("Data volumes have been preserved. Run `horus up` to restart."));
  console.log("");
});

// src/commands/status.ts
import { Command as Command5 } from "commander";
import chalk5 from "chalk";
import ora5 from "ora";
var statusCommand = new Command5("status").description("Show status of Horus services").action(async () => {
  if (!configExists() || !composeFileExists()) {
    console.log(chalk5.red("Horus is not set up yet."));
    console.log(chalk5.dim("Run `horus setup` first."));
    process.exit(1);
  }
  const config = loadConfig();
  const spinner = ora5("Checking services...").start();
  let runtime;
  try {
    runtime = await detectRuntime(config.runtime);
  } catch (error) {
    spinner.fail("No container runtime found");
    console.log(error.message);
    process.exit(1);
    return;
  }
  let containers = [];
  try {
    const result = await runtime.compose("ps", "--format", "json");
    containers = parseComposeJson(result.stdout);
  } catch {
  }
  spinner.stop();
  console.log("");
  console.log(chalk5.bold("Horus Status"));
  console.log(chalk5.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(`  ${chalk5.bold("Version:")}  ${CLI_VERSION}`);
  console.log(`  ${chalk5.bold("Runtime:")}  ${runtime.name}`);
  console.log(`  ${chalk5.bold("Config:")}   ~/.horus/config.yaml`);
  console.log("");
  if (containers.length === 0) {
    console.log(chalk5.yellow("  No services are running."));
    console.log(chalk5.dim("  Run `horus up` to start the stack."));
    console.log("");
    return;
  }
  const header = `  ${pad("SERVICE", 14)} ${pad("STATUS", 12)} ${pad("PORTS", 20)} ${pad("UPTIME", 20)}`;
  console.log(chalk5.bold(header));
  console.log(chalk5.dim("  " + "\u2500".repeat(66)));
  for (const service of SERVICES) {
    const container = containers.find(
      (c) => c.Service === service || c.Name?.includes(service)
    );
    if (!container) {
      console.log(
        `  ${pad(service, 14)} ${chalk5.red(pad("stopped", 12))} ${pad("-", 20)} ${pad("-", 20)}`
      );
      continue;
    }
    const healthStatus = container.Health || container.State || "unknown";
    const statusColor = getStatusColor(healthStatus);
    const displayStatus = statusColor(pad(healthStatus, 12));
    const ports = formatPorts(container.Publishers);
    const uptime = extractUptime(container.Status);
    console.log(`  ${pad(service, 14)} ${displayStatus} ${pad(ports, 20)} ${pad(uptime, 20)}`);
  }
  console.log("");
});
function pad(str, width) {
  return str.padEnd(width);
}
function getStatusColor(status) {
  const lower = status.toLowerCase();
  if (lower === "healthy" || lower === "running") return chalk5.green;
  if (lower === "starting") return chalk5.yellow;
  return chalk5.red;
}
function formatPorts(publishers) {
  if (!publishers || publishers.length === 0) return "-";
  const mapped = publishers.filter((p) => p.PublishedPort > 0).map((p) => `${p.PublishedPort}:${p.TargetPort}`).filter((v, i, a) => a.indexOf(v) === i);
  return mapped.length > 0 ? mapped.join(", ") : "-";
}
function extractUptime(status) {
  if (!status) return "-";
  const match = status.match(/^Up\s+(.+?)(?:\s*\(.*\))?$/i);
  if (match) return match[1].trim();
  return status;
}

// src/commands/config.ts
import { Command as Command6 } from "commander";
import chalk6 from "chalk";
import { confirm as confirm2 } from "@inquirer/prompts";
var configCommand = new Command6("config").description("View or modify Horus configuration").action(async () => {
  if (!configExists()) {
    console.log(chalk6.red("Horus is not configured yet."));
    console.log(chalk6.dim("Run `horus setup` first."));
    process.exit(1);
  }
  const config = loadConfig();
  console.log("");
  console.log(chalk6.bold("Horus Configuration"));
  console.log(chalk6.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(`  ${chalk6.bold("version:")}          ${config.version}`);
  console.log(`  ${chalk6.bold("data-dir:")}         ${config.data_dir}`);
  console.log(`  ${chalk6.bold("runtime:")}          ${config.runtime}`);
  console.log(`  ${chalk6.bold("host-repos-path:")}             ${config.host_repos_path || chalk6.dim("(not set)")}`);
  const extraDirs = (config.host_repos_extra_scan_dirs ?? []).join(", ");
  console.log(`  ${chalk6.bold("host-repos-extra-scan-dirs:")}  ${extraDirs || chalk6.dim("(not set)")}`);
  console.log(`  ${chalk6.bold("git-host:")}                    ${config.git_host || chalk6.dim("(not set)")}`);
  console.log(`  ${chalk6.bold("github-token:")}     ${config.github_token ? maskApiKey(config.github_token) : chalk6.dim("(not set)")}`);
  console.log("");
  console.log(chalk6.bold("  Ports:"));
  console.log(`    ${chalk6.bold("anvil:")}       ${config.ports.anvil}`);
  console.log(`    ${chalk6.bold("vault-rest:")}  ${config.ports.vault_rest}`);
  console.log(`    ${chalk6.bold("vault-mcp:")}   ${config.ports.vault_mcp}`);
  console.log(`    ${chalk6.bold("forge:")}       ${config.ports.forge}`);
  console.log("");
  console.log(chalk6.bold("  Repos:"));
  console.log(`    ${chalk6.bold("anvil-notes:")}      ${config.repos.anvil_notes || chalk6.dim("(not set)")}`);
  console.log(`    ${chalk6.bold("vault-knowledge:")}  ${config.repos.vault_knowledge || chalk6.dim("(not set)")}`);
  console.log(`    ${chalk6.bold("forge-registry:")}   ${config.repos.forge_registry || chalk6.dim("(not set)")}`);
  console.log("");
  console.log(chalk6.dim(`  Config file: ~/.horus/config.yaml`));
  console.log(chalk6.dim(`  Use 'horus config get <key>' or 'horus config set <key> <value>'`));
  console.log("");
});
configCommand.command("get <key>").description("Get a configuration value").action(async (key) => {
  if (!configExists()) {
    console.log(chalk6.red("Horus is not configured yet."));
    console.log(chalk6.dim("Run `horus setup` first."));
    process.exit(1);
  }
  if (!isValidKey(key)) {
    console.log(chalk6.red(`Unknown config key: ${key}`));
    console.log(chalk6.dim(`Valid keys: ${CONFIG_KEYS.join(", ")}`));
    process.exit(1);
  }
  const config = loadConfig();
  const value = getConfigValue(config, key);
  if (key === "github-token") {
    console.log(maskApiKey(value));
  } else {
    console.log(value || "");
  }
});
configCommand.command("set <key> <value>").description("Set a configuration value").action(async (key, value) => {
  if (!configExists()) {
    console.log(chalk6.red("Horus is not configured yet."));
    console.log(chalk6.dim("Run `horus setup` first."));
    process.exit(1);
  }
  if (!isValidKey(key)) {
    console.log(chalk6.red(`Unknown config key: ${key}`));
    console.log(chalk6.dim(`Valid keys: ${CONFIG_KEYS.join(", ")}`));
    process.exit(1);
  }
  let config = loadConfig();
  try {
    config = setConfigValue(config, key, value);
  } catch (error) {
    console.log(chalk6.red(error.message));
    process.exit(1);
  }
  saveConfig(config);
  writeEnvFile(config);
  console.log(chalk6.green(`Set ${key} and regenerated .env file.`));
  const needsRestart = [
    "data-dir",
    "host-repos-path",
    "host-repos-extra-scan-dirs",
    "runtime",
    "port.anvil",
    "port.vault-rest",
    "port.vault-mcp",
    "port.forge"
  ];
  if (needsRestart.includes(key)) {
    console.log(chalk6.yellow("Restart required for changes to take effect."));
    if (process.stdin.isTTY) {
      const restart = await confirm2({
        message: "Restart Horus now?",
        default: false
      });
      if (restart) {
        console.log(chalk6.dim("Run `horus down && horus up` to restart."));
      }
    } else {
      console.log(chalk6.dim("Run `horus down && horus up` to restart."));
    }
  }
});
function isValidKey(key) {
  return CONFIG_KEYS.includes(key);
}

// src/commands/update.ts
import { Command as Command7 } from "commander";
import chalk7 from "chalk";
import ora6 from "ora";
import { select as select2, confirm as confirm3 } from "@inquirer/prompts";
import { readFileSync as readFileSync5, writeFileSync as writeFileSync4, mkdirSync as mkdirSync4, readdirSync as readdirSync2, existsSync as existsSync6 } from "fs";
import { join as join5 } from "path";
import { createHash } from "crypto";
import { stringify as stringifyYaml2, parse as parseYaml2 } from "yaml";
var SNAPSHOTS_DIR = join5(HORUS_DIR, "snapshots");
function ensureSnapshotsDir() {
  mkdirSync4(SNAPSHOTS_DIR, { recursive: true });
}
function composeFileHash() {
  if (!existsSync6(COMPOSE_PATH)) return "";
  const content = readFileSync5(COMPOSE_PATH, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}
async function captureCurrentImages(runtime) {
  const images = {};
  try {
    const result = await runtime.compose("images", "--format", "json");
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const service = obj.Service ?? "";
        const tag = obj.Tag ?? obj.Image ?? "unknown";
        if (service) images[service] = tag;
      } catch {
      }
    }
  } catch {
  }
  return images;
}
function saveSnapshot(images) {
  ensureSnapshotsDir();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const snapshot = {
    timestamp,
    images,
    compose_hash: composeFileHash()
  };
  const filePath = join5(SNAPSHOTS_DIR, `${timestamp}.yaml`);
  writeFileSync4(filePath, stringifyYaml2(snapshot, { lineWidth: 0 }), "utf-8");
  return filePath;
}
function listSnapshots() {
  if (!existsSync6(SNAPSHOTS_DIR)) return [];
  return readdirSync2(SNAPSHOTS_DIR).filter((f) => f.endsWith(".yaml")).sort().reverse().map((f) => {
    const file = join5(SNAPSHOTS_DIR, f);
    const snapshot = parseYaml2(readFileSync5(file, "utf-8"));
    return { file, snapshot };
  });
}
async function fetchLatestVersion() {
  try {
    const res = await fetch("https://api.github.com/repos/Arjunkhera/Horus/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.tag_name ?? null;
  } catch {
    return null;
  }
}
var updateCommand = new Command7("update").description("Update Horus to the latest version").option("--rollback", "Roll back to the previous version").option("-y, --yes", "Skip confirmation prompts").action(async (opts) => {
  console.log("");
  console.log(chalk7.bold(opts.rollback ? "Horus Rollback" : "Horus Update"));
  console.log(chalk7.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log("");
  const config = loadConfig();
  const runtimeSpinner = ora6("Detecting runtime...").start();
  let runtime;
  try {
    runtime = await detectRuntime(config.runtime);
    runtimeSpinner.succeed(`Using ${chalk7.cyan(runtime.name)}`);
  } catch (error) {
    runtimeSpinner.fail("No container runtime found");
    console.log(error.message);
    process.exit(1);
  }
  if (opts.rollback) {
    const snapshots = listSnapshots();
    if (snapshots.length === 0) {
      console.log(chalk7.red("No snapshots found. Cannot roll back."));
      console.log(chalk7.dim(`Snapshots are stored in ${SNAPSHOTS_DIR}`));
      process.exit(1);
    }
    let snapshotToRestore;
    if (opts.yes) {
      snapshotToRestore = snapshots[0].snapshot;
      console.log(`Using most recent snapshot: ${chalk7.cyan(snapshotToRestore.timestamp)}`);
    } else {
      const choices = snapshots.map(({ snapshot }, i) => ({
        name: `${snapshot.timestamp}  (images: ${Object.keys(snapshot.images).length})`,
        value: i
      }));
      const idx = await select2({
        message: "Select snapshot to restore:",
        choices
      });
      snapshotToRestore = snapshots[idx].snapshot;
    }
    if (!opts.yes) {
      const confirmed = await confirm3({
        message: `Roll back to snapshot from ${snapshotToRestore.timestamp}? This will restart services.`,
        default: false
      });
      if (!confirmed) {
        console.log(chalk7.dim("Rollback cancelled."));
        return;
      }
    }
    const stopSpinner = ora6("Stopping services...").start();
    try {
      await composeStreaming(runtime, ["down"]);
      stopSpinner.succeed("Services stopped");
    } catch (error) {
      stopSpinner.fail("Failed to stop services");
      console.log(chalk7.dim(error.message));
      process.exit(1);
    }
    console.log("");
    console.log(chalk7.bold("Restarting from snapshot (using cached images)..."));
    try {
      await composeStreaming(runtime, ["up", "-d"]);
    } catch (error) {
      console.log(chalk7.red("Failed to restart services."));
      console.log(chalk7.dim(error.message));
      process.exit(1);
    }
    console.log("");
    const healthSpinner2 = ora6("Waiting for services to become healthy...").start();
    try {
      await pollUntilHealthy(
        runtime,
        (current) => {
          const summary = current.map((s) => {
            const icon = s.status === "healthy" ? chalk7.green("*") : s.status === "starting" ? chalk7.yellow("~") : chalk7.red("x");
            return `${icon} ${s.name}`;
          }).join("  ");
          healthSpinner2.text = `Waiting...  ${summary}`;
        },
        3e5,
        5e3
      );
      healthSpinner2.succeed("All services healthy after rollback");
    } catch (error) {
      healthSpinner2.fail("Some services did not become healthy");
      console.log(chalk7.dim(error.message));
      process.exit(1);
    }
    console.log("");
    console.log(chalk7.bold.green("Rollback complete!"));
    console.log("");
    return;
  }
  const versionSpinner = ora6("Checking for updates...").start();
  const [currentImages, latestVersion] = await Promise.all([
    captureCurrentImages(runtime),
    fetchLatestVersion()
  ]);
  versionSpinner.stop();
  if (latestVersion) {
    console.log(`  Latest release: ${chalk7.cyan(latestVersion)}`);
  } else {
    console.log(chalk7.dim("  Could not reach GitHub to check latest version."));
  }
  console.log("");
  console.log(chalk7.dim("  Note: this updates the Horus container services only."));
  console.log(chalk7.dim("  To update the Horus CLI itself, run:"));
  console.log(`    ${chalk7.cyan("npm install -g @arkhera30/cli@latest")}`);
  console.log("");
  if (!opts.yes) {
    const confirmed = await confirm3({
      message: "Pull latest images and restart services?",
      default: true
    });
    if (!confirmed) {
      console.log(chalk7.dim("Update cancelled."));
      return;
    }
  }
  const snapshotSpinner = ora6("Saving pre-update snapshot...").start();
  let snapshotPath = "";
  try {
    snapshotPath = saveSnapshot(currentImages);
    snapshotSpinner.succeed(`Snapshot saved: ${chalk7.dim(snapshotPath)}`);
  } catch (error) {
    snapshotSpinner.warn("Could not save snapshot (update will proceed)");
    console.log(chalk7.dim(error.message));
  }
  console.log("");
  console.log(chalk7.bold("Pulling latest images..."));
  try {
    await composeStreaming(runtime, ["pull", "--ignore-pull-failures"]);
  } catch {
    console.log(chalk7.yellow("Some images could not be pulled."));
    console.log(chalk7.dim("Continuing \u2014 services will be built from source if build contexts are available."));
  }
  console.log("");
  console.log(chalk7.bold("Restarting services..."));
  try {
    await composeStreaming(runtime, ["up", "-d"]);
  } catch (error) {
    console.log(chalk7.red("Failed to restart services."));
    console.log(chalk7.dim(error.message));
    process.exit(1);
  }
  console.log("");
  const healthSpinner = ora6("Waiting for services to become healthy...").start();
  let finalStates = [];
  try {
    finalStates = await pollUntilHealthy(
      runtime,
      (current) => {
        const summary = current.map((s) => {
          const icon = s.status === "healthy" ? chalk7.green("*") : s.status === "starting" ? chalk7.yellow("~") : chalk7.red("x");
          return `${icon} ${s.name}`;
        }).join("  ");
        healthSpinner.text = `Waiting for services...  ${summary}`;
      },
      3e5,
      5e3
    );
    healthSpinner.succeed("All services healthy");
  } catch (error) {
    healthSpinner.fail("Some services did not become healthy");
    console.log(chalk7.dim(error.message));
    console.log("");
    console.log(chalk7.dim(`Tip: Roll back with \`horus update --rollback\``));
    process.exit(1);
  }
  console.log("");
  console.log(chalk7.bold.green("Update complete!"));
  console.log(chalk7.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  if (latestVersion) {
    console.log(`  ${chalk7.bold("Version:")}  ${latestVersion}`);
  }
  console.log("");
  console.log(chalk7.bold("  Service Status:"));
  for (const s of finalStates) {
    const color = s.status === "healthy" ? chalk7.green : s.status === "starting" ? chalk7.yellow : chalk7.red;
    console.log(`    ${color(s.status.padEnd(10))} ${s.name}`);
  }
  if (snapshotPath) {
    console.log("");
    console.log(chalk7.dim(`  Snapshot saved for rollback: ${snapshotPath}`));
    console.log(chalk7.dim("  Run `horus update --rollback` to revert if needed."));
  }
  console.log("");
});

// src/commands/doctor.ts
import { Command as Command8 } from "commander";
import chalk8 from "chalk";
import { execSync as execSync2 } from "child_process";
import { existsSync as existsSync7, accessSync, statfsSync, constants } from "fs";
import { join as join6 } from "path";
function symbol(status) {
  switch (status) {
    case "pass":
      return chalk8.green("  \u2713 ");
    case "warn":
      return chalk8.yellow("  \u26A0 ");
    case "fail":
      return chalk8.red("  \u2717 ");
  }
}
function colorMessage(status, msg) {
  switch (status) {
    case "pass":
      return chalk8.white(msg);
    case "warn":
      return chalk8.yellow(msg);
    case "fail":
      return chalk8.red(msg);
  }
}
async function checkRuntimeAvailability(preferred) {
  const order = preferred === "podman" ? ["podman", "docker"] : ["docker", "podman"];
  for (const rt of order) {
    try {
      execSync2(`${rt} info`, { stdio: "ignore" });
      return { status: "pass", label: "Runtime", message: `${rt === "docker" ? "Docker" : "Podman"} is running` };
    } catch {
    }
  }
  return {
    status: "fail",
    label: "Runtime",
    message: "Docker/Podman is not running",
    hint: "Start Docker Desktop or Podman Desktop"
  };
}
async function checkCompose(preferred) {
  const order = preferred === "podman" ? ["podman", "docker"] : ["docker", "podman"];
  for (const rt of order) {
    try {
      execSync2(`${rt} compose version`, { stdio: "ignore" });
      const label = rt === "podman" ? "Compose plugin available (podman)" : "Compose plugin available";
      return { status: "pass", label: "Compose", message: label };
    } catch {
    }
  }
  return {
    status: "fail",
    label: "Compose",
    message: "Compose plugin not found",
    hint: "Install Docker Compose plugin or podman-compose"
  };
}
function checkConfig() {
  if (configExists()) {
    return { status: "pass", label: "Config", message: "Configuration file exists (~/.horus/config.yaml)" };
  }
  return {
    status: "fail",
    label: "Config",
    message: "Configuration file missing (~/.horus/config.yaml)",
    hint: "Run `horus setup` to create the configuration"
  };
}
function checkComposeFile() {
  if (existsSync7(COMPOSE_PATH)) {
    return { status: "pass", label: "Compose file", message: "Compose file installed (~/.horus/docker-compose.yml)" };
  }
  return {
    status: "fail",
    label: "Compose file",
    message: "Compose file missing (~/.horus/docker-compose.yml)",
    hint: "Run `horus setup` to install the compose file"
  };
}
function checkPort(port, serviceName) {
  try {
    const output = execSync2(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null || true`, {
      encoding: "utf-8"
    }).trim();
    if (!output) {
      return { status: "pass", label: `Port ${port}`, message: `Port ${port} is free (${serviceName})` };
    }
    const pids = output.split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        const cmdline = execSync2(`ps -p ${pid} -o comm= 2>/dev/null || true`, {
          encoding: "utf-8"
        }).trim();
        if (cmdline.toLowerCase().includes("docker") || cmdline.toLowerCase().includes("podman")) {
          return { status: "pass", label: `Port ${port}`, message: `Port ${port} in use by Horus (${serviceName})` };
        }
      } catch {
      }
    }
    return {
      status: "warn",
      label: `Port ${port}`,
      message: `Port ${port} in use by another process (${serviceName} needs port ${port})`,
      hint: `Change the port with \`horus config set port.${serviceName.toLowerCase()} <port>\``
    };
  } catch {
    return { status: "pass", label: `Port ${port}`, message: `Port ${port} status unknown` };
  }
}
function checkDataDir(dataDir) {
  if (!existsSync7(dataDir)) {
    return {
      status: "warn",
      label: "Data directory",
      message: `Data directory does not exist: ${dataDir}`,
      hint: "It will be created automatically when Horus starts"
    };
  }
  try {
    accessSync(dataDir, constants.W_OK);
    return { status: "pass", label: "Data directory", message: `Data directory exists and is writable (${dataDir})` };
  } catch {
    return {
      status: "fail",
      label: "Data directory",
      message: `Data directory is not writable: ${dataDir}`,
      hint: `Run: chmod u+w "${dataDir}"`
    };
  }
}
function checkDiskSpace(dataDir) {
  const checkDir = existsSync7(dataDir) ? dataDir : join6(dataDir, "..");
  try {
    const stats = statfsSync(checkDir);
    const freeBytes = stats.bfree * stats.bsize;
    const freeGB = freeBytes / 1024 ** 3;
    const freeGBStr = freeGB.toFixed(1);
    const MIN_GB = 5;
    if (freeGB >= MIN_GB) {
      return { status: "pass", label: "Disk space", message: `Disk space: ${freeGBStr}GB available` };
    }
    return {
      status: "warn",
      label: "Disk space",
      message: `Disk space low: only ${freeGBStr}GB available (5GB recommended; QMD models take ~2GB)`,
      hint: "Free up disk space before running Horus"
    };
  } catch {
    return { status: "warn", label: "Disk space", message: "Could not check available disk space" };
  }
}
async function checkServices(runtime) {
  const results = [];
  try {
    const psResult = await runtime.compose("ps", "--format", "json");
    const containers = parseComposeJson(psResult.stdout);
    if (containers.length === 0) {
      return [
        {
          status: "warn",
          label: "Services",
          message: "No services are running",
          hint: "Run `horus up` to start the stack"
        }
      ];
    }
    for (const c of containers) {
      const name = c.Service ?? c.Name ?? "unknown";
      const health = (c.Health || c.State || "unknown").toLowerCase();
      if (health === "healthy" || health === "running" || health === "up") {
        results.push({ status: "pass", label: `Service: ${name}`, message: `${name} is ${health}` });
      } else if (health === "starting") {
        results.push({
          status: "warn",
          label: `Service: ${name}`,
          message: `${name} is still starting`,
          hint: "Wait a moment and re-run `horus doctor`"
        });
      } else {
        results.push({
          status: "fail",
          label: `Service: ${name}`,
          message: `${name} service is ${health}`,
          hint: `Run: horus logs ${name}`
        });
      }
    }
  } catch {
    results.push({
      status: "warn",
      label: "Services",
      message: "Could not check service status (stack may not be running)",
      hint: "Run `horus up` to start the stack"
    });
  }
  return results;
}
var doctorCommand = new Command8("doctor").description("Diagnose common Horus issues").action(async () => {
  console.log("");
  console.log(chalk8.bold("Horus Doctor"));
  console.log(chalk8.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  const allResults = [];
  const config = configExists() ? loadConfig() : null;
  allResults.push(await checkRuntimeAvailability(config?.runtime));
  allResults.push(await checkCompose(config?.runtime));
  allResults.push(checkConfig());
  allResults.push(checkComposeFile());
  const ports = config?.ports ?? DEFAULT_PORTS;
  const dataDir = config?.data_dir ?? join6(process.env.HOME ?? "~", ".horus", "data");
  allResults.push(checkPort(ports.anvil, "Anvil"));
  allResults.push(checkPort(ports.vault_rest, "Vault"));
  allResults.push(checkPort(ports.vault_mcp, "Vault MCP"));
  allResults.push(checkPort(ports.forge, "Forge"));
  allResults.push(checkDataDir(dataDir));
  allResults.push(checkDiskSpace(dataDir));
  const runtimeOk = allResults[0].status !== "fail";
  const composeOk = allResults[1].status !== "fail";
  if (runtimeOk && composeOk) {
    try {
      const runtime = await detectRuntime(config?.runtime);
      const serviceResults = await checkServices(runtime);
      allResults.push(...serviceResults);
    } catch {
      allResults.push({
        status: "warn",
        label: "Services",
        message: "Could not detect runtime to check services"
      });
    }
  }
  for (const result of allResults) {
    console.log(`${symbol(result.status)}${colorMessage(result.status, result.message)}`);
  }
  const errors = allResults.filter((r) => r.status === "fail");
  const warnings = allResults.filter((r) => r.status === "warn");
  console.log(chalk8.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  if (errors.length === 0 && warnings.length === 0) {
    console.log(chalk8.green("  All checks passed."));
  } else {
    const parts = [];
    if (errors.length > 0) parts.push(chalk8.red(`${errors.length} error${errors.length > 1 ? "s" : ""}`));
    if (warnings.length > 0) parts.push(chalk8.yellow(`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`));
    console.log(`  ${parts.join(", ")}`);
    const withHints = [...errors, ...warnings].filter((r) => r.hint);
    if (withHints.length > 0) {
      console.log("");
      for (const r of withHints) {
        const icon = r.status === "fail" ? chalk8.red("\u2717") : chalk8.yellow("\u26A0");
        console.log(`  ${icon} ${chalk8.dim(r.hint)}`);
      }
    }
  }
  console.log("");
  if (errors.length > 0) {
    process.exit(1);
  }
});

// src/commands/backup.ts
import { Command as Command9 } from "commander";
import chalk9 from "chalk";
import ora7 from "ora";
import { confirm as confirm4 } from "@inquirer/prompts";
import { mkdirSync as mkdirSync5, statSync as statSync2, existsSync as existsSync8, writeFileSync as writeFileSync5 } from "fs";
import { join as join7, basename } from "path";
import { execSync as execSync3 } from "child_process";
import { stringify as stringifyYaml3 } from "yaml";
var BACKUPS_DIR = join7(HORUS_DIR, "backups");
function ensureBackupsDir() {
  mkdirSync5(BACKUPS_DIR, { recursive: true });
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}
async function createBackup(yes) {
  console.log("");
  console.log(chalk9.bold("Horus Backup"));
  console.log(chalk9.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log("");
  const config = loadConfig();
  const runtimeSpinner = ora7("Detecting runtime...").start();
  let runtime;
  try {
    runtime = await detectRuntime(config.runtime);
    runtimeSpinner.succeed(`Using ${chalk9.cyan(runtime.name)}`);
  } catch (error) {
    runtimeSpinner.fail("No container runtime found");
    console.log(error.message);
    process.exit(1);
  }
  if (!yes) {
    const confirmed = await confirm4({
      message: "This will briefly stop services to create a consistent backup. Continue?",
      default: true
    });
    if (!confirmed) {
      console.log(chalk9.dim("Backup cancelled."));
      return;
    }
  }
  const stopSpinner = ora7("Stopping services...").start();
  try {
    await composeStreaming(runtime, ["stop"]);
    stopSpinner.succeed("Services stopped");
  } catch (error) {
    stopSpinner.fail("Failed to stop services");
    console.log(chalk9.dim(error.message));
    process.exit(1);
  }
  ensureBackupsDir();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const tarFile = join7(BACKUPS_DIR, `${timestamp}.tar.gz`);
  const metaFile = join7(BACKUPS_DIR, `${timestamp}.meta.yaml`);
  const backupSpinner = ora7("Creating backup archive...").start();
  try {
    execSync3(`tar -czf "${tarFile}" -C "${HORUS_DIR}" data/`, {
      stdio: "pipe"
    });
    backupSpinner.succeed(`Archive created: ${chalk9.dim(tarFile)}`);
  } catch (error) {
    backupSpinner.fail("Failed to create backup archive");
    console.log(chalk9.dim(error.message));
    await composeStreaming(runtime, ["start"]).catch(() => {
    });
    process.exit(1);
  }
  let sizeBytes = 0;
  try {
    sizeBytes = statSync2(tarFile).size;
  } catch {
  }
  const meta = {
    timestamp,
    data_dir: config.data_dir,
    version: config.version,
    size_bytes: sizeBytes
  };
  writeFileSync5(metaFile, stringifyYaml3(meta, { lineWidth: 0 }), "utf-8");
  const startSpinner = ora7("Restarting services...").start();
  try {
    await composeStreaming(runtime, ["start"]);
    startSpinner.succeed("Services restarted");
  } catch (error) {
    startSpinner.fail("Failed to restart services");
    console.log(chalk9.dim(error.message));
    console.log(chalk9.yellow("Run `horus up` to restart services manually."));
  }
  console.log("");
  console.log(chalk9.bold.green("Backup complete!"));
  console.log(chalk9.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log(`  ${chalk9.bold("File:")}  ${tarFile}`);
  console.log(`  ${chalk9.bold("Size:")}  ${formatBytes(sizeBytes)}`);
  console.log("");
  console.log(chalk9.dim("  Restore with: horus backup restore <file>"));
  console.log("");
}
async function restoreBackup(file, yes) {
  console.log("");
  console.log(chalk9.bold("Horus Restore"));
  console.log(chalk9.dim("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"));
  console.log("");
  if (!existsSync8(file)) {
    console.log(chalk9.red(`Backup file not found: ${file}`));
    process.exit(1);
  }
  const config = loadConfig();
  const runtimeSpinner = ora7("Detecting runtime...").start();
  let runtime;
  try {
    runtime = await detectRuntime(config.runtime);
    runtimeSpinner.succeed(`Using ${chalk9.cyan(runtime.name)}`);
  } catch (error) {
    runtimeSpinner.fail("No container runtime found");
    console.log(error.message);
    process.exit(1);
  }
  if (!yes) {
    console.log(chalk9.yellow(`  Warning: This will overwrite current data in ${config.data_dir}`));
    console.log("");
    const confirmed = await confirm4({
      message: `Restore from ${basename(file)}? Current data will be overwritten.`,
      default: false
    });
    if (!confirmed) {
      console.log(chalk9.dim("Restore cancelled."));
      return;
    }
  }
  const stopSpinner = ora7("Stopping services...").start();
  try {
    await composeStreaming(runtime, ["stop"]);
    stopSpinner.succeed("Services stopped");
  } catch (error) {
    stopSpinner.fail("Failed to stop services");
    console.log(chalk9.dim(error.message));
    process.exit(1);
  }
  const extractSpinner = ora7("Extracting backup...").start();
  try {
    execSync3(`tar -xzf "${file}" -C "${HORUS_DIR}/"`, { stdio: "pipe" });
    extractSpinner.succeed("Backup extracted");
  } catch (error) {
    extractSpinner.fail("Failed to extract backup");
    console.log(chalk9.dim(error.message));
    await composeStreaming(runtime, ["start"]).catch(() => {
    });
    process.exit(1);
  }
  console.log("");
  console.log(chalk9.bold("Starting services..."));
  try {
    await composeStreaming(runtime, ["start"]);
  } catch (error) {
    console.log(chalk9.red("Failed to start services."));
    console.log(chalk9.dim(error.message));
    process.exit(1);
  }
  console.log("");
  const healthSpinner = ora7("Waiting for services to become healthy...").start();
  try {
    await pollUntilHealthy(
      runtime,
      (current) => {
        const summary = current.map((s) => {
          const icon = s.status === "healthy" ? chalk9.green("*") : s.status === "starting" ? chalk9.yellow("~") : chalk9.red("x");
          return `${icon} ${s.name}`;
        }).join("  ");
        healthSpinner.text = `Waiting for services...  ${summary}`;
      },
      3e5,
      5e3
    );
    healthSpinner.succeed("All services healthy");
  } catch (error) {
    healthSpinner.fail("Some services did not become healthy");
    console.log(chalk9.dim(error.message));
    process.exit(1);
  }
  console.log("");
  console.log(chalk9.bold.green("Restore complete!"));
  console.log("");
}
var backupCommand = new Command9("backup").description("Backup or restore Horus data").option("-y, --yes", "Skip confirmation prompts").action(async (opts) => {
  await createBackup(opts.yes);
});
backupCommand.command("restore <file>").description("Restore Horus data from a backup file").option("-y, --yes", "Skip confirmation prompts").action(async (file, opts) => {
  await restoreBackup(file, opts.yes);
});

// src/index.ts
var program = new Command10();
program.name("horus").description("CLI for managing the Horus Docker Compose stack").version(CLI_VERSION);
program.addCommand(setupCommand);
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(statusCommand);
program.addCommand(configCommand);
program.addCommand(connectCommand);
program.addCommand(updateCommand);
program.addCommand(doctorCommand);
program.addCommand(backupCommand);
program.exitOverride();
try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
    process.exit(0);
  }
  if (error instanceof Error) {
    console.error(chalk10.red(`Error: ${error.message}`));
  } else {
    console.error(chalk10.red("An unexpected error occurred."));
  }
  process.exit(1);
}
