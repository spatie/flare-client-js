#!/usr/bin/env node
import { runCli } from './cli';

runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
