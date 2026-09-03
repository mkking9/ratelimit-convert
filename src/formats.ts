import { ConversionResult, RateLimitRule, RatePeriod } from './types';

// nginx groups a limit into two directives: limit_req_zone (defines the
// bucket) and limit_req (applies it, with burst/nodelay/delay). We fold
// both back into a single RateLimitRule keyed by zone name.
export function parseNginx(text: string): ConversionResult {
  const warnings: string[] = [];
  const zones = new Map<string, RateLimitRule>();
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/#.*$/, '').trim();
    if (stripped.length === 0) continue;

    const stmt = stripped.replace(/;\s*$/, '');
    const tokens = stmt.split(/\s+/);
    const directive = tokens[0];

    if (directive === 'limit_req_zone') {
      const key = tokens[1];
      const zoneToken = tokens.find((t) => t.startsWith('zone='));
      const rateToken = tokens.find((t) => t.startsWith('rate='));
      if (!key || !zoneToken || !rateToken) {
        warnings.push(`line ${i + 1}: malformed limit_req_zone, skipped`);
        continue;
      }
      const zoneMatch = zoneToken.match(/^zone=([^:]+):(.+)$/);
      const rateMatch = rateToken.match(/^rate=(\d+)r\/(s|m)$/);
      if (!zoneMatch || !rateMatch) {
        warnings.push(`line ${i + 1}: could not parse zone or rate, skipped`);
        continue;
      }
      const [, name, zoneSize] = zoneMatch;
      const [, rateLimit, ratePeriod] = rateMatch;
      zones.set(name, {
        name,
        key,
        zoneSize,
        rateLimit: Number(rateLimit),
        ratePeriod: ratePeriod as RatePeriod,
      });
    } else if (directive === 'limit_req') {
      const zoneToken = tokens.find((t) => t.startsWith('zone='));
      if (!zoneToken) {
        warnings.push(`line ${i + 1}: limit_req missing zone=, skipped`);
        continue;
      }
      const name = zoneToken.slice('zone='.length);
      const rule = zones.get(name);
      if (!rule) {
        warnings.push(`line ${i + 1}: limit_req references unknown zone "${name}", skipped`);
        continue;
      }
      for (const tok of tokens.slice(1)) {
        if (tok.startsWith('zone=')) continue;
        else if (tok.startsWith('burst=')) rule.burst = Number(tok.slice('burst='.length));
        else if (tok === 'nodelay') rule.nodelay = true;
        else if (tok.startsWith('delay=')) rule.delay = Number(tok.slice('delay='.length));
        else warnings.push(`line ${i + 1}: unrecognized limit_req option "${tok}"`);
      }
    } else {
      warnings.push(`line ${i + 1}: unrecognized directive "${directive}", skipped`);
    }
  }

  return { rules: Array.from(zones.values()), warnings };
}

export function generateNginx(rules: RateLimitRule[]): string {
  const lines: string[] = [];
  for (const r of rules) {
    lines.push(`limit_req_zone ${r.key} zone=${r.name}:${r.zoneSize} rate=${r.rateLimit}r/${r.ratePeriod};`);
  }
  for (const r of rules) {
    const parts = [`limit_req zone=${r.name}`];
    if (r.burst !== undefined) parts.push(`burst=${r.burst}`);
    if (r.nodelay) parts.push('nodelay');
    else if (r.delay !== undefined) parts.push(`delay=${r.delay}`);
    lines.push(parts.join(' ') + ';');
  }
  return lines.join('\n') + '\n';
}

// Canonical format: { "rules": [ { name, key, rateLimit, ratePeriod, zoneSize, ... } ] }
// This is the format meant to be gateway-agnostic, so a policy can be
// reviewed or generated without knowing nginx syntax.
export function parseCanonicalJson(text: string): ConversionResult {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON: ${(err as Error).message}`);
  }

  if (typeof data !== 'object' || data === null || !Array.isArray((data as Record<string, unknown>).rules)) {
    throw new Error('expected an object with a "rules" array');
  }

  const rawRules = (data as { rules: unknown[] }).rules;
  const rules: RateLimitRule[] = [];

  rawRules.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      warnings.push(`rule ${index}: not an object, skipped`);
      return;
    }
    const r = raw as Record<string, unknown>;
    const label = typeof r.name === 'string' ? r.name : `#${index}`;
    if (
      typeof r.name !== 'string' ||
      typeof r.key !== 'string' ||
      typeof r.rateLimit !== 'number' ||
      (r.ratePeriod !== 's' && r.ratePeriod !== 'm') ||
      typeof r.zoneSize !== 'string'
    ) {
      warnings.push(`rule ${label}: missing or invalid required field, skipped`);
      return;
    }

    const rule: RateLimitRule = {
      name: r.name,
      key: r.key,
      rateLimit: r.rateLimit,
      ratePeriod: r.ratePeriod,
      zoneSize: r.zoneSize,
    };
    if (typeof r.burst === 'number') rule.burst = r.burst;
    if (typeof r.nodelay === 'boolean') rule.nodelay = r.nodelay;
    if (typeof r.delay === 'number') rule.delay = r.delay;
    rules.push(rule);
  });

  return { rules, warnings };
}

export function generateCanonicalJson(rules: RateLimitRule[]): string {
  return JSON.stringify({ rules }, null, 2) + '\n';
}
