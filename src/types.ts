export type RatePeriod = 's' | 'm';

export interface RateLimitRule {
  name: string;
  key: string;
  rateLimit: number;
  ratePeriod: RatePeriod;
  zoneSize: string;
  burst?: number;
  nodelay?: boolean;
  delay?: number;
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
