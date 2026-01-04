#!/usr/bin/env bun
/**
 * Unified development orchestration script.
 * Cross-platform (Windows/Mac/Linux) TypeScript alternative to shell scripts.
 *
 * Usage:
 *   bun scripts/dev.ts dev           # Start dev servers (mode from .env.local)
 *   bun scripts/dev.ts dev --mode X  # Override mode (local/runpod/datalab)
 *   bun scripts/dev.ts secrets       # Push secrets to Cloudflare Workers
 *   bun scripts/dev.ts deploy        # Deploy to production
 */

import { loadEnv } from "./lib/utils";
import { getCommand, printUsage } from "./lib/commands";

interface ParsedArgs {
  command: string | undefined;
  modeOverride: string | undefined;
  dashboardEnabled: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const modeIndex = args.indexOf("--mode");

  return {
    command: args[0],
    modeOverride: modeIndex !== -1 ? args[modeIndex + 1] : undefined,
    dashboardEnabled: args.includes("--dashboard"),
  };
}

async function main(): Promise<void> {
  const { command, modeOverride, dashboardEnabled } = parseArgs(process.argv);

  const cmd = getCommand(command);
  if (!cmd) {
    printUsage();
    return;
  }

  const env = loadEnv(modeOverride);
  await cmd.execute(env, { dashboardEnabled });
}

main();
