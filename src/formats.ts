import { ConnLimitRule, ConversionResult, LimitReqApplication, RateLimitRule, RatePeriod } from './types';

// nginx groups a limit into two directives: limit_req_zone (defines the
// bucket) and limit_req (applies it, with burst/nodelay/delay). We fold
// both back into a single RateLimitRule keyed by zone name. limit_conn
// works the same way, but limit_conn's second directive is positional
// (`limit_conn zone number;`) rather than zone=name.
export function parseNginx(text: string): ConversionResult {
  const warnings: string[] = [];
  const zones = new Map<string, RateLimitRule>();
  const connZones = new Map<string, ConnLimitRule>();
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
        applications: [],
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
      const application: LimitReqApplication = {};
      for (const tok of tokens.slice(1)) {
        if (tok.startsWith('zone=')) continue;
        else if (tok.startsWith('burst=')) application.burst = Number(tok.slice('burst='.length));
        else if (tok === 'nodelay') application.nodelay = true;
        else if (tok.startsWith('delay=')) application.delay = Number(tok.slice('delay='.length));
        else warnings.push(`line ${i + 1}: unrecognized limit_req option "${tok}"`);
      }
      rule.applications.push(application);
    } else if (directive === 'limit_conn_zone') {
      const key = tokens[1];
      const zoneToken = tokens.find((t) => t.startsWith('zone='));
      if (!key || !zoneToken) {
        warnings.push(`line ${i + 1}: malformed limit_conn_zone, skipped`);
        continue;
      }
      const zoneMatch = zoneToken.match(/^zone=([^:]+):(.+)$/);
      if (!zoneMatch) {
        warnings.push(`line ${i + 1}: could not parse zone, skipped`);
        continue;
      }
      const [, name, zoneSize] = zoneMatch;
      connZones.set(name, { name, key, zoneSize, conn: 0 });
    } else if (directive === 'limit_conn') {
      const name = tokens[1];
      const conn = Number(tokens[2]);
      if (!name || !tokens[2] || Number.isNaN(conn)) {
        warnings.push(`line ${i + 1}: malformed limit_conn, skipped`);
        continue;
      }
      const rule = connZones.get(name);
      if (!rule) {
        warnings.push(`line ${i + 1}: limit_conn references unknown zone "${name}", skipped`);
        continue;
      }
      rule.conn = conn;
    } else {
      warnings.push(`line ${i + 1}: unrecognized directive "${directive}", skipped`);
    }
  }

  return { rules: Array.from(zones.values()), connLimits: Array.from(connZones.values()), warnings };
}

export function generateNginx(rules: RateLimitRule[], connLimits: ConnLimitRule[] = []): string {
  const lines: string[] = [];
  for (const r of rules) {
    lines.push(`limit_req_zone ${r.key} zone=${r.name}:${r.zoneSize} rate=${r.rateLimit}r/${r.ratePeriod};`);
  }
  for (const c of connLimits) {
    lines.push(`limit_conn_zone ${c.key} zone=${c.name}:${c.zoneSize};`);
  }
  for (const r of rules) {
    // A zone with no recorded application still needs a bare limit_req
    // line to actually take effect; one with several emits one line each.
    const applications = r.applications.length > 0 ? r.applications : [{}];
    for (const app of applications) {
      const parts = [`limit_req zone=${r.name}`];
      if (app.burst !== undefined) parts.push(`burst=${app.burst}`);
      if (app.nodelay) parts.push('nodelay');
      else if (app.delay !== undefined) parts.push(`delay=${app.delay}`);
      lines.push(parts.join(' ') + ';');
    }
  }
  for (const c of connLimits) {
    lines.push(`limit_conn ${c.name} ${c.conn};`);
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
      applications: [],
    };
    if (r.applications !== undefined) {
      if (!Array.isArray(r.applications)) {
        warnings.push(`rule ${label}: "applications" is not an array, skipped`);
      } else {
        r.applications.forEach((rawApp, appIndex) => {
          if (typeof rawApp !== 'object' || rawApp === null) {
            warnings.push(`rule ${label}: application ${appIndex} is not an object, skipped`);
            return;
          }
          const a = rawApp as Record<string, unknown>;
          const application: LimitReqApplication = {};
          if (typeof a.burst === 'number') application.burst = a.burst;
          if (typeof a.nodelay === 'boolean') application.nodelay = a.nodelay;
          if (typeof a.delay === 'number') application.delay = a.delay;
          rule.applications.push(application);
        });
      }
    }
    rules.push(rule);
  });

  const connLimits: ConnLimitRule[] = [];
  const rawConnLimits = (data as { connLimits?: unknown }).connLimits;
  if (rawConnLimits !== undefined) {
    if (!Array.isArray(rawConnLimits)) {
      warnings.push('"connLimits" is not an array, skipped');
    } else {
      rawConnLimits.forEach((raw, index) => {
        if (typeof raw !== 'object' || raw === null) {
          warnings.push(`connLimit ${index}: not an object, skipped`);
          return;
        }
        const c = raw as Record<string, unknown>;
        const label = typeof c.name === 'string' ? c.name : `#${index}`;
        if (
          typeof c.name !== 'string' ||
          typeof c.key !== 'string' ||
          typeof c.zoneSize !== 'string' ||
          typeof c.conn !== 'number'
        ) {
          warnings.push(`connLimit ${label}: missing or invalid required field, skipped`);
          return;
        }
        connLimits.push({ name: c.name, key: c.key, zoneSize: c.zoneSize, conn: c.conn });
      });
    }
  }

  return { rules, connLimits, warnings };
}

export function generateCanonicalJson(rules: RateLimitRule[], connLimits: ConnLimitRule[] = []): string {
  const data: Record<string, unknown> = { rules };
  if (connLimits.length > 0) data.connLimits = connLimits;
  return JSON.stringify(data, null, 2) + '\n';
}
