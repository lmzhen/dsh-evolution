// GENERATED FILE — do not edit. Source: packages/scripts/retrieval-contract.json
// Regenerate with: node packages/scripts/gen-retrieval-contract.mjs

export const RETRIEVAL_CREDENTIAL_REFS = {
  embedding: 'SILICONFLOW_API_KEY',
  ranker: 'BAMBOO_API_KEY',
} as const

export const RETRIEVAL_HELP_LINKS = {
  siliconflow: 'https://cloud.siliconflow.cn/account/ak',
  bambooRegister: 'https://bamboonode.dev/register',
  bambooKeys: 'https://bamboonode.dev/tokens',
} as const

export const RETRIEVAL_FIXED_MODELS = {
  embedding: 'Qwen/Qwen3-Embedding-8B',
  embeddingFallback: 'BAAI/bge-m3',
  ranker: 'startlux-decision-27b-autothink',
} as const
