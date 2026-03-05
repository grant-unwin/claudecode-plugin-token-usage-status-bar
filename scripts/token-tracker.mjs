#!/usr/bin/env node
/**
 * token-tracker.mjs
 * Claude Code Plugin — Token Tracker
 *
 * Fires on Stop and SessionEnd hooks.
 * Reads the session transcript JSONL, sums all usage blocks,
 * and prints a running total to stderr (visible in the Claude Code terminal).
 */

import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";

const SESSION_END  = process.argv.includes("--session-end");
const CACHE_DIR    = path.join(os.homedir(), ".claude", "token-tracker");
const STATS_FILE   = path.join(os.homedir(), ".claude", "token-stats.txt");
const COMPACT_FILE = STATS_FILE + ".compact";

// ─── Pricing (per 1M tokens) ─────────────────────────────────────────────────
// Defaults to Claude Sonnet 4.5 rates. Edit to match your model.
const PRICING = {
  input:        3.00,
  output:      15.00,
  cache_write:  3.75,
  cache_read:   0.30,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n || 0).toLocaleString("en-GB");
}

function estimateCost(t) {
  return (
    ((t.input_tokens || 0)                / 1_000_000) * PRICING.input +
    ((t.output_tokens || 0)               / 1_000_000) * PRICING.output +
    ((t.cache_creation_input_tokens || 0) / 1_000_000) * PRICING.cache_write +
    ((t.cache_read_input_tokens || 0)     / 1_000_000) * PRICING.cache_read
  );
}

function fmtCost(cost) {
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01)   return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
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

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return totals;

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
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

  return totals;
}

// ─── Write persistent status files (for tmux / watch) ────────────────────────
function writeStatusFiles(totals, sessionId) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });

    const cost  = estimateCost(totals);
    const total = (totals.input_tokens || 0) + (totals.output_tokens || 0);
    const sid   = (sessionId ?? "--------").slice(0, 8);

    const box = [
      `╭─ Claude Token Tracker ──────────────────────────────────╮`,
      `│  Session : ${sid.padEnd(48)}│`,
      `│  Turns   : ${String(totals.turns).padEnd(48)}│`,
      `├─────────────────────────────────────────────────────────┤`,
      `│  Input   : ${fmt(totals.input_tokens).padStart(12)} tokens${" ".repeat(28)}│`,
      `│  Output  : ${fmt(totals.output_tokens).padStart(12)} tokens${" ".repeat(28)}│`,
      `│  Cache ↑ : ${fmt(totals.cache_creation_input_tokens).padStart(12)} tokens (written)${" ".repeat(14)}│`,
      `│  Cache ↓ : ${fmt(totals.cache_read_input_tokens).padStart(12)} tokens (read)${" ".repeat(17)}│`,
      `├─────────────────────────────────────────────────────────┤`,
      `│  Total   : ${fmt(total).padStart(12)} tokens  ~${fmtCost(cost).padStart(10)}${" ".repeat(17)}│`,
      `╰─────────────────────────────────────────────────────────╯`,
      `Updated: ${new Date().toLocaleTimeString("en-GB")}`,
    ].join("\n");

    fs.writeFileSync(STATS_FILE,   box + "\n", "utf8");
    fs.writeFileSync(COMPACT_FILE, `⬡ IN:${fmt(totals.input_tokens)} OUT:${fmt(totals.output_tokens)} ~${fmtCost(cost)}`, "utf8");
  } catch { /* non-fatal */ }
}

// ─── Print inline summary to stderr (shows in Claude Code terminal) ───────────
function printSummary(totals, sessionEnd = false) {
  const cost  = estimateCost(totals);
  const total = (totals.input_tokens || 0) + (totals.output_tokens || 0);
  const label = sessionEnd ? "Session Final" : "Token Usage";

  const lines = [
    ``,
    `┌─ ${label} ${"─".repeat(50 - label.length - 1)}┐`,
    `│  Input  : ${fmt(totals.input_tokens).padStart(12)}   Output : ${fmt(totals.output_tokens).padStart(12)}  │`,
    `│  Cache↑ : ${fmt(totals.cache_creation_input_tokens).padStart(12)}   Cache↓ : ${fmt(totals.cache_read_input_tokens).padStart(12)}  │`,
    `│  Total  : ${fmt(total).padStart(12)} tokens       ~${fmtCost(cost).padStart(10)}  │`,
    `└${"─".repeat(52)}┘`,
    ``,
  ].join("\n");

  process.stderr.write(lines);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const raw = await readStdin();

  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

  const { session_id, transcript_path } = payload;

  if (!transcript_path) {
    process.exit(0);
  }

  try {
    const totals = await parseTranscript(transcript_path);
    writeStatusFiles(totals, session_id);
    printSummary(totals, SESSION_END);

    // Persist per-session cache
    if (session_id) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const cacheFile = path.join(CACHE_DIR, `${session_id}.json`);
      fs.writeFileSync(cacheFile, JSON.stringify({ totals, updated: Date.now() }), "utf8");
    }
  } catch (err) {
    process.stderr.write(`[token-tracker] Error: ${err.message}\n`);
  }

  // Always exit 0 — never block Claude
  process.exit(0);
}

main();
