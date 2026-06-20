#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const result = spawnSync("mx-agent-hub", ["validate", "."], {
  stdio: "inherit",
});

process.exit(result.status ?? 2);
