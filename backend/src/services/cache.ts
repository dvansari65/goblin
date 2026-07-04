import { Redis } from '@upstash/redis/cloudflare'
import { Bindings } from '../types'

export class CacheService {
  private redis: Redis | null = null

  constructor(bindings: Bindings) {
    if (bindings.UPSTASH_REDIS_REST_URL && bindings.UPSTASH_REDIS_REST_TOKEN) {
      this.redis = new Redis({
        url: bindings.UPSTASH_REDIS_REST_URL,
        token: bindings.UPSTASH_REDIS_REST_TOKEN,
      })
    }
  }

  async generateCacheKey(urls: string[], markdown: string, prompt: string = ''): Promise<string> {
    const data = JSON.stringify({ urls: urls.slice().sort(), markdown, prompt })
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    return `goblin:cache:${hashHex}`
  }

  async getCachedResponse(key: string): Promise<string | null> {
    if (!this.redis) return null
    try {
      return await this.redis.get<string>(key)
    } catch (e) {
      console.error('Redis Get Error:', e)
      return null
    }
  }

  async setCachedResponse(key: string, content: string, ttlSeconds: number = 1209600): Promise<void> {
    if (!this.redis) return
    try {
      // Default TTL: 14 days (1209600 seconds)
      await this.redis.set(key, content, { ex: ttlSeconds })
    } catch (e) {
      console.error('Redis Set Error:', e)
    }
  }
}
