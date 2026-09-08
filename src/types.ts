export type RatePeriod = 's' | 'm';

// A zone can be applied by more than one `limit_req` line (typically one
// per location block using it), each with its own burst/nodelay/delay.
// We flatten the file, so we can't tell which location a given line came
// from, but we keep every application instead of letting later lines
// clobber earlier ones.
export interface LimitReqApplication {
  burst?: number;
  nodelay?: boolean;
  delay?: number;
}

export interface RateLimitRule {
  name: string;
  key: string;
  rateLimit: number;
  ratePeriod: RatePeriod;
  zoneSize: string;
  applications: LimitReqApplication[];
}

export interface ConnLimitRule {
  name: string;
  key: string;
  zoneSize: string;
  conn: number;
}

export interface ConversionResult {
  rules: RateLimitRule[];
  connLimits: ConnLimitRule[];
  warnings: string[];
}
