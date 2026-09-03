# ratelimit-convert

Rate limits usually live in nginx config as `limit_req_zone` / `limit_req`
directives. That's fine until you need to audit them, hand them to someone
who doesn't read nginx syntax, generate them from a policy file, or move
them to a different gateway. This is a small CLI that converts between
nginx's directive syntax and a plain JSON rule format, in either direction.

## Formats

**nginx** — the two directives nginx actually uses:

```nginx
limit_req_zone $binary_remote_addr zone=api_general:10m rate=10r/s;
limit_req zone=api_general burst=20 nodelay;
```

**json** — one object per zone, everything nginx splits across two
directives collapsed into one rule:

```json
{
  "rules": [
    {
      "name": "api_general",
      "key": "$binary_remote_addr",
      "rateLimit": 10,
      "ratePeriod": "s",
      "zoneSize": "10m",
      "burst": 20,
      "nodelay": true
    }
  ]
}
```

`ratePeriod` is `"s"` or `"m"`, matching nginx's `r/s` and `r/m`. `burst`,
`nodelay`, and `delay` are optional, same as in nginx.

## Usage

```
ratelimit-convert <file> [--from nginx|json] [--to nginx|json] [--out <file>] [--json]
```

`--from` is guessed from the file extension (`.conf`/`.nginx` -> nginx,
`.json` -> json) if not given. `--to` defaults to whichever format `--from`
isn't.

Convert an nginx snippet to JSON:

```
$ ratelimit-convert limits.conf
converted 1 rule from nginx to json
{
  "rules": [
    {
      "name": "api_general",
      "key": "$binary_remote_addr",
      "rateLimit": 10,
      "ratePeriod": "s",
      "zoneSize": "10m",
      "burst": 20,
      "nodelay": true
    }
  ]
}
```

The summary line goes to stderr, the converted output goes to stdout, so
`ratelimit-convert limits.conf > policy.json` gives you just the JSON.

## `--json` output mode

By default the tool prints a short status line plus the converted content.
Pass `--json` to get a single JSON object on stdout instead, meant for
scripts and CI rather than a human:

```
$ ratelimit-convert limits.conf --json
{
  "ok": true,
  "from": "nginx",
  "to": "json",
  "ruleCount": 1,
  "warnings": [],
  "wroteTo": null,
  "output": "{\n  \"rules\": [...]\n}\n"
}
```

Errors are reported the same way: a message on stderr by default, or
`{ "ok": false, "error": "..." }` on stdout with `--json`. Malformed lines
in an nginx file (unknown directives, a `limit_req` referencing a zone that
was never defined) don't stop the conversion — they show up in `warnings`
and are skipped.

## Building

There are no runtime dependencies, only the TypeScript compiler as a dev
dependency.

```
npm install
npm run build
node dist/cli.js limits.conf --json
```

## Status

Early. Only the two directives above are handled — no `limit_conn`, no
`$geo`-based keys, no multi-zone `limit_req` lines. See the issues for
what's next.
