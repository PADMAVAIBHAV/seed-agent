import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText, tool, CoreTool } from "ai";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { ProjectFile } from "../tools/projectBuilder.js";

export interface LLMResponse {
  text: string;
  toolCalls?: {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
  }[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  projectBuild?: import("../tools/projectBuilder.js").ProjectBuildResult;
}

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: boolean;
}

export interface GeneratedProject {
  files: ProjectFile[];
}

const PRIMARY_MODEL = "gemini-1.5-flash";
const FALLBACK_MODEL = "gemini-1.5-pro";

const CODE_GEN_SYSTEM_PROMPT = `You are an expert frontend engineer building fast, production-ready React + Tailwind apps.

Build a complete, runnable React + Tailwind project that directly solves the user request.

Requirements:
- Responsive on mobile, tablet, and desktop
- Modern SaaS quality UI with gradients and subtle glassmorphism
- Clean typography hierarchy and strong visual contrast
- Reusable React components with clear separation of concerns
- Tailwind utility patterns that remain readable and maintainable
- Smooth but lightweight interactions and transitions
- Accessible markup (semantic HTML, labels, alt text, focus states)
- Clean folder structure with only necessary files

Output rules:
- Return ONLY strict JSON
- No markdown, no explanations, no code fences
- No keys other than "files"
- Each file must contain both "path" and "content"

Return this exact shape:
{
  "files": [
    { "path": "src/App.tsx", "content": "..." }
  ]
}`;

const CRITIC_SYSTEM_PROMPT = `You are a senior frontend reviewer.

Improve the provided React + Tailwind project quickly without changing its core intent.

Focus on:
- UI polish and consistency
- Mobile responsiveness
- Accessibility improvements
- Reusable components and cleaner structure
- Performance-safe transitions (no heavy animation libraries)

Output rules:
- Return ONLY strict JSON
- No markdown, no explanations, no code fences
- Keep the same schema exactly

Return this exact shape:
{
  "files": [
    { "path": "src/App.tsx", "content": "..." }
  ]
}`;

const GEMINI_MODELS = [PRIMARY_MODEL, FALLBACK_MODEL];

/**
 * Check if an error is a retryable 429 rate limit error.
 * Extracts the suggested retry delay if present.
 */
function parseRateLimitError(error: unknown): { isRateLimit: boolean; retryAfterMs: number } {
  if (!error || typeof error !== "object") return { isRateLimit: false, retryAfterMs: 0 };
  const status = (error as { status?: number }).status;
  const message = String((error as { message?: string }).message || "").toLowerCase();
  const is429 = status === 429 || message.includes("429") || message.includes("rate limit") || message.includes("quota");

  if (!is429) return { isRateLimit: false, retryAfterMs: 0 };

  // Try to extract retryDelay from errorDetails
  const details = (error as { errorDetails?: Array<{ "@type"?: string; retryDelay?: string }> }).errorDetails;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d.retryDelay) {
        const seconds = parseInt(d.retryDelay, 10);
        if (!isNaN(seconds) && seconds > 0) {
          return { isRateLimit: true, retryAfterMs: (seconds + 2) * 1000 };
        }
      }
    }
  }

  const retryDelayMatch = message.match(/(\d+)s/);
  if (retryDelayMatch) {
    const seconds = parseInt(retryDelayMatch[1], 10);
    if (!isNaN(seconds) && seconds > 0) {
      return { isRateLimit: true, retryAfterMs: (seconds + 1) * 1000 };
    }
  }

  return { isRateLimit: true, retryAfterMs: 15_000 };
}

function isModelUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  const message = String((error as { message?: string }).message || "").toLowerCase();
  return (
    status === 404 ||
    message.includes("model not found") ||
    message.includes("not found") ||
    message.includes("unsupported model")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class MalformedJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedJsonError";
  }
}

/**
 * Extract valid JSON from Gemini output
 */
function parseJsonResponse(text: string): GeneratedProject {
  let cleaned = text.trim();

  // Remove markdown code fences
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "");

  // Extract JSON block
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new MalformedJsonError("No JSON object found in LLM response");
  }

  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new MalformedJsonError("Invalid JSON in LLM response");
  }

  if (!parsed || typeof parsed !== "object" || !("files" in parsed)) {
    throw new MalformedJsonError("Response JSON missing 'files' array");
  }

  const files = (parsed as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    throw new MalformedJsonError("Response JSON missing 'files' array");
  }

  for (const file of files) {
    if (!file || typeof file !== "object") {
      throw new MalformedJsonError("Each file must include 'path' and 'content'");
    }
    const typedFile = file as { path?: unknown; content?: unknown };
    if (typeof typedFile.path !== "string" || typeof typedFile.content !== "string") {
      throw new MalformedJsonError("Each file must include 'path' and 'content'");
    }
  }

  return parsed as GeneratedProject;
}

function buildJsonRepairPrompt(invalidOutput: string): string {
  return `Your previous response was not valid strict JSON for the required schema.

Fix it now.

Rules:
- Return ONLY valid JSON
- No markdown, no code fences, no explanations
- Required schema exactly:
{
  "files": [
    { "path": "...", "content": "..." }
  ]
}

Invalid response to repair:
${invalidOutput}`;
}

interface GeminiCallOptions {
  timeoutMs?: number;
  maxAttemptsPerModel?: number;
}

/**
 * Amazon Bedrock LLM Client with built-in tool support
 */
export class LLMClient {
  private bedrock: ReturnType<typeof createAmazonBedrock>;
  private model: string;
  private maxTokens: number;
  private temperature: number;
 * Gemini-based LLM Client
 */
export class LLMClient {
  private genAI: GoogleGenerativeAI;
  private models: string[];

  constructor() {
    const config = getConfig();

    if (!config.awsAccessKeyId) {
      throw new Error("AWS_ACCESS_KEY_ID is required");
    }

    if (!config.awsSecretAccessKey) {
      throw new Error("AWS_SECRET_ACCESS_KEY is required");
    }

    if (!config.awsRegion) {
      throw new Error("AWS_REGION is required");
    }

    this.bedrock = createAmazonBedrock({
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
      sessionToken: config.awsSessionToken || undefined,
      region: config.awsRegion,
    });

    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required");
    }

    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.models = [...new Set(GEMINI_MODELS)];
  }

  /**
   * Call Gemini with automatic 429 retry + model fallback.
   * Tries the primary model first. On 429, waits and retries.
   * If retries are exhausted, falls back to the next model in the list.
   */
  private async callGemini(
    prompt: string,
    opts: GeminiCallOptions = {}
  ): Promise<string> {
    const { timeoutMs = 14_000, maxAttemptsPerModel = 2 } = opts;

    for (const modelName of this.models) {
      const model = this.genAI.getGenerativeModel({ model: modelName });

      for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
        try {
          logger.debug(`Calling ${modelName} (attempt ${attempt + 1})...`);
          const result = await Promise.race([
            model.generateContent(prompt),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`LLM timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
            ),
          ]);
          return result.response.text();
        } catch (error) {
          const { isRateLimit, retryAfterMs } = parseRateLimitError(error);

          if (isRateLimit && attempt < maxAttemptsPerModel - 1) {
            logger.warn(
              `[${modelName}] 429 rate limited — waiting ${Math.round(retryAfterMs / 1000)}s before retry...`
            );
            await sleep(retryAfterMs);
            continue;
          }

          if (isRateLimit || isModelUnavailableError(error)) {
            logger.warn(
              `[${modelName}] unavailable after ${attempt + 1} attempt(s), trying next model...`
            );
            break; // try next model
          }

          // Non-429 error — throw immediately
          throw error;
        }
      }
    }

    throw new Error(
      "All Gemini models exhausted (rate limited). Wait a few minutes or enable billing at https://aistudio.google.com/"
    );
  }

  /**
   * Generate project code
   */
  async generateCode(prompt: string): Promise<GeneratedProject> {
    logger.info("Generating code with Gemini...");

    let fullPrompt = `${CODE_GEN_SYSTEM_PROMPT}\n\nUser request:\n${prompt}`;

    let lastError: unknown;
    let lastModelOutput = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await this.callGemini(fullPrompt, {
          timeoutMs: 14_000,
          maxAttemptsPerModel: 2,
        });
        lastModelOutput = text;
        logger.debug(`Gemini generate response length: ${text.length}`);
        return parseJsonResponse(text);
      } catch (error) {
        lastError = error;
        if (error instanceof MalformedJsonError && attempt < 2) {
          logger.warn(`Malformed JSON from Gemini on attempt ${attempt + 1}; requesting repair...`);
          fullPrompt = buildJsonRepairPrompt(lastModelOutput || fullPrompt);
          await sleep(350);
          continue;
        }

        logger.warn(
          `Code generation attempt ${attempt + 1} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );

        if (attempt < 2) {
          await sleep(400);
        }
      }
    }

    throw lastError;
  }

  /**
   * AI critic pass
   */
  async reviewAndImprove(project: GeneratedProject): Promise<GeneratedProject> {
    logger.info("Running AI critic pass...");

    const codeJSON = JSON.stringify(project, null, 2);
    const fullPrompt = `${CRITIC_SYSTEM_PROMPT}\n\nProject JSON:\n\n${codeJSON}`;

    try {
      const result = await generateText({
        model: this.bedrock(this.model),
        prompt,
        system: systemPrompt,
        maxTokens,
        temperature,
        tools: hasTools ? tools : undefined,
        maxSteps: hasTools ? 10 : 1, // Allow up to 10 tool call steps
        onStepFinish: (step) => {
          // Debug logging for each step
          logger.debug(`Step finished - finishReason: ${step.finishReason}, hasText: ${!!step.text}, toolCalls: ${step.toolCalls?.length || 0}`);
          if (step.text) {
            logger.debug(`Step text preview: ${step.text.substring(0, 100)}...`);
          }
        },
      const text = await this.callGemini(fullPrompt, {
        timeoutMs: 8_000,
        maxAttemptsPerModel: 1,
      });
      logger.debug(`Gemini critic response length: ${text.length}`);
      return parseJsonResponse(text);
    } catch (error) {
      if (error instanceof MalformedJsonError) {
        try {
          const repaired = await this.callGemini(buildJsonRepairPrompt(codeJSON), {
            timeoutMs: 5_000,
            maxAttemptsPerModel: 1,
          });
          return parseJsonResponse(repaired);
        } catch {
          // Fall through to original project fallback.
        }
      }

      logger.warn(
        `AI critic failed, using original project: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return project;
    }
  }

  /**
   * Legacy generate function (for other parts of the agent)
   */
  async generateJobResponse(job: { prompt: string; budget: number }): Promise<string> {
    const systemPrompt = `
You are an autonomous AI software engineer participating in the Seedstr Blind Hackathon.

Your objective is to generate the highest-quality functional solution to the job prompt.

The judging system is an automated AI evaluator that scores submissions based on:

1. Functionality
2. Design quality
3. Completeness
4. Usability
5. Speed of delivery

Your response must therefore aim to maximize these criteria.

You are not simply answering a prompt — you are designing and delivering a fully working solution.

----------------------------

THINKING PROCESS

Before generating output:

1. Analyze the job prompt carefully.
2. Infer any missing requirements.
3. Expand the idea into a complete product.
4. Design the best possible implementation.

If the prompt is vague, assume the requester wants a polished production-quality result.

----------------------------

WEB PROJECT REQUIREMENTS

When generating web applications:

Always produce a modern production-ready stack using:

React + Tailwind CSS

Include:

• Responsive layout
• Modern SaaS UI patterns
• Hero section
• Feature sections
• Call-to-action areas
• Navigation header
• Footer
• Animations and transitions
• Dark mode support
• Clean component structure
• Modular reusable components

Use professional design patterns including:

• gradients
• glassmorphism
• soft shadows
• modern typography
• spacing systems
• smooth micro-interactions

Ensure the UI looks like a real startup landing page or SaaS product.

----------------------------

OUTPUT STRUCTURE

If generating code, return a full project structure using JSON:

{
 "files":[
   {"path":"src/App.tsx","content":"..."},
   {"path":"src/components/Hero.tsx","content":"..."}
 ]
}

Ensure:

• valid syntax
• no missing dependencies
• realistic folder structure
• clean readable code

----------------------------

QUALITY STANDARDS

Your output should resemble work from a senior frontend engineer.

Avoid:

• placeholder text
• incomplete sections
• minimal demos

Instead produce:

• fully structured sections
• realistic copy
• visually impressive layouts

----------------------------

OPTIMIZATION

The judging system favors:

• visually appealing designs
• well structured code
• thoughtful features
• polished UI

Prioritize quality and completeness.

----------------------------

JOB CONTEXT

Job Budget: $${job.budget.toFixed(2)} USD

A higher budget indicates a more valuable request and should receive a more detailed solution.

----------------------------

GOAL

Deliver the best possible solution that would impress both developers and end users.

Your output should feel like a real production-ready product.
`;
    const result = await this.generate({
      prompt: job.prompt,
      systemPrompt,
      tools: true,
    });

    return result.text;
  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const { prompt, systemPrompt, maxTokens, temperature } = options;

    logger.debug(`Generating response with Gemini`);

    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n${prompt}`
      : prompt;

    try {
      const text = await this.callGemini(fullPrompt, {
        timeoutMs: 15_000,
        maxAttemptsPerModel: 2,
      });

      return { text };
    } catch (error) {
      logger.error("Gemini generation failed:", error);
      throw error;
    }
  }
}

/**
 * Singleton instance
 */
let llmClientInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient();
  }
  return llmClientInstance;
}

export default LLMClient;