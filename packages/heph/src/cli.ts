#!/usr/bin/env node
import { runCli } from "@heph/cli";

process.exitCode = await runCli(process.argv.slice(2));
