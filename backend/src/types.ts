export interface Bindings {
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  CLERK_PUBLISHABLE_KEY?: string
  CLERK_SECRET_KEY?: string
  GOOGLE_GENERATIVE_AI_API_KEY?: string
  GEMINI_API_KEY?: string
  GOOGLE_GENERATIVE_AI_MODEL?: string
  GEMINI_MODEL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  DISABLE_QUOTA?: string
  DEV_USER_ID?: string
}

export interface GenerateRequest {
  urls: string[]
  markdown: string
  prompt?: string
  model?: 'gemini' | 'anthropic'
}

export interface UserUsage {
  userId: string
  tokensUsedThisMonth: number
  isProSubscriber: boolean
}
