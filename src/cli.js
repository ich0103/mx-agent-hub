#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const templatesDir = path.join(repoRoot, "templates");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const defaultGithubRepository = "ich0103/mx-agent-hub";
const defaultRepoBranch = "main";
const updateCheckTtlMs = 6 * 60 * 60 * 1000;

const excludedDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
]);

const localAssetAttributes = ["src", "href"];
const assetTagAllowlist = new Set(["script", "link", "img", "source", "video", "audio", "iframe"]);
const bytesPerMb = 1024 * 1024;

const defaultPackagePolicy = {
  autoSplitDatabase: true,
  largeHtmlThresholdMb: 5,
  largeDataThresholdMb: 20,
  databasePackageThresholdMb: 10,
  maxCodePackageMb: 50,
  databasePaths: [
    "data/**",
    "db/**",
    "database/**",
    "datasets/**",
    "seed/**",
    "seeds/**",
    "storage/**",
    "vector-store/**",
    "embeddings/**",
  ],
  databaseExtensions: [
    ".db",
    ".sqlite",
    ".sqlite3",
    ".duckdb",
    ".dump",
    ".sql",
    ".parquet",
    ".arrow",
    ".feather",
    ".ndjson",
    ".jsonl",
  ],
  conditionalDataExtensions: [".csv", ".json", ".xlsx"],
  include: [],
  exclude: [],
};

function usage() {
  console.log(`MX Agent Hub ADK

Usage:
  mx-agent-hub init <projectDir> [--target codex|claude|all]
  mx-agent-hub validate <projectDir> [--json]
  mx-agent-hub pack <projectDir> [--out dist/agent-hub-package.zip] [--db-out dist/agent-hub-db.zip] [--bundle-out dist/agent-hub-bundle.zip] [--split-db|--no-split-db] [--force]
  mx-agent-hub update
  mx-agent-hub version

Examples:
  mx-agent-hub init . --target codex
  mx-agent-hub validate .
  mx-agent-hub pack .
  mx-agent-hub pack . --split-db
  mx-agent-hub update
  mx-agent-hub version`);
}

function printVersion() {
  console.log(`mx-agent-hub-adk ${packageJson.version}`);
}

function parseVersionParts(value) {
  return String(value)
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function getGithubRepository() {
  return process.env.MX_AGENT_HUB_GITHUB_REPOSITORY || defaultGithubRepository;
}

function getRepoBranch() {
  return process.env.MX_AGENT_HUB_REPO_BRANCH || defaultRepoBranch;
}

function getUpdateCheckUrl() {
  if (process.env.MX_AGENT_HUB_UPDATE_CHECK_URL) {
    return process.env.MX_AGENT_HUB_UPDATE_CHECK_URL;
  }

  return `https://raw.githubusercontent.com/${getGithubRepository()}/${getRepoBranch()}/package.json`;
}

function getUpdateCachePath() {
  if (process.env.MX_AGENT_HUB_UPDATE_CACHE) {
    return process.env.MX_AGENT_HUB_UPDATE_CACHE;
  }

  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheRoot, "mx-agent-hub", "update-check.json");
}

function readUpdateCache(cachePath) {
  try {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    return null;
  }
}

function writeUpdateCache(cachePath, data) {
  try {
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(data, null, 2));
  } catch {
    // Update checks are best-effort and should not block normal CLI commands.
  }
}

async function fetchLatestPackageInfo() {
  if (typeof fetch !== "function") return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);

  try {
    const response = await fetch(getUpdateCheckUrl(), {
      signal: controller.signal,
      headers: {
        "User-Agent": `mx-agent-hub/${packageJson.version}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const latestPackage = await response.json();
    if (!latestPackage?.version) return null;

    return {
      latestVersion: String(latestPackage.version),
      checkedAt: Date.now(),
      source: getUpdateCheckUrl(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getLatestPackageInfo() {
  const cachePath = getUpdateCachePath();
  const cached = readUpdateCache(cachePath);
  const cacheTtlMs = parseNumber(process.env.MX_AGENT_HUB_UPDATE_CHECK_TTL_MS, updateCheckTtlMs);

  if (
    cached?.latestVersion &&
    Number.isFinite(cached.checkedAt) &&
    cacheTtlMs > 0 &&
    Date.now() - cached.checkedAt < cacheTtlMs
  ) {
    return cached;
  }

  const latest = await fetchLatestPackageInfo();
  if (latest) {
    writeUpdateCache(cachePath, latest);
    return latest;
  }

  return cached?.latestVersion ? cached : null;
}

async function maybeNotifyUpdate(command, options = {}) {
  if (process.env.MX_AGENT_HUB_DISABLE_UPDATE_CHECK === "1") return;
  if (!command || command === "help" || command === "--help" || command === "-h" || command === "update") return;

  const latest = await getLatestPackageInfo();
  if (!latest?.latestVersion) return;
  if (compareVersions(latest.latestVersion, packageJson.version) <= 0) return;

  const message = [
    `mx-agent-hub update available: ${packageJson.version} -> ${latest.latestVersion}`,
    "Run: mx-agent-hub update",
  ].join("\n");

  if (options.json) {
    console.error(message);
  } else {
    console.error(`\n${message}\n`);
  }
}

function runGit(args, options = {}) {
  return spawnSync("git", args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

function requireGitCheckout() {
  if (!existsSync(path.join(repoRoot, ".git"))) {
    console.error("mx-agent-hub update requires a git-based installation.");
    console.error("Reinstall with the install script if this copy was not installed from git.");
    process.exit(2);
  }
}

function getCurrentGitBranch() {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = result.status === 0 ? result.stdout.trim() : "";

  return branch && branch !== "HEAD" ? branch : getRepoBranch();
}

function ensureCleanGitWorktree() {
  const status = runGit(["status", "--porcelain"]);
  if (status.status !== 0) {
    console.error("mx-agent-hub update failed: unable to inspect git status.");
    if (status.stderr) console.error(status.stderr.trim());
    process.exit(2);
  }

  if (status.stdout.trim()) {
    console.error("mx-agent-hub update stopped because the installation has local changes.");
    console.error(`Installation path: ${repoRoot}`);
    console.error("Commit, stash, or reinstall before updating.");
    process.exit(1);
  }
}

function getGitRevision(ref = "HEAD", short = false) {
  const result = runGit(["rev-parse", short ? "--short" : "--verify", ref]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function commandUpdate() {
  requireGitCheckout();
  ensureCleanGitWorktree();

  const branch = getCurrentGitBranch();
  console.log(`mx-agent-hub update: fetching ${branch}`);

  const fetchResult = runGit(["fetch", "origin", branch, "--depth", "1"], { stdio: "inherit" });
  if (fetchResult.status !== 0) {
    console.error("mx-agent-hub update failed during git fetch.");
    process.exit(fetchResult.status ?? 2);
  }

  const currentRevision = getGitRevision("HEAD", true);
  const nextRevision = getGitRevision("FETCH_HEAD", true);

  if (currentRevision && nextRevision && currentRevision === nextRevision) {
    console.log(`mx-agent-hub is already up to date (${packageJson.version}, ${currentRevision}).`);
    return;
  }

  const mergeResult = runGit(["merge", "--ff-only", "FETCH_HEAD"], { stdio: "inherit" });
  if (mergeResult.status !== 0) {
    console.error("mx-agent-hub update failed: local checkout cannot fast-forward.");
    console.error("Reinstall with the install script or resolve the git state manually.");
    process.exit(mergeResult.status ?? 2);
  }

  const updatedPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const updatedRevision = getGitRevision("HEAD", true);
  writeUpdateCache(getUpdateCachePath(), {
    latestVersion: String(updatedPackage.version),
    checkedAt: Date.now(),
    source: "git",
  });

  console.log(`mx-agent-hub updated: ${packageJson.version} -> ${updatedPackage.version} (${updatedRevision})`);
}

function parseArgs(argv) {
  const [, , command, maybeDir, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];

    if (value === "--json") {
      options.json = true;
    } else if (value === "--force") {
      options.force = true;
    } else if (value === "--split-db") {
      options.splitDb = true;
    } else if (value === "--no-split-db") {
      options.noSplitDb = true;
    } else if (value === "--target") {
      options.target = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--target=")) {
      options.target = value.slice("--target=".length);
    } else if (value === "--out") {
      options.out = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--out=")) {
      options.out = value.slice("--out=".length);
    } else if (value === "--db-out") {
      options.dbOut = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--db-out=")) {
      options.dbOut = value.slice("--db-out=".length);
    } else if (value === "--bundle-out") {
      options.bundleOut = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--bundle-out=")) {
      options.bundleOut = value.slice("--bundle-out=".length);
    } else if (value === "--manifest-out") {
      options.manifestOut = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--manifest-out=")) {
      options.manifestOut = value.slice("--manifest-out=".length);
    } else if (value === "--db-threshold-mb") {
      options.databasePackageThresholdMb = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--db-threshold-mb=")) {
      options.databasePackageThresholdMb = value.slice("--db-threshold-mb=".length);
    } else if (value === "--max-code-package-mb") {
      options.maxCodePackageMb = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--max-code-package-mb=")) {
      options.maxCodePackageMb = value.slice("--max-code-package-mb=".length);
    } else if (value === "--large-html-threshold-mb") {
      options.largeHtmlThresholdMb = rest[index + 1];
      index += 1;
    } else if (value.startsWith("--large-html-threshold-mb=")) {
      options.largeHtmlThresholdMb = value.slice("--large-html-threshold-mb=".length);
    }
  }

  return {
    command,
    projectDir: maybeDir ? path.resolve(maybeDir) : process.cwd(),
    options,
  };
}

function createCheck(section, level, message, detail = "", file = "", line = 0) {
  return { section, level, message, detail, file, line };
}

function normalizeSlash(value) {
  return value.split(path.sep).join("/");
}

function isSubPath(parent, child) {
  const relative = path.relative(parent, child);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeResolve(projectDir, value) {
  const resolved = path.resolve(projectDir, value);

  if (!isSubPath(projectDir, resolved)) {
    throw new Error(`Path escapes project directory: ${value}`);
  }

  return resolved;
}

function shouldIgnoreUrl(value) {
  const trimmed = value.trim();

  return (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmed)
  );
}

function stripUrlSuffix(value) {
  return value.split("#")[0].split("?")[0];
}

function getLineNumber(text, needle) {
  const index = text.indexOf(needle);
  if (index < 0) return 0;
  return text.slice(0, index).split("\n").length;
}

function walkFiles(rootDir) {
  const files = [];

  function visit(currentDir) {
    for (const item of readdirSync(currentDir, { withFileTypes: true })) {
      if (excludedDirs.has(item.name)) continue;

      const fullPath = path.join(currentDir, item.name);
      if (item.isDirectory()) {
        visit(fullPath);
      } else if (item.isFile()) {
        files.push(fullPath);
      }
    }
  }

  visit(rootDir);
  return files;
}

function readJsonFile(filePath) {
  const raw = readFileSync(filePath, "utf8");

  return JSON.parse(raw);
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < bytesPerMb) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / bytesPerMb).toFixed(1)} MB`;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeArray(value, fallback = []) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : fallback;
}

function normalizeExtensionList(value, fallback) {
  return normalizeArray(value, fallback).map((item) => {
    const trimmed = item.trim().toLowerCase();
    return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
  });
}

function mergePackagePolicy(base, override = {}) {
  return {
    ...base,
    ...override,
    largeHtmlThresholdMb: parseNumber(override.largeHtmlThresholdMb, base.largeHtmlThresholdMb),
    largeDataThresholdMb: parseNumber(override.largeDataThresholdMb, base.largeDataThresholdMb),
    databasePackageThresholdMb: parseNumber(override.databasePackageThresholdMb, base.databasePackageThresholdMb),
    maxCodePackageMb: parseNumber(override.maxCodePackageMb, base.maxCodePackageMb),
    databasePaths: normalizeArray(override.databasePaths, base.databasePaths),
    databaseExtensions: normalizeExtensionList(override.databaseExtensions, base.databaseExtensions),
    conditionalDataExtensions: normalizeExtensionList(override.conditionalDataExtensions, base.conditionalDataExtensions),
    include: normalizeArray(override.include, base.include),
    exclude: normalizeArray(override.exclude, base.exclude),
  };
}

function loadPackagePolicy(projectDir, manifest = null, options = {}) {
  const policyPath = path.join(projectDir, ".mx-agent-hub", "package-policy.json");
  let policy = defaultPackagePolicy;

  if (existsSync(policyPath)) {
    try {
      policy = mergePackagePolicy(policy, readJsonFile(policyPath));
    } catch {
      policy = mergePackagePolicy(policy);
    }
  }

  if (manifest?.database && typeof manifest.database === "object") {
    const databasePolicy = {
      autoSplitDatabase: manifest.database.autoSplit ?? policy.autoSplitDatabase,
      include: manifest.database.include ?? policy.include,
      exclude: manifest.database.exclude ?? policy.exclude,
      largeHtmlThresholdMb: manifest.database.largeHtmlThresholdMb ?? policy.largeHtmlThresholdMb,
      largeDataThresholdMb: manifest.database.largeDataThresholdMb ?? policy.largeDataThresholdMb,
      databasePackageThresholdMb: manifest.database.databasePackageThresholdMb ?? policy.databasePackageThresholdMb,
      maxCodePackageMb: manifest.database.maxCodePackageMb ?? policy.maxCodePackageMb,
    };
    policy = mergePackagePolicy(policy, databasePolicy);
  }

  return mergePackagePolicy(policy, {
    largeHtmlThresholdMb: options.largeHtmlThresholdMb ?? policy.largeHtmlThresholdMb,
    databasePackageThresholdMb: options.databasePackageThresholdMb ?? policy.databasePackageThresholdMb,
    maxCodePackageMb: options.maxCodePackageMb ?? policy.maxCodePackageMb,
  });
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern) {
  const normalized = normalizeSlash(pattern).replace(/^\/+/, "");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const nextChar = normalized[index + 1];

    if (char === "*" && nextChar === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegex(char);
    }
  }

  source += "$";
  return new RegExp(source);
}

function matchesAnyPattern(relativePath, patterns) {
  const normalized = normalizeSlash(relativePath);
  return patterns.some((pattern) => globToRegex(pattern).test(normalized));
}

function getFileReason(file, policy) {
  const rel = normalizeSlash(file.relativePath);
  const extension = path.extname(rel).toLowerCase();
  const size = file.size;
  const databaseExtensions = new Set(policy.databaseExtensions);
  const conditionalExtensions = new Set(policy.conditionalDataExtensions);
  const isIncluded = matchesAnyPattern(rel, policy.include);
  const isExcluded = matchesAnyPattern(rel, policy.exclude);
  const isDatabasePath = matchesAnyPattern(rel, policy.databasePaths);
  const isLargeData = size >= policy.largeDataThresholdMb * bytesPerMb;

  if (isExcluded) return null;
  if (isIncluded) return "manifest-include";
  if (databaseExtensions.has(extension)) return "database-extension";
  if (conditionalExtensions.has(extension) && isDatabasePath) return "database-path";
  if (conditionalExtensions.has(extension) && isLargeData) return "large-data-extension";
  if (isDatabasePath && isLargeData) return "large-data-path";

  return null;
}

function analyzeProjectData(projectDir, policy) {
  const files = walkFiles(projectDir).map((filePath) => ({
    absolutePath: filePath,
    relativePath: normalizeSlash(path.relative(projectDir, filePath)),
    size: statSync(filePath).size,
  }));

  const largeHtmlFiles = files
    .filter((file) => path.extname(file.relativePath).toLowerCase() === ".html")
    .filter((file) => file.size >= policy.largeHtmlThresholdMb * bytesPerMb)
    .map((file) => ({
      path: file.relativePath,
      sizeBytes: file.size,
      thresholdMb: policy.largeHtmlThresholdMb,
    }));

  const databaseCandidates = files
    .map((file) => {
      const reason = getFileReason(file, policy);
      return reason
        ? {
            path: file.relativePath,
            sizeBytes: file.size,
            reason,
          }
        : null;
    })
    .filter(Boolean);

  const databaseCandidatePaths = new Set(databaseCandidates.map((item) => item.path));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const databaseTotalBytes = databaseCandidates.reduce((sum, file) => sum + file.sizeBytes, 0);
  const estimatedCodePackageBytes = files
    .filter((file) => !databaseCandidatePaths.has(file.relativePath))
    .reduce((sum, file) => sum + file.size, 0);

  return {
    totalBytes,
    estimatedCodePackageBytes,
    databaseTotalBytes,
    databasePackageThresholdBytes: policy.databasePackageThresholdMb * bytesPerMb,
    maxCodePackageBytes: policy.maxCodePackageMb * bytesPerMb,
    largeHtmlFiles,
    databaseCandidates,
  };
}

function shouldSplitDatabase(dataProfile, policy, options = {}) {
  if (options.noSplitDb) return false;
  if (options.splitDb) return dataProfile.databaseCandidates.length > 0;
  if (!policy.autoSplitDatabase) return false;

  return (
    dataProfile.databaseCandidates.length > 0 &&
    dataProfile.databaseTotalBytes >= dataProfile.databasePackageThresholdBytes
  );
}

function addDataChecks(checks, dataProfile, splitDatabase) {
  for (const item of dataProfile.largeHtmlFiles) {
    checks.push(
      createCheck(
        "Data",
        "WARN",
        `Large HTML candidate found: ${item.path}`,
        `Entry HTML should stay below ${item.thresholdMb} MB. Move embedded data into data/db files so pack can split them.`,
        item.path,
      ),
    );
  }

  for (const item of dataProfile.databaseCandidates) {
    checks.push(
      createCheck(
        "Data",
        "WARN",
        `DB/data candidate found: ${item.path}`,
        `${formatBytes(item.sizeBytes)} detected by ${item.reason}. ${splitDatabase ? "pack will put it in the DB package." : "Use --split-db or exceed the DB threshold to package it separately."}`,
        item.path,
      ),
    );
  }

  if (dataProfile.estimatedCodePackageBytes > dataProfile.maxCodePackageBytes) {
    checks.push(
      createCheck(
        "Data",
        "WARN",
        "Estimated code package is large",
        `${formatBytes(dataProfile.estimatedCodePackageBytes)} exceeds the configured ${formatBytes(dataProfile.maxCodePackageBytes)} target.`,
      ),
    );
  }

  if (
    dataProfile.largeHtmlFiles.length === 0 &&
    dataProfile.databaseCandidates.length === 0 &&
    dataProfile.estimatedCodePackageBytes <= dataProfile.maxCodePackageBytes
  ) {
    checks.push(createCheck("Data", "PASS", "No large HTML or DB/data split candidates found"));
  }
}

function findHtmlFiles(projectDir) {
  return walkFiles(projectDir)
    .filter((file) => file.toLowerCase().endsWith(".html"))
    .sort((left, right) => normalizeSlash(path.relative(projectDir, left)).localeCompare(normalizeSlash(path.relative(projectDir, right))));
}

function loadManifest(projectDir, checks) {
  const manifestPath = path.join(projectDir, "agent-hub.json");

  if (!existsSync(manifestPath)) {
    checks.push(createCheck("Manifest", "WARN", "agent-hub.json not found", "Entry HTML will be inferred, but Hub registration should include a manifest."));
    return { manifest: null, manifestPath };
  }

  try {
    const manifest = readJsonFile(manifestPath);
    checks.push(createCheck("Manifest", "PASS", "agent-hub.json found"));
    validateManifestFields(manifest, checks);
    return { manifest, manifestPath };
  } catch (error) {
    checks.push(createCheck("Manifest", "FAIL", "agent-hub.json is not valid JSON", error.message, "agent-hub.json"));
    return { manifest: null, manifestPath };
  }
}

function validateManifestFields(manifest, checks) {
  const requiredFields = ["schemaVersion", "name", "description", "version", "entry", "runtime"];

  for (const field of requiredFields) {
    if (manifest[field] === undefined || manifest[field] === null || String(manifest[field]).trim() === "") {
      checks.push(createCheck("Manifest", "FAIL", `Missing required manifest field: ${field}`, "Add the field to agent-hub.json.", "agent-hub.json"));
    }
  }

  if (manifest.runtime && manifest.runtime !== "static-html") {
    checks.push(createCheck("Manifest", "WARN", `Unsupported runtime declared: ${manifest.runtime}`, "MVP supports static-html."));
  }
}

function inferEntry(projectDir, manifest, checks) {
  if (manifest?.entry) {
    try {
      const entryPath = safeResolve(projectDir, manifest.entry);
      if (existsSync(entryPath) && statSync(entryPath).isFile()) {
        checks.push(createCheck("Entry", "PASS", `entry file found: ${manifest.entry}`));
        return entryPath;
      }

      checks.push(createCheck("Entry", "FAIL", `manifest entry not found: ${manifest.entry}`, "Update agent-hub.json entry or move the file.", "agent-hub.json"));
    } catch (error) {
      checks.push(createCheck("Entry", "FAIL", "manifest entry is not safe", error.message, "agent-hub.json"));
    }
  }

  const htmlFiles = findHtmlFiles(projectDir);
  const indexFile = htmlFiles.find((file) => path.basename(file).toLowerCase() === "index.html");

  if (indexFile) {
    checks.push(createCheck("Entry", "PASS", `inferred index entry: ${normalizeSlash(path.relative(projectDir, indexFile))}`));
    return indexFile;
  }

  if (htmlFiles[0]) {
    checks.push(createCheck("Entry", "WARN", `inferred first HTML entry: ${normalizeSlash(path.relative(projectDir, htmlFiles[0]))}`, "Add agent-hub.json entry to make this explicit."));
    return htmlFiles[0];
  }

  checks.push(createCheck("Entry", "FAIL", "No HTML entry file found", "Add agent-hub.json with an entry field or include index.html."));
  return null;
}

function extractHtmlReferences(html) {
  const references = [];
  const tagRegex = /<([a-zA-Z][\w:-]*)(\s[^>]*)?>/g;
  let tagMatch;

  while ((tagMatch = tagRegex.exec(html))) {
    const tag = tagMatch[1].toLowerCase();
    const attrs = tagMatch[2] ?? "";
    if (!assetTagAllowlist.has(tag)) continue;

    for (const attr of localAssetAttributes) {
      const attrRegex = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "gi");
      let attrMatch;

      while ((attrMatch = attrRegex.exec(attrs))) {
        references.push({ value: attrMatch[1], raw: attrMatch[0] });
      }
    }

    const srcsetRegex = /srcset\s*=\s*["']([^"']+)["']/gi;
    let srcsetMatch;
    while ((srcsetMatch = srcsetRegex.exec(attrs))) {
      for (const candidate of srcsetMatch[1].split(",")) {
        const value = candidate.trim().split(/\s+/)[0];
        references.push({ value, raw: value });
      }
    }
  }

  const cssUrlRegex = /url\((['"]?)(.*?)\1\)/g;
  let cssMatch;
  while ((cssMatch = cssUrlRegex.exec(html))) {
    references.push({ value: cssMatch[2], raw: cssMatch[0] });
  }

  return references;
}

function validateAssets(projectDir, entryPath, checks) {
  if (!entryPath) return;

  const html = readFileSync(entryPath, "utf8");
  const entryDir = path.dirname(entryPath);
  const entryRel = normalizeSlash(path.relative(projectDir, entryPath));
  let resolvedCount = 0;
  const missing = [];
  const external = [];
  const localCssFiles = [];

  for (const reference of extractHtmlReferences(html)) {
    if (shouldIgnoreUrl(reference.value)) {
      if (/^(?:https?:)?\/\//i.test(reference.value.trim())) external.push(reference.value);
      continue;
    }

    const cleanValue = stripUrlSuffix(reference.value);
    const resolved = path.resolve(entryDir, cleanValue);

    if (!isSubPath(projectDir, resolved)) {
      missing.push({ ...reference, reason: "path escapes project directory" });
      continue;
    }

    if (existsSync(resolved) && statSync(resolved).isFile()) {
      resolvedCount += 1;
      if (resolved.toLowerCase().endsWith(".css")) localCssFiles.push(resolved);
    } else {
      missing.push(reference);
    }
  }

  for (const cssFile of localCssFiles) {
    validateCssAssets(projectDir, cssFile, checks);
  }

  if (resolvedCount > 0) {
    checks.push(createCheck("Assets", "PASS", `${resolvedCount} local asset references resolved`));
  }

  if (external.length > 0) {
    checks.push(createCheck("Assets", "WARN", `${external.length} external asset references found`, "External URLs can break in restricted Hub networks."));
  }

  for (const item of missing) {
    checks.push(createCheck("Assets", "FAIL", `Missing asset reference: ${item.value}`, item.reason ?? "Referenced file does not exist.", entryRel, getLineNumber(html, item.raw)));
  }
}

function validateCssAssets(projectDir, cssFile, checks) {
  const css = readFileSync(cssFile, "utf8");
  const cssDir = path.dirname(cssFile);
  const cssRel = normalizeSlash(path.relative(projectDir, cssFile));
  const cssUrlRegex = /url\((['"]?)(.*?)\1\)/g;
  let match;

  while ((match = cssUrlRegex.exec(css))) {
    const value = match[2];
    if (shouldIgnoreUrl(value)) continue;

    const resolved = path.resolve(cssDir, stripUrlSuffix(value));
    if (!isSubPath(projectDir, resolved) || !existsSync(resolved)) {
      checks.push(createCheck("Assets", "FAIL", `Missing CSS asset reference: ${value}`, "Referenced file does not exist.", cssRel, getLineNumber(css, match[0])));
    }
  }
}

function validateSecurity(projectDir, checks) {
  const scanExtensions = new Set([".html", ".js", ".mjs", ".css", ".json"]);
  const files = walkFiles(projectDir).filter((file) => scanExtensions.has(path.extname(file).toLowerCase()));
  const secretPatterns = [
    /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"']{8,}["']/i,
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  ];
  const localPatterns = [
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i,
    /\bfile:\/\//i,
    /(?:^|["'(:\s])\/Users\/[A-Za-z0-9._-]+/i,
    /[A-Za-z]:\\Users\\/i,
  ];
  const sandboxPatterns = [
    /\bwindow\.top\b/,
    /\btop\.location\b/,
    /\bwindow\.parent\.location\b/,
    /\bdocument\.domain\b/,
  ];

  let cleanSecurity = true;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = normalizeSlash(path.relative(projectDir, file));

    for (const pattern of secretPatterns) {
      const match = text.match(pattern);
      if (match) {
        cleanSecurity = false;
        checks.push(createCheck("Security", "FAIL", "secret-like value found", redact(match[0]), rel, getLineNumber(text, match[0])));
      }
    }

    for (const pattern of localPatterns) {
      const match = text.match(pattern);
      if (match) {
        cleanSecurity = false;
        checks.push(createCheck("Security", "FAIL", "local-only reference found", match[0], rel, getLineNumber(text, match[0])));
      }
    }

    for (const pattern of sandboxPatterns) {
      const match = text.match(pattern);
      if (match) {
        cleanSecurity = false;
        checks.push(createCheck("Sandbox", "FAIL", "iframe sandbox risk pattern found", match[0], rel, getLineNumber(text, match[0])));
      }
    }
  }

  if (cleanSecurity) {
    checks.push(createCheck("Security", "PASS", "No blocking secret, local path, or sandbox risk patterns found"));
  }
}

function redact(value) {
  if (value.length <= 16) return "[redacted]";
  return `${value.slice(0, 8)}...[redacted]`;
}

function validateZipCommand(checks) {
  const result = spawnSync("zip", ["-v"], { stdio: "ignore" });
  if (result.status === 0) {
    checks.push(createCheck("Packaging", "PASS", "zip command available"));
  } else {
    checks.push(createCheck("Packaging", "WARN", "zip command not found", "pack requires the system zip command in this MVP."));
  }
}

function validateProject(projectDir, options = {}) {
  const checks = [];

  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    return {
      projectDir,
      checks: [createCheck("Project", "FAIL", `Project directory not found: ${projectDir}`)],
      entryPath: null,
      failed: true,
    };
  }

  const { manifest } = loadManifest(projectDir, checks);
  const packagePolicy = loadPackagePolicy(projectDir, manifest, options);
  const dataProfile = analyzeProjectData(projectDir, packagePolicy);
  const splitDatabase = shouldSplitDatabase(dataProfile, packagePolicy, options);
  const entryPath = inferEntry(projectDir, manifest, checks);
  validateAssets(projectDir, entryPath, checks);
  addDataChecks(checks, dataProfile, splitDatabase);
  validateSecurity(projectDir, checks);
  validateZipCommand(checks);

  return {
    projectDir,
    checks,
    entryPath,
    packagePolicy,
    dataProfile,
    splitDatabase,
    failed: checks.some((check) => check.level === "FAIL"),
  };
}

function renderValidation(result) {
  const sections = [...new Set(result.checks.map((check) => check.section))];

  console.log("Agent Hub Validate\n");

  for (const section of sections) {
    console.log(section);
    for (const check of result.checks.filter((item) => item.section === section)) {
      const location = check.file ? ` (${check.file}${check.line ? `:${check.line}` : ""})` : "";
      console.log(`  ${check.level.padEnd(4)} ${check.message}${location}`);
      if (check.detail) console.log(`       ${check.detail}`);
    }
    console.log("");
  }

  const failCount = result.checks.filter((check) => check.level === "FAIL").length;
  const warnCount = result.checks.filter((check) => check.level === "WARN").length;
  const passCount = result.checks.filter((check) => check.level === "PASS").length;

  console.log("Result");
  console.log(`  ${failCount === 0 ? "Registerable" : "Not registerable"}`);
  console.log(`  PASS ${passCount} / WARN ${warnCount} / FAIL ${failCount}`);

  if (failCount > 0) {
    console.log("\nFix suggestions");
    console.log("  1. Fix every FAIL item above before packaging.");
    console.log("  2. Run mx-agent-hub validate . again.");
    console.log("  3. Run mx-agent-hub pack . after validation passes.");
  }
}

async function copyTemplateTree(sourceDir, targetDir, report) {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  await mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyTemplateTree(source, target, report);
      continue;
    }

    if (existsSync(target)) {
      report.skipped.push(normalizeSlash(target));
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    report.created.push(normalizeSlash(target));
  }
}

async function commandInit(projectDir, options) {
  const target = options.target ?? "codex";
  const allowedTargets = new Set(["codex", "claude", "all"]);

  if (!allowedTargets.has(target)) {
    console.error(`Unknown target: ${target}`);
    process.exit(2);
  }

  await mkdir(projectDir, { recursive: true });

  const report = { created: [], skipped: [] };
  await copyTemplateTree(path.join(templatesDir, "common"), projectDir, report);

  if (target === "codex" || target === "all") {
    await copyTemplateTree(path.join(templatesDir, "codex"), projectDir, report);
  }

  if (target === "claude" || target === "all") {
    await copyTemplateTree(path.join(templatesDir, "claude"), projectDir, report);
  }

  let manifest = null;
  if (existsSync(path.join(projectDir, "agent-hub.json"))) {
    try {
      manifest = readJsonFile(path.join(projectDir, "agent-hub.json"));
    } catch {
      manifest = null;
    }
  }
  const packagePolicy = loadPackagePolicy(projectDir, manifest, options);
  const dataProfile = analyzeProjectData(projectDir, packagePolicy);

  console.log(`mx-agent-hub initialized: ${projectDir}`);
  console.log(`target: ${target}`);
  console.log(`created: ${report.created.length}`);
  console.log(`skipped: ${report.skipped.length}`);

  if (dataProfile.largeHtmlFiles.length > 0) {
    console.log("\nData split policy");
    for (const item of dataProfile.largeHtmlFiles) {
      console.log(`  WARN Large HTML candidate found: ${item.path} (${formatBytes(item.sizeBytes)})`);
      console.log("       Move embedded data into data/*.jsonl, data/*.csv, or db/*.sqlite so pack can split it.");
    }
  }

  console.log("\nNext:");
  console.log("  mx-agent-hub validate .");
  console.log("  mx-agent-hub pack .");
}

function commandValidate(projectDir, options) {
  const result = validateProject(projectDir, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderValidation(result);
  }

  process.exit(result.failed ? 1 : 0);
}

function replaceZipExtension(filePath, suffix) {
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);
  return path.join(directory, `${baseName}${suffix}`);
}

function getDefaultDbOut(out) {
  if (path.basename(out) === "agent-hub-package.zip") {
    return path.join(path.dirname(out), "agent-hub-db.zip");
  }

  return replaceZipExtension(out, "-db.zip");
}

function getDefaultBundleOut(out) {
  if (path.basename(out) === "agent-hub-package.zip") {
    return path.join(path.dirname(out), "agent-hub-bundle.zip");
  }

  return replaceZipExtension(out, "-bundle.zip");
}

function getDefaultManifestOut(out) {
  return replaceZipExtension(out, ".manifest.json");
}

function getBaseZipExcludes() {
  return [
    "*.git*",
    "node_modules/*",
    "dist/*",
    "build/*",
    ".next/*",
    "coverage/*",
    ".mx-agent-hub/reports/*",
  ];
}

function getCandidateZipExcludes(databaseCandidates) {
  return databaseCandidates.flatMap((item) => [item.path, `./${item.path}`]);
}

function runZip(zipArgs, cwd, failureMessage) {
  const zipResult = spawnSync("zip", zipArgs, {
    cwd,
    stdio: "inherit",
  });

  if (zipResult.status !== 0) {
    console.error(failureMessage);
    process.exit(2);
  }
}

function writeCodePackageMetadata(out, metadata) {
  const tempRoot = path.join(path.dirname(out), ".mx-agent-hub-pack-tmp");
  const metadataDir = path.join(tempRoot, ".mx-agent-hub");
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(metadataDir, { recursive: true });
  writeFileSync(path.join(metadataDir, "db-package.json"), JSON.stringify(metadata, null, 2));

  runZip(
    ["-q", "-r", out, ".mx-agent-hub/db-package.json"],
    tempRoot,
    "Packaging failed while adding DB package metadata.",
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

function createPackageManifest({ out, dbOut, bundleOut, dataProfile, splitDatabase, manifestOut }) {
  const codePackage = {
    fileName: path.basename(out),
    sizeBytes: statSync(out).size,
  };
  const databasePackage = splitDatabase
    ? {
        required: true,
        fileName: path.basename(dbOut),
        sizeBytes: statSync(dbOut).size,
        files: dataProfile.databaseCandidates,
      }
    : {
        required: false,
        fileName: null,
        sizeBytes: 0,
        files: dataProfile.databaseCandidates,
      };

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tool: {
      name: packageJson.name,
      version: packageJson.version,
    },
    codePackage,
    databasePackage,
    bundlePackage: splitDatabase
      ? {
          fileName: path.basename(bundleOut),
        }
      : null,
  };

  writeFileSync(manifestOut, JSON.stringify(manifest, null, 2));
  return manifest;
}

function createBundlePackage({ out, dbOut, bundleOut, manifestOut }) {
  const tempRoot = path.join(path.dirname(bundleOut), ".mx-agent-hub-bundle-tmp");
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(path.join(tempRoot, "package"), { recursive: true });
  mkdirSync(path.join(tempRoot, "database"), { recursive: true });

  copyFileSync(manifestOut, path.join(tempRoot, "manifest.json"));
  copyFileSync(out, path.join(tempRoot, "package", path.basename(out)));
  copyFileSync(dbOut, path.join(tempRoot, "database", path.basename(dbOut)));

  if (existsSync(bundleOut)) rmSync(bundleOut);
  runZip(["-q", "-r", bundleOut, "manifest.json", "package", "database"], tempRoot, "Bundle packaging failed.");

  rmSync(tempRoot, { recursive: true, force: true });
}

function commandPack(projectDir, options) {
  const result = validateProject(projectDir, options);

  if (result.failed && !options.force) {
    renderValidation(result);
    console.error("\nPackaging stopped because validation failed. Use --force only for debugging.");
    process.exit(1);
  }

  const out = path.resolve(projectDir, options.out ?? "dist/agent-hub-package.zip");
  const dbOut = path.resolve(projectDir, options.dbOut ?? getDefaultDbOut(out));
  const bundleOut = path.resolve(projectDir, options.bundleOut ?? getDefaultBundleOut(out));
  const manifestOut = path.resolve(projectDir, options.manifestOut ?? getDefaultManifestOut(out));
  const splitDatabase = result.splitDatabase;

  mkdirSync(path.dirname(out), { recursive: true });
  mkdirSync(path.dirname(dbOut), { recursive: true });
  mkdirSync(path.dirname(bundleOut), { recursive: true });
  mkdirSync(path.dirname(manifestOut), { recursive: true });
  if (existsSync(out)) rmSync(out);
  if (existsSync(dbOut)) rmSync(dbOut);
  if (existsSync(bundleOut)) rmSync(bundleOut);
  if (existsSync(manifestOut)) rmSync(manifestOut);

  const zipArgs = [
    "-r",
    out,
    ".",
    "-x",
    ...getBaseZipExcludes(),
    ...(splitDatabase ? getCandidateZipExcludes(result.dataProfile.databaseCandidates) : []),
  ];

  runZip(zipArgs, projectDir, "Packaging failed. The system zip command is required in this MVP.");

  if (splitDatabase) {
    const dbZipArgs = ["-r", dbOut, ...result.dataProfile.databaseCandidates.map((item) => item.path)];
    runZip(dbZipArgs, projectDir, "DB packaging failed. The system zip command is required in this MVP.");

    writeCodePackageMetadata(out, {
      required: true,
      packageFileName: path.basename(dbOut),
      files: result.dataProfile.databaseCandidates,
    });
  }

  const packageManifest = createPackageManifest({
    out,
    dbOut,
    bundleOut,
    dataProfile: result.dataProfile,
    splitDatabase,
    manifestOut,
  });

  if (splitDatabase) {
    createBundlePackage({ out, dbOut, bundleOut, manifestOut });
  }

  console.log(`\nCreated Hub package: ${out}`);
  console.log(`Created package manifest: ${manifestOut}`);
  if (splitDatabase) {
    console.log(`Created DB package: ${dbOut}`);
    console.log(`Created upload bundle: ${bundleOut}`);
    console.log(`DB files: ${packageManifest.databasePackage.files.length} (${formatBytes(result.dataProfile.databaseTotalBytes)} before compression)`);
  } else if (result.dataProfile.databaseCandidates.length > 0) {
    console.log("DB/data candidates were detected but not split. Use --split-db to force a DB package.");
  }
}

async function main() {
  const { command, projectDir, options } = parseArgs(process.argv);

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      usage();
      return;
    }

    if (command === "version" || command === "--version" || command === "-v") {
      await maybeNotifyUpdate(command, options);
      printVersion();
      return;
    }

    if (command === "update") {
      commandUpdate();
      return;
    }

    await maybeNotifyUpdate(command, options);

    if (command === "init") {
      await commandInit(projectDir, options);
      return;
    }

    if (command === "validate") {
      commandValidate(projectDir, options);
      return;
    }

    if (command === "pack") {
      commandPack(projectDir, options);
      return;
    }

    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(2);
  } catch (error) {
    console.error(`mx-agent-hub error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

main();
