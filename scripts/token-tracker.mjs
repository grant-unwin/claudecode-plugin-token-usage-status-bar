#!/usr/bin/env node
/**
 * token-tracker.mjs
 * Claude Code Plugin — Token Tracker
 *
 * Fires on Stop and SessionEnd hooks.
 * Reads the session transcript JSONL, sums all usage blocks,
 * and prints a running total to stderr (visible in the Claude Code terminal).
 *
 * Stats are written per-session so multiple concurrent sessions don't collide.
 */

import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";

const SESSION_END  = process.argv.includes("--session-end");
const QUERY_MODE   = process.argv.includes("--query");
const CACHE_DIR    = path.join(os.homedir(), ".claude", "token-tracker");
const STATS_DIR    = path.join(os.homedir(), ".claude", "token-tracker", "sessions");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const STALE_DAYS   = 7;

// ─── Pricing (per 1M tokens) ─────────────────────────────────────────────────
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// cache_write = 5-minute cache write price, cache_read = cache hit price
const MODEL_PRICING = {
  "claude-opus-4-6":   { input:  5.00, output: 25.00, cache_write:  6.25, cache_read: 0.50 },
  "claude-opus-4-5":   { input:  5.00, output: 25.00, cache_write:  6.25, cache_read: 0.50 },
  "claude-opus-4-1":   { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  "claude-opus-4-0":   { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  "claude-sonnet-4-6": { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  "claude-sonnet-4-5": { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  "claude-sonnet-4-0": { input:  3.00, output: 15.00, cache_write:  3.75, cache_read: 0.30 },
  "claude-haiku-4-5":  { input:  1.00, output:  5.00, cache_write:  1.25, cache_read: 0.10 },
  "claude-haiku-3-5":  { input:  0.80, output:  4.00, cache_write:  1.00, cache_read: 0.08 },
};

const DEFAULT_PRICING = { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 };

function getPricing(model) {
  if (!model) return DEFAULT_PRICING;
  // Try exact match first, then prefix match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return DEFAULT_PRICING;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n || 0).toLocaleString("en-GB");
}

function costBreakdown(t, pricing) {
  const input      = ((t.input_tokens || 0)                / 1_000_000) * pricing.input;
  const output     = ((t.output_tokens || 0)               / 1_000_000) * pricing.output;
  const cacheWrite = ((t.cache_creation_input_tokens || 0) / 1_000_000) * pricing.cache_write;
  const cacheRead  = ((t.cache_read_input_tokens || 0)     / 1_000_000) * pricing.cache_read;
  const total      = input + output + cacheWrite + cacheRead;
  return { input, output, cacheWrite, cacheRead, total };
}

function fmtCost(cost) {
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01)   return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function modelDisplayName(model) {
  if (!model) return "unknown";
  // "claude-opus-4-6" → "Opus 4.6"
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (m) return `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} ${m[2]}.${m[3]}`;
  return model;
}

// ─── Read stdin ───────────────────────────────────────────────────────────────
async function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", c => { raw += c; });
    process.stdin.on("end",  () => resolve(raw.trim()));
    setTimeout(() => resolve(raw.trim()), 3000);
  });
}

// ─── Parse transcript JSONL ───────────────────────────────────────────────────
async function parseTranscript(transcriptPath) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    turns: 0,
  };
  let model = null;

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { totals, model };

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      // Extract model from message entries
      const entryModel = entry?.message?.model;
      if (entryModel && entryModel !== "<synthetic>") {
        model = entryModel;
      }

      // Transcript entries can wrap usage in different places
      const usage =
        entry?.usage ||
        entry?.message?.usage ||
        entry?.response?.usage ||
        null;

      if (usage) {
        totals.input_tokens                += usage.input_tokens                || 0;
        totals.output_tokens               += usage.output_tokens               || 0;
        totals.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
        totals.cache_read_input_tokens     += usage.cache_read_input_tokens     || 0;
        totals.turns++;
      }
    } catch { /* skip malformed lines */ }
  }

  return { totals, model };
}

// ─── Session-scoped stats file path ──────────────────────────────────────────
function sessionStatsPath(sessionId) {
  return path.join(STATS_DIR, `${sessionId}.txt`);
}

function sessionCompactPath(sessionId) {
  return path.join(STATS_DIR, `${sessionId}.compact`);
}

// ─── Print inline summary to stderr (shows in Claude Code terminal) ───────────
function printSummary(totals, model, sessionEnd = false) {
  const pricing = getPricing(model);
  const costs   = costBreakdown(totals, pricing);
  const totalTk = (totals.input_tokens || 0) + (totals.output_tokens || 0);
  const label   = sessionEnd ? "Session Final" : "Token Usage";
  const mName   = modelDisplayName(model);

  const lines = [
    ``,
    `┌─ ${label} ${"─".repeat(50 - label.length - 1)}┐`,
    `│  Model  : ${mName.padEnd(41)}│`,
    `│  Input  : ${fmt(totals.input_tokens).padStart(12)}  ${fmtCost(costs.input).padStart(10)}${" ".repeat(18)}│`,
    `│  Output : ${fmt(totals.output_tokens).padStart(12)}  ${fmtCost(costs.output).padStart(10)}${" ".repeat(18)}│`,
    `│  Cache↑ : ${fmt(totals.cache_creation_input_tokens).padStart(12)}  ${fmtCost(costs.cacheWrite).padStart(10)}${" ".repeat(18)}│`,
    `│  Cache↓ : ${fmt(totals.cache_read_input_tokens).padStart(12)}  ${fmtCost(costs.cacheRead).padStart(10)}${" ".repeat(18)}│`,
    `│  Total  : ${fmt(totalTk).padStart(12)}  ${fmtCost(costs.total).padStart(10)}${" ".repeat(18)}│`,
    `└${"─".repeat(52)}┘`,
    ``,
  ].join("\n");

  process.stderr.write(lines);
}

// ─── Cleanup stale session files ─────────────────────────────────────────────
function pruneStaleFiles() {
  try {
    const cutoff = Date.now() - (STALE_DAYS * 24 * 60 * 60 * 1000);

    // Prune session stats
    if (fs.existsSync(STATS_DIR)) {
      for (const file of fs.readdirSync(STATS_DIR)) {
        const filePath = path.join(STATS_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    }

    // Prune old per-session cache JSON
    if (fs.existsSync(CACHE_DIR)) {
      for (const file of fs.readdirSync(CACHE_DIR)) {
        if (!file.endsWith(".json")) continue;
        const filePath = path.join(CACHE_DIR, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch { /* non-fatal */ }
}

// ─── Find the most recently modified transcript JSONL ────────────────────────
function findLatestTranscript() {
  if (!fs.existsSync(PROJECTS_DIR)) return null;

  let latest = null;
  let latestMtime = 0;

  for (const projectDir of fs.readdirSync(PROJECTS_DIR)) {
    const projectPath = path.join(PROJECTS_DIR, projectDir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    for (const file of fs.readdirSync(projectPath)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(projectPath, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latest = { path: filePath, sessionId: file.replace(".jsonl", "") };
      }
    }
  }

  return latest;
}

// ─── Build formatted box (shared by writeStatusFiles and query mode) ─────────
function buildBox(totals, sessionId, model) {
  const pricing = getPricing(model);
  const costs   = costBreakdown(totals, pricing);
  const totalTk = (totals.input_tokens || 0) + (totals.output_tokens || 0);
  const sid     = (sessionId ?? "--------").slice(0, 8);
  const mName   = modelDisplayName(model);

  return [
    `╭─ Claude Token Tracker ──────────────────────────────────╮`,
    `│  Session : ${sid.padEnd(48)}│`,
    `│  Model   : ${mName.padEnd(48)}│`,
    `│  Turns   : ${String(totals.turns).padEnd(48)}│`,
    `├─────────────────────────────────────────────────────────┤`,
    `│  Input   : ${fmt(totals.input_tokens).padStart(12)} tokens    ${fmtCost(costs.input).padStart(10)}${" ".repeat(14)}│`,
    `│  Output  : ${fmt(totals.output_tokens).padStart(12)} tokens    ${fmtCost(costs.output).padStart(10)}${" ".repeat(14)}│`,
    `│  Cache ↑ : ${fmt(totals.cache_creation_input_tokens).padStart(12)} tokens    ${fmtCost(costs.cacheWrite).padStart(10)}${" ".repeat(14)}│`,
    `│  Cache ↓ : ${fmt(totals.cache_read_input_tokens).padStart(12)} tokens    ${fmtCost(costs.cacheRead).padStart(10)}${" ".repeat(14)}│`,
    `├─────────────────────────────────────────────────────────┤`,
    `│  Total   : ${fmt(totalTk).padStart(12)} tokens    ${fmtCost(costs.total).padStart(10)}${" ".repeat(14)}│`,
    `╰─────────────────────────────────────────────────────────╯`,
    `Updated: ${new Date().toLocaleTimeString("en-GB")}`,
  ].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Query mode: parse the latest transcript directly and output to stdout
  if (QUERY_MODE) {
    const latest = findLatestTranscript();
    if (!latest) {
      process.stdout.write("No transcript data found.\n");
      process.exit(0);
    }
    const { totals, model } = await parseTranscript(latest.path);
    const box = buildBox(totals, latest.sessionId, model);
    process.stdout.write(box + "\n");
    process.exit(0);
  }

  // Hook mode: read payload from stdin
  const raw = await readStdin();

  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

  const { session_id, transcript_path } = payload;

  if (!transcript_path) {
    process.exit(0);
  }

  try {
    const { totals, model } = await parseTranscript(transcript_path);
    const box = buildBox(totals, session_id, model);

    // Write per-session and latest stats files
    if (session_id) {
      try {
        fs.mkdirSync(STATS_DIR, { recursive: true });
        const pricing = getPricing(model);
        const costs   = costBreakdown(totals, pricing);
        const mName   = modelDisplayName(model);

        fs.writeFileSync(sessionStatsPath(session_id), box + "\n", "utf8");
        fs.writeFileSync(sessionCompactPath(session_id), `⬡ ${mName} IN:${fmt(totals.input_tokens)} OUT:${fmt(totals.output_tokens)} ~${fmtCost(costs.total)}`, "utf8");

        const latestStats   = path.join(os.homedir(), ".claude", "token-stats.txt");
        const latestCompact = latestStats + ".compact";
        fs.writeFileSync(latestStats,   box + "\n", "utf8");
        fs.writeFileSync(latestCompact, `⬡ ${mName} IN:${fmt(totals.input_tokens)} OUT:${fmt(totals.output_tokens)} ~${fmtCost(costs.total)}`, "utf8");
      } catch { /* non-fatal */ }
    }

    printSummary(totals, model, SESSION_END);

    // Persist per-session cache
    if (session_id) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const cacheFile = path.join(CACHE_DIR, `${session_id}.json`);
      fs.writeFileSync(cacheFile, JSON.stringify({ totals, model, updated: Date.now() }), "utf8");
    }

    // Prune files older than STALE_DAYS
    pruneStaleFiles();
  } catch (err) {
    process.stderr.write(`[token-tracker] Error: ${err.message}\n`);
  }

  // Always exit 0 — never block Claude
  process.exit(0);
}

main();
