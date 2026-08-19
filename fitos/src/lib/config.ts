/**
 * Required configuration, validated at the point of use.
 *
 * The identity peppers used to be `process.env.X ?? 'dev-only-secret'`. That is
 * the most dangerous shape a secret can take: a deployment that forgets the
 * variable gets a working application with a publicly-known HMAC key, every
 * contact hash derived from a value that is in the repository, and no symptom
 * whatsoever. CLAUDE.md is explicit — a pepper is "never defaulted to a
 * hard-coded value".
 *
 * So there is no default. Missing means the process refuses to hash.
 */

export class ConfigurationError extends Error {
  readonly variable: string;
  constructor(variable: string, problem: string) {
    super(
      `${variable} ${problem}.\n` +
      `Generate one with:  openssl rand -base64 48\n` +
      `Local development:  source dev.env  (or see .env.example)\n` +
      `This value is a cryptographic pepper. Changing it invalidates every ` +
      `phone_lookup_hash already stored — see docs/05, "Identity peppers".`);
    this.name = 'ConfigurationError';
    this.variable = variable;
  }
}

/**
 * Values that once shipped as fallbacks, or that people reach for by reflex.
 * Rejected outright rather than behind a bypass flag: an escape hatch like
 * FITOS_ALLOW_DEV_SECRETS is precisely the thing that gets set on a staging box
 * "temporarily" and is still set two years later. Local development supplies
 * explicit values through dev.env instead, which costs one line and cannot
 * silently follow a build into production.
 */
const REJECTED_VALUES = new Set([
  'dev-only-org-secret',
  'dev-only-identity-secret',
  'dev-only:FITOS_ORG_HASH_SECRET',
  'dev-only:FITOS_IDENTITY_SECRET',
  'secret', 'changeme', 'change-me', 'fitos', 'test', 'password', 'placeholder',
]);

const MIN_LENGTH = 32;

/**
 * Read a required secret, or throw.
 *
 * The error names the variable and never its value — an exception message ends
 * up in logs, in Sentry, and in a screenshot pasted into chat.
 */
export function requireSecret(variable: string): string {
  const raw = process.env[variable];

  if (raw === undefined) throw new ConfigurationError(variable, 'is not set');
  if (raw.trim() === '') throw new ConfigurationError(variable, 'is set but empty');
  if (REJECTED_VALUES.has(raw.trim())) {
    throw new ConfigurationError(variable, 'is set to a known placeholder value');
  }
  if (raw.length < MIN_LENGTH) {
    throw new ConfigurationError(
      variable, `is shorter than ${MIN_LENGTH} characters, which is too short for a pepper`);
  }
  return raw;
}

/** The two secrets identity hashing cannot run without. */
export const IDENTITY_SECRET_VARS = ['FITOS_ORG_HASH_SECRET', 'FITOS_IDENTITY_SECRET'] as const;

/**
 * Validate identity configuration up front, so a misconfigured process fails at
 * startup rather than at the moment an associate types a customer's phone
 * number. Reports every problem at once: fixing one variable only to be told
 * about the next is a bad way to learn your deployment is wrong.
 */
export function assertIdentityConfig(): void {
  const problems: string[] = [];
  for (const variable of IDENTITY_SECRET_VARS) {
    try { requireSecret(variable); } catch (err) {
      problems.push((err as Error).message.split('\n')[0]);
    }
  }
  if (problems.length) {
    throw new ConfigurationError(
      problems.length === 1 ? IDENTITY_SECRET_VARS[0] : 'Identity configuration',
      `is incomplete:\n  - ${problems.join('\n  - ')}\n`);
  }
}
