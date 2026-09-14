#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { generateCanonicalJson, generateNginx, parseCanonicalJson, parseNginx } from './formats';

type Format = 'nginx' | 'json';

interface Args {
  input: string;
  from?: Format;
  to?: Format;
  out?: string;
  json: boolean;
  validateOnly: boolean;
}

function requireFormat(value: string | undefined, flag: string): Format {
  if (value !== 'nginx' && value !== 'json') {
    throw new Error(`${flag} must be "nginx" or "json"`);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  let input: string | undefined;
  let from: Format | undefined;
  let to: Format | undefined;
  let out: string | undefined;
  let json = false;
  let validateOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--from') from = requireFormat(argv[++i], '--from');
    else if (arg === '--to') to = requireFormat(argv[++i], '--to');
    else if (arg === '--out') out = argv[++i];
    else if (arg === '--json') json = true;
    else if (arg === '--validate-only') validateOnly = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('--') && input === undefined) {
      input = arg;
    } else {
      throw new Error(`unrecognized argument: ${arg}`);
    }
  }

  if (!input) throw new Error('missing input file argument');
  return { input, from, to, out, json, validateOnly };
}

function detectFormat(path: string): Format {
  const ext = extname(path).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.conf' || ext === '.nginx') return 'nginx';
  throw new Error(`cannot detect format from extension "${ext}", pass --from explicitly`);
}

function printHelp(): void {
  console.log(`ratelimit-convert <file> [options]

Converts rate limit rules between nginx directives and a canonical JSON
policy format.

Options:
  --from <nginx|json>   source format (guessed from the file extension if omitted)
  --to <nginx|json>     target format (defaults to the other of the two)
  --out <file>          write the result to a file instead of stdout
  --json                emit a machine-readable JSON report instead of plain output
  --validate-only       parse and convert but don't write the result anywhere
  -h, --help            show this message`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const from = args.from ?? detectFormat(args.input);
  const to = args.to ?? (from === 'nginx' ? 'json' : 'nginx');

  const text = readFileSync(args.input, 'utf8');
  const { rules, connLimits, warnings } = from === 'nginx' ? parseNginx(text) : parseCanonicalJson(text);
  // Run the full pipeline, including generation, so --validate-only catches
  // anything generation would choke on too, not just parse errors.
  const output = to === 'nginx' ? generateNginx(rules, connLimits) : generateCanonicalJson(rules, connLimits);

  if (args.validateOnly) {
    if (args.json) {
      const report = { ok: true, from, to, ruleCount: rules.length, connLimitCount: connLimits.length, warnings };
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return;
    }
    for (const warning of warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    const connSuffix = connLimits.length > 0 ? ` and ${connLimits.length} conn limit${connLimits.length === 1 ? '' : 's'}` : '';
    process.stdout.write(`${args.input} is valid: ${rules.length} rule${rules.length === 1 ? '' : 's'}${connSuffix} (${from} -> ${to})\n`);
    return;
  }

  if (args.out) {
    writeFileSync(args.out, output, 'utf8');
  }

  if (args.json) {
    const report = {
      ok: true,
      from,
      to,
      ruleCount: rules.length,
      connLimitCount: connLimits.length,
      warnings,
      wroteTo: args.out ?? null,
      output: args.out ? undefined : output,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  for (const warning of warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  const connSuffix = connLimits.length > 0 ? ` and ${connLimits.length} conn limit${connLimits.length === 1 ? '' : 's'}` : '';
  process.stderr.write(`converted ${rules.length} rule${rules.length === 1 ? '' : 's'}${connSuffix} from ${from} to ${to}\n`);
  if (args.out) {
    process.stderr.write(`wrote ${args.out}\n`);
  } else {
    process.stdout.write(output);
  }
}

try {
  main();
} catch (err) {
  const message = (err as Error).message;
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ ok: false, error: message }, null, 2) + '\n');
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
  process.exit(1);
}
