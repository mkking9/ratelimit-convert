# ratelimit-convert

Rate limits usually live in nginx config as `limit_req_zone` / `limit_req`
directives. That's fine until you need to audit them, hand them to someone
who doesn't read nginx syntax, generate them from a policy file, or move
them to a different gateway. This is a small CLI that converts between
nginx's directive syntax and a plain JSON rule format, in either direction.

## Formats

**nginx** — the directives nginx actually uses. Rate limits:

```nginx
limit_req_zone $binary_remote_addr zone=api_general:10m rate=10r/s;
limit_req zone=api_general burst=20 nodelay;
```

The same zone can be applied more than once — typically one `limit_req`
line per location block that uses it, each with its own burst/nodelay/delay:

```nginx
limit_req zone=api_general burst=20 nodelay;
limit_req zone=api_general burst=5;
```

Connection limits (`limit_conn`'s second directive is positional — a bare
zone name and a number, not `zone=`):

```nginx
limit_conn_zone $binary_remote_addr zone=addr:10m;
limit_conn addr 10;
```

**json** — one object per zone, everything nginx splits across the
`limit_req_zone` directive and its `limit_req` directives collapsed into
one rule:

```json
{
  "rules": [
    {
      "name": "api_general",
      "key": "$binary_remote_addr",
      "rateLimit": 10,
      "ratePeriod": "s",
      "zoneSize": "10m",
      "applications": [
        { "burst": 20, "nodelay": true },
        { "burst": 5 }
      ]
    }
  ],
  "connLimits": [
    {
      "name": "addr",
      "key": "$binary_remote_addr",
      "zoneSize": "10m",
      "conn": 10
    }
  ]
}
```

`ratePeriod` is `"s"` or `"m"`, matching nginx's `r/s` and `r/m`.
`applications` holds one entry per `limit_req` line seen for the zone —
each with optional `burst`, `nodelay`, and `delay`, same as in nginx — and
is `[]` when the zone was defined but never applied. `connLimits` is
omitted entirely when there are none.

## Usage

```
ratelimit-convert <file> [--from nginx|json] [--to nginx|json] [--out <file>] [--json] [--validate-only]
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
      "applications": [
        { "burst": 20, "nodelay": true }
      ]
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
  "connLimitCount": 0,
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

## `--validate-only`

Runs the full parse-and-convert pipeline — so it catches the same errors
and warnings a normal run would — but doesn't write anything, whether to
`--out` or stdout:

```
$ ratelimit-convert limits.conf --validate-only
limits.conf is valid: 1 rule (nginx -> json)
```

Combine with `--json` to get the same report object as a normal `--json`
run, minus `output` and `wroteTo`. Useful in CI when you only care whether
a config is convertible, not what it converts to.

## Building

There are no runtime dependencies, only the TypeScript compiler as a dev
dependency.

```
npm install
npm run build
node dist/cli.js limits.conf --json
```

## Status

Early. `limit_req`/`limit_req_zone` and `limit_conn`/`limit_conn_zone` are
handled, including multiple `limit_req` lines against the same zone, but
not `$geo`- or `map`-based keys yet. See the issues for what's next.
