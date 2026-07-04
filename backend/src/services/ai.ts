import { streamText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAnthropic } from '@ai-sdk/anthropic'
import { Bindings, GenerateRequest } from '../types'

const GEMINI_MODEL_PREFERENCES = [
  'models/gemini-2.5-flash',
  'models/gemini-2.5-pro',
  'models/gemini-2.0-flash',
  'models/gemini-2.0-flash-lite',
  'models/gemini-1.5-flash',
  'models/gemini-1.5-pro',
  'models/gemini-pro'
]

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20240620'

interface GoogleModel {
  name: string
  supportedGenerationMethods?: string[]
}

let cachedGoogleModelName: string | null = null

function normalizeGeminiModelName(modelName: string) {
  const trimmed = modelName.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('models/') ? trimmed : `models/${trimmed}`
}

function canStream(model: GoogleModel) {
  return model.supportedGenerationMethods?.includes('streamGenerateContent') ||
    model.supportedGenerationMethods?.includes('generateContent')
}

async function resolveGoogleModelName(apiKey: string, configuredModel?: string) {
  if (configuredModel) return normalizeGeminiModelName(configuredModel)
  if (cachedGoogleModelName) return cachedGoogleModelName

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`)
  const payload = await response.json().catch(() => null) as { models?: GoogleModel[]; error?: { message?: string } } | null

  if (!response.ok) {
    const message = payload?.error?.message || `Google model list request failed with HTTP ${response.status}`
    throw new Error(`Gemini API key/model discovery failed: ${message}`)
  }

  const models = payload?.models || []
  const streamableModels = models.filter(canStream)
  const preferredModel = GEMINI_MODEL_PREFERENCES.find((candidate) => {
    return streamableModels.some((model) => model.name === candidate)
  })
  const selectedModel = preferredModel || streamableModels[0]?.name

  if (!selectedModel) {
    throw new Error('Gemini API returned no models that support content generation for this key.')
  }

  cachedGoogleModelName = selectedModel
  return selectedModel
}

export const SYSTEM_PROMPT = `You are Goblin, an elite Principal Developer Advocate and AI coding assistant embedded directly inside documentation.
Your job is to analyze the provided documentation markdown and produce the most useful developer-facing output grounded strictly in those pages.

Choose the response shape based on the actual evidence in the selected docs:
- If the docs are conceptual/overview pages and do not contain concrete SDK methods, commands, configuration fields, API endpoints, or code, return only:
  1. 📖 **Executive Summary**
  2. **Key Concepts**
  3. **When to Use This**
- If the docs contain implementation steps but no code, return:
  1. 📖 **Executive Summary**
  2. 🛠️ **Integration Steps**
  3. **Required Inputs / Configuration**
- If the docs contain actual code, SDK calls, commands, API endpoints, or enough implementation detail to write grounded code, return:
  1. 📖 **Executive Summary**
  2. 🛠️ **Step-by-Step Integration Guide**
  3. 💻 **Working Code Examples**

Never invent APIs, packages, methods, parameters, or code examples that are not supported by the selected docs. If code is not present or cannot be derived safely, do not include a code section. Be concise, technical, and formatted in clean GitHub-flavored Markdown.`

export class AIService {
  private bindings: Bindings

  constructor(bindings: Bindings) {
    this.bindings = bindings
  }

  async generateStream(req: GenerateRequest, onFinish?: (fullText: string, tokenCount: number) => void): Promise<Response> {
    const promptContent = `Here is the official documentation markdown extracted from ${req.urls.length} selected pages (${req.urls.join(', ')}):
\n---\n${req.markdown}\n---\n
    User Request: ${req.prompt || 'Please analyze these selected documentation pages and return the most useful grounded output. Only include integration steps or code examples when the selected docs provide enough implementation detail to support them.'}`

    // Check if Google GenAI / Gemini key is present
    const geminiKey = this.bindings.GOOGLE_GENERATIVE_AI_API_KEY || this.bindings.GEMINI_API_KEY
    if (geminiKey) {
      const google = createGoogleGenerativeAI({ apiKey: geminiKey })
      const configuredModel = this.bindings.GOOGLE_GENERATIVE_AI_MODEL || this.bindings.GEMINI_MODEL
      const modelName = await resolveGoogleModelName(geminiKey, configuredModel)

      console.log(`[AI] Streaming with Google model: ${modelName}`)
      const result = await streamText({
        model: google(modelName) as any,
        system: SYSTEM_PROMPT,
        prompt: promptContent,
        onFinish: (event) => {
          if (onFinish) {
            // Estimate token count (~4 characters per token)
            const estimatedTokens = Math.ceil((promptContent.length + event.text.length) / 4)
            onFinish(event.text, estimatedTokens)
          }
        }
      })
      return result.toDataStreamResponse()
    }

    // Check if Anthropic key is present
    if (this.bindings.ANTHROPIC_API_KEY) {
      const anthropic = createAnthropic({ apiKey: this.bindings.ANTHROPIC_API_KEY })
      const result = await streamText({
        model: anthropic(this.bindings.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL) as any,
        system: SYSTEM_PROMPT,
        prompt: promptContent,
        onFinish: (event) => {
          if (onFinish) {
            const estimatedTokens = Math.ceil((promptContent.length + event.text.length) / 4)
            onFinish(event.text, estimatedTokens)
          }
        }
      })
      return result.toDataStreamResponse()
    }

    // Fallback Mock Stream if no API keys are configured locally yet
    return this.createMockStream(req.urls, onFinish)
  }

  private createMockStream(urls: string[], onFinish?: (fullText: string, tokenCount: number) => void): Response {
    const mockResponseText = `# 📖 Executive Summary
You selected **${urls.length} documentation page(s)**:
${urls.map(u => `- \`${u}\``).join('\n')}

This module provides core primitives for building cross-chain applications and native token transfers with minimal slippage and high security.

---

# 🛠️ Step-by-Step Integration Guide

### 1. Install SDK & Dependencies
To get started, install the official client packages:
\`\`\`bash
npm install @wormhole-foundation/sdk
\`\`\`

### 2. Initialize the Client
Configure the client with your target network (Mainnet or Testnet):
\`\`\`typescript
import { Wormhole } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";

const wh = new Wormhole("Testnet", [evm, solana]);
\`\`\`

---

# 💻 Production-Ready Code Examples

### Native Token Transfer (NTT) Flow
Here is a complete, working example grounded in the documentation:

\`\`\`typescript
async function transferTokens(wh: Wormhole<"Testnet">) {
  // Get chain contexts
  const sendChain = wh.getChain("Solana");
  const rcvChain = wh.getChain("Ethereum");

  console.log("Initializing cross-chain bridge for Native Token Transfers...");
  // Note: Add your live API keys to wrangler.toml to generate live dynamic AI responses!
}
\`\`\`

> [!NOTE]
> *This is a simulated edge response from Hono on Cloudflare Workers. To enable live Gemini / Claude generation, add your API key to \`wrangler.toml\` or \`.dev.vars\`!*`

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const chunks = mockResponseText.split('\n')
        for (const chunk of chunks) {
          // Send formatted Vercel AI SDK data stream protocol (0:"text"\n)
          controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk + '\n')}\n`))
          await new Promise((resolve) => setTimeout(resolve, 35)) // Simulate streaming latency
        }
        if (onFinish) {
          onFinish(mockResponseText, 500)
        }
        controller.close()
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    })
  }
}
