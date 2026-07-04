import { Redis } from '@upstash/redis/cloudflare'
import { Bindings, UserUsage } from '../types'

export const FREE_TOKEN_LIMIT = 50000 // 50,000 free tokens per month before needing Pro

function isTruthy(value: string | undefined) {
  return value === 'true' || value === '1' || value === 'yes'
}

export class AuthService {
  private redis: Redis | null = null
  private quotaDisabled = false

  constructor(bindings: Bindings) {
    this.quotaDisabled = isTruthy(bindings.DISABLE_QUOTA)
    if (bindings.UPSTASH_REDIS_REST_URL && bindings.UPSTASH_REDIS_REST_TOKEN) {
      this.redis = new Redis({
        url: bindings.UPSTASH_REDIS_REST_URL,
        token: bindings.UPSTASH_REDIS_REST_TOKEN,
      })
    }
  }

  async getUserUsage(userId: string): Promise<UserUsage> {
    if (!this.redis || this.quotaDisabled) {
      // If Redis not configured locally, default to free allowance for dev testing
      return { userId, tokensUsedThisMonth: 0, isProSubscriber: false }
    }

    const currentMonth = new Date().toISOString().slice(0, 7) // e.g. "2026-07"
    const usageKey = `goblin:usage:${userId}:${currentMonth}`
    const proKey = `goblin:pro:${userId}`

    try {
      const [tokensUsed, isPro] = await Promise.all([
        this.redis.get<number>(usageKey),
        this.redis.get<boolean>(proKey)
      ])

      return {
        userId,
        tokensUsedThisMonth: tokensUsed || 0,
        isProSubscriber: Boolean(isPro)
      }
    } catch (e) {
      console.error('Redis Quota Error:', e)
      return { userId, tokensUsedThisMonth: 0, isProSubscriber: false }
    }
  }

  async checkQuota(userId: string, estimatedTokens: number = 2000): Promise<{ allowed: boolean; reason?: string; usage: UserUsage }> {
    const usage = await this.getUserUsage(userId)

    if (this.quotaDisabled) {
      return { allowed: true, usage }
    }

    if (usage.isProSubscriber) {
      return { allowed: true, usage }
    }

    if (usage.tokensUsedThisMonth + estimatedTokens > FREE_TOKEN_LIMIT) {
      return {
        allowed: false,
        reason: `Monthly free token limit (${FREE_TOKEN_LIMIT.toLocaleString()} tokens) exceeded. Please upgrade to Goblin Pro!`,
        usage
      }
    }

    return { allowed: true, usage }
  }

  async incrementUsage(userId: string, tokensUsed: number): Promise<void> {
    if (!this.redis || this.quotaDisabled) return
    const currentMonth = new Date().toISOString().slice(0, 7)
    const usageKey = `goblin:usage:${userId}:${currentMonth}`

    try {
      await this.redis.incrby(usageKey, tokensUsed)
      // Set expiry to 45 days so old monthly usage keys automatically clean up
      await this.redis.expire(usageKey, 60 * 60 * 24 * 45)
    } catch (e) {
      console.error('Redis Increment Error:', e)
    }
  }

  async resetUsage(userId: string): Promise<void> {
    if (!this.redis) return
    const currentMonth = new Date().toISOString().slice(0, 7)
    const usageKey = `goblin:usage:${userId}:${currentMonth}`

    try {
      await this.redis.del(usageKey)
    } catch (e) {
      console.error('Redis Reset Usage Error:', e)
    }
  }
}
