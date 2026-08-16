/**
 * Threat scanning for agent-authored memory and skill content.
 *
 * Ported as a small, dependency-free subset of Hermes Agent's
 * `tools/threat_patterns.py` + hermes-claw `threats.ts`. The policy is the
 * load-bearing part: ANY in-scope hit blocks. Severity and category are
 * metadata for diagnostics only.
 */

export type ThreatScope = 'all' | 'context' | 'strict'

export interface ThreatFinding {
  label: string
  category: string
  scope: ThreatScope
}

interface ThreatPattern extends ThreatFinding {
  regex: RegExp
}

const FILLER = String.raw`(?:\w+\s+){0,8}`

const PATTERNS: ThreatPattern[] = [
  // Prompt injection / rule override.
  { label: 'prompt_injection_ignore', category: 'prompt_injection', scope: 'all', regex: new RegExp(String.raw`ignore\s+${FILLER}(?:previous|above|prior|all)\s+${FILLER}instructions`, 'i') },
  { label: 'disregard_rules', category: 'prompt_injection', scope: 'all', regex: /disregard\s+(?:your|all|any)\s+(?:instructions|rules|guidelines)/i },
  { label: 'system_prompt_override', category: 'prompt_injection', scope: 'all', regex: /system\s+prompt\s+override/i },
  { label: 'bypass_restrictions', category: 'prompt_injection', scope: 'all', regex: /act\s+as\s+(?:if|though)\s+(?:you\s+)?(?:have\s+no|don'?t\s+have)\s+(?:restrictions?|limits?|rules)/i },
  { label: 'new_system_prompt', category: 'prompt_injection', scope: 'strict', regex: new RegExp(String.raw`new\s+${FILLER}system\s+${FILLER}prompt`, 'i') },
  { label: 'forget_everything', category: 'prompt_injection', scope: 'strict', regex: new RegExp(String.raw`forget\s+${FILLER}(?:everything|all)\s+${FILLER}(?:discussed|you\s+know)`, 'i') },

  // Role hijacking / jailbreak-adjacent instructions.
  { label: 'role_hijack', category: 'role_hijacking', scope: 'context', regex: /you\s+are\s+now\s+(?:a|an|the|acting|playing|pretending)/i },
  { label: 'fake_update', category: 'role_hijacking', scope: 'context', regex: new RegExp(String.raw`you\s+have\s+been\s+${FILLER}(?:updated|upgraded|patched)\s+to`, 'i') },
  { label: 'identity_override', category: 'role_hijacking', scope: 'context', regex: /\bname\s+yourself\s+\w+/i },
  { label: 'remove_filters', category: 'role_hijacking', scope: 'context', regex: /(?:respond|answer|reply)\s+without\s+(?:restrictions?|limitations?|filters?|safety)/i },

  // Deception and context exfiltration.
  { label: 'deception_hide', category: 'deception', scope: 'all', regex: new RegExp(String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user`, 'i') },
  { label: 'leak_system_prompt', category: 'deception', scope: 'context', regex: new RegExp(String.raw`output\s+${FILLER}(?:system|initial)\s+prompt`, 'i') },
  { label: 'context_exfil', category: 'exfiltration', scope: 'strict', regex: /(?:include|output|print|share)\s+(?:the\s+)?(?:conversation|chat\s+history|previous\s+messages|(?:full|entire)\s+context)/i },
  { label: 'send_to_url', category: 'exfiltration', scope: 'strict', regex: /(?:send|post|upload|transmit)\s+[^\n]{0,512}\s+(?:to|at)\s+https?:\/\//i },

  // Shell-based secret exfiltration.
  { label: 'exfil_curl', category: 'exfiltration', scope: 'all', regex: /curl\s+[^\n]{0,512}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i },
  { label: 'exfil_wget', category: 'exfiltration', scope: 'all', regex: /wget\s+[^\n]{0,512}\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i },
  { label: 'read_secrets', category: 'exfiltration', scope: 'all', regex: /cat\s+[^\n]{0,512}(?:\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i },

  // Persistence / backdoor / harness-config tampering.
  { label: 'ssh_backdoor', category: 'persistence', scope: 'strict', regex: /authorized_keys/i },
  { label: 'agent_config_mod', category: 'persistence', scope: 'strict', regex: /(?:update|modify|edit|write|change|append|add\s+to)\s+(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)/i },
  { label: 'hermes_env', category: 'persistence', scope: 'strict', regex: /\$?HOME\/\.hermes|~\/\.hermes|\.hermes\/\.env/i },

  // C2 / promptware vocabulary.
  { label: 'c2_node_registration', category: 'c2_promptware', scope: 'context', regex: /register\s+(?:as\s+)?a?\s*node/i },
  { label: 'c2_heartbeat', category: 'c2_promptware', scope: 'context', regex: /(?:heartbeats?|beacon|check[\s-]?in)\s+(?:to|with)/i },
  { label: 'c2_task_pull', category: 'c2_promptware', scope: 'context', regex: /pull\s+(?:new\s+)?tasks?/i },
  { label: 'known_c2_framework', category: 'c2_promptware', scope: 'context', regex: /\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b/i },

  // Hardcoded secrets.
  { label: 'hardcoded_secret', category: 'hardcoded_secrets', scope: 'strict', regex: /(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][a-z0-9+/=_-]{20,}["']/i },
  { label: 'private_key_block', category: 'hardcoded_secrets', scope: 'all', regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/ },
]

const ZERO_WIDTH_CHARS = /[\u200b\u200c\u200d\u2060\u2062\u2063\u2064\ufeff]/
const BIDI_CHARS = /[\u202a-\u202e\u2066-\u2069]/

const SCOPE_ORDER: Record<ThreatScope, number> = { all: 1, context: 2, strict: 3 }

/**
 * Scan text at `scope`. Patterns are cumulative: `strict` includes all scopes.
 */
export function scanThreats(text: string, scope: ThreatScope = 'strict'): ThreatFinding[] {
  const findings: ThreatFinding[] = []
  if (ZERO_WIDTH_CHARS.test(text)) {
    findings.push({ label: 'unicode_zero_width', category: 'unicode_obfuscation', scope })
  }
  if (BIDI_CHARS.test(text)) {
    findings.push({ label: 'unicode_bidi_override', category: 'unicode_obfuscation', scope })
  }
  const normalized = text.normalize('NFKC').slice(0, 65_536)
  for (const pattern of PATTERNS) {
    if (SCOPE_ORDER[pattern.scope] > SCOPE_ORDER[scope]) continue
    if (pattern.regex.test(normalized)) findings.push({
      label: pattern.label,
      category: pattern.category,
      scope: pattern.scope,
    })
  }
  return findings
}

/** Blocking policy: any hit blocks. `severity` is deliberately not a gate. */
export function evaluateThreat(text: string, scope: ThreatScope = 'strict'): { blocked: boolean; findings: ThreatFinding[] } {
  const findings = scanThreats(text, scope)
  return { blocked: findings.length > 0, findings }
}

/** User-facing block message for memory writes. */
export function scanMemoryThreats(text: string): string | null {
  const { blocked, findings } = evaluateThreat(text, 'strict')
  if (!blocked) return null
  const pattern = findings.find(f => f.category !== 'unicode_obfuscation')
  if (pattern) return `Blocked by security scan (${pattern.label}). Rephrase without instruction-like language.`
  return 'Blocked by security scan: invisible or potentially malicious Unicode detected.'
}

/** User-facing block message for skill content writes. */
export function scanContentThreats(text: string): string | null {
  const { blocked, findings } = evaluateThreat(text, 'strict')
  if (!blocked) return null
  return `Blocked by security scan (${findings[0]?.label ?? 'unknown'}). This content appears to contain potentially malicious instructions.`
}
