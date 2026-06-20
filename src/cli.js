#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const templatesDir = path.join(repoRoot, "templates");

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

function usage() {
  console.log(`MX Agent Hub ADK

Usage:
  mx-agent-hub init <projectDir> [--target codex|claude|all]
  mx-agent-hub validate <projectDir> [--json]
  mx-agent-hub pack <projectDir> [--out dist/agent-hub-package.zip] [--force]

Examples:
  mx-agent-hub init . --target codex
  mx-agent-hub validate .
  mx-agent-hub pack .`);
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

function validateProject(projectDir) {
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
  const entryPath = inferEntry(projectDir, manifest, checks);
  validateAssets(projectDir, entryPath, checks);
  validateSecurity(projectDir, checks);
  validateZipCommand(checks);

  return {
    projectDir,
    checks,
    entryPath,
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

  console.log(`mx-agent-hub initialized: ${projectDir}`);
  console.log(`target: ${target}`);
  console.log(`created: ${report.created.length}`);
  console.log(`skipped: ${report.skipped.length}`);
  console.log("\nNext:");
  console.log("  mx-agent-hub validate .");
  console.log("  mx-agent-hub pack .");
}

function commandValidate(projectDir, options) {
  const result = validateProject(projectDir);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderValidation(result);
  }

  process.exit(result.failed ? 1 : 0);
}

function commandPack(projectDir, options) {
  const result = validateProject(projectDir);

  if (result.failed && !options.force) {
    renderValidation(result);
    console.error("\nPackaging stopped because validation failed. Use --force only for debugging.");
    process.exit(1);
  }

  const out = path.resolve(projectDir, options.out ?? "dist/agent-hub-package.zip");
  mkdirSync(path.dirname(out), { recursive: true });
  if (existsSync(out)) rmSync(out);

  const zipArgs = [
    "-r",
    out,
    ".",
    "-x",
    "*.git*",
    "node_modules/*",
    "dist/*",
    "build/*",
    ".next/*",
    "coverage/*",
    ".mx-agent-hub/reports/*",
  ];

  const zipResult = spawnSync("zip", zipArgs, {
    cwd: projectDir,
    stdio: "inherit",
  });

  if (zipResult.status !== 0) {
    console.error("Packaging failed. The system zip command is required in this MVP.");
    process.exit(2);
  }

  console.log(`\nCreated Hub package: ${out}`);
}

async function main() {
  const { command, projectDir, options } = parseArgs(process.argv);

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      usage();
      return;
    }

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
