import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { clerkMiddleware, getAuth } from '@hono/clerk-auth'
import { Bindings, GenerateRequest } from './types'
import { CacheService } from './services/cache'
import { AuthService } from './services/auth'
import { AIService } from './services/ai'

const app = new Hono<{ Bindings: Bindings }>()

function getUserId(c: { env: Bindings }, auth: { userId?: string | null } | null) {
  return auth?.userId || c.env.DEV_USER_ID || 'anonymous-dev-user'
}

// Enable CORS for Chrome Extension (chrome-extension://*) and arbitrary docs sites
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Clerk-Auth'],
  exposeHeaders: ['Content-Length', 'X-Cache-Status'],
  maxAge: 86400,
}))

// Optional Clerk Middleware (runs if CLERK keys are configured in environment)
app.use('*', async (c, next) => {
  if (c.env.CLERK_PUBLISHABLE_KEY && c.env.CLERK_SECRET_KEY) {
    return clerkMiddleware()(c, next)
  }
  await next()
})

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'goblin-backend',
    runtime: 'cloudflare-workers',
    timestamp: new Date().toISOString(),
  })
})

// Get User Token Usage & Quota Status
app.get('/api/usage', async (c) => {
  const auth = c.env.CLERK_PUBLISHABLE_KEY ? getAuth(c) : null
  const userId = getUserId(c, auth)

  const authService = new AuthService(c.env)
  const usage = await authService.getUserUsage(userId)

  return c.json({
    success: true,
    usage,
  })
})

// Dev helper: reset the current monthly usage bucket for the active dev user.
app.post('/api/usage/reset', async (c) => {
  const auth = c.env.CLERK_PUBLISHABLE_KEY ? getAuth(c) : null
  const userId = getUserId(c, auth)

  const authService = new AuthService(c.env)
  await authService.resetUsage(userId)

  return c.json({
    success: true,
    userId
  })
})

// Main AI Generation Endpoint (Summary, Integration Guide, Code Examples)
app.post('/api/generate', async (c) => {
  try {
    const auth = c.env.CLERK_PUBLISHABLE_KEY ? getAuth(c) : null
    const userId = getUserId(c, auth)

    const body = await c.req.json<GenerateRequest>()
    if (!body.urls || !body.markdown || body.urls.length === 0) {
      return c.json({ error: 'Missing required fields: urls and markdown are required.' }, 400)
    }

    const authService = new AuthService(c.env)
    const cacheService = new CacheService(c.env)
    const aiService = new AIService(c.env)

    // 1. Estimate tokens (~4 characters per token)
    const estimatedTokens = Math.ceil(body.markdown.length / 4) + 1500

    // 2. Check User Quota / Billing limit
    const quota = await authService.checkQuota(userId, estimatedTokens)
    if (!quota.allowed) {
      return c.json({
        error: quota.reason,
        usage: quota.usage,
        upgradeRequired: true
      }, 429)
    }

    // 3. Check Shared Upstash Redis Cache
    const cacheKey = await cacheService.generateCacheKey(body.urls, body.markdown, body.prompt)
    const cachedContent = await cacheService.getCachedResponse(cacheKey)

    if (cachedContent) {
      console.log(`[Cache HIT] Serving instant cached response for key ${cacheKey}`)
      // Format as Vercel AI SDK data stream so extension streaming parser works identically
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`0:${JSON.stringify(cachedContent)}\n`))
          controller.close()
        }
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Cache-Status': 'HIT',
        }
      })
    }

    console.log(`[Cache MISS] Generating live AI stream for key ${cacheKey}`)
    // 4. Stream from AI Model & Save to Cache on Finish
    const response = await aiService.generateStream(body, async (fullText, tokenCount) => {
      // Background execution: Cache the result and log token usage
      await Promise.all([
        cacheService.setCachedResponse(cacheKey, fullText),
        authService.incrementUsage(userId, tokenCount)
      ])
    })

    // Add Cache MISS header
    const headers = new Headers(response.headers)
    headers.set('X-Cache-Status', 'MISS')

    return new Response(response.body, {
      status: response.status,
      headers
    })

  } catch (err: any) {
    console.error('Generate API Error:', err)
    return c.json({ error: err.message || 'Internal Server Error' }, 500)
  }
})

export default app
