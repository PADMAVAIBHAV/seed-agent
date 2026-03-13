import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText, tool, CoreTool } from "ai";
import { z } from "zod";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { webSearch, type WebSearchResult } from "../tools/webSearch.js";
import { calculator, type CalculatorResult } from "../tools/calculator.js";
import { ProjectBuilder, type ProjectFile, type ProjectBuildResult } from "../tools/projectBuilder.js";

// Errors that are worth retrying (usually transient LLM output issues)
const RETRYABLE_ERROR_PATTERNS = [
  'InvalidToolArgumentsError',
  'AI_InvalidToolArgumentsError',
  'JSONParseError',
  'AI_JSONParseError',
];

/**
 * Get retry configuration from app config
 */
function getRetryConfig() {
  const config = getConfig();
  return {
    maxRetries: config.llmRetryMaxAttempts,
    baseDelayMs: config.llmRetryBaseDelayMs,
    maxDelayMs: config.llmRetryMaxDelayMs,
    fallbackNoTools: config.llmRetryFallbackNoTools,
  };
}

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
  // If a project was built during this response
  projectBuild?: ProjectBuildResult;
}

// Active project builder instance (one per generation)
// Using a type assertion to work around TypeScript narrowing issues
let activeProjectBuilder: ProjectBuilder | null = null;

// Helper to get the project builder with correct typing
function getActiveBuilder(): ProjectBuilder | null {
  return activeProjectBuilder;
}

/**
 * Check if an error is retryable (transient LLM output parsing issue)
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  
  const errorName = (error as Error).name || '';
  const errorMessage = (error as Error).message || '';
  
  // Check error name against known retryable errors
  if (RETRYABLE_ERROR_PATTERNS.some(name => errorName.includes(name))) {
    return true;
  }
  
  // Check for JSON parsing errors in the message
  if (errorMessage.includes('JSON parsing failed') || 
      errorMessage.includes('Invalid arguments for tool')) {
    return true;
  }
  
  // Check for cause chain (nested errors)
  const cause = (error as { cause?: unknown }).cause;
  if (cause) {
    return isRetryableError(cause);
  }
  
  return false;
}

/**
 * Calculate exponential backoff delay with jitter
 */
function getRetryDelay(attempt: number, retryConfig: ReturnType<typeof getRetryConfig>): number {
  const delay = Math.min(
    retryConfig.baseDelayMs * Math.pow(2, attempt),
    retryConfig.maxDelayMs
  );
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() - 0.5);
  return Math.round(delay + jitter);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: boolean;
}

/**
 * Amazon Bedrock LLM Client with built-in tool support
 */
export class LLMClient {
  private bedrock: ReturnType<typeof createAmazonBedrock>;
  private model: string;
  private maxTokens: number;
  private temperature: number;

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
  }

  /**
   * Get available tools based on configuration
   */
  private getTools(): Record<string, CoreTool> {
    const config = getConfig();
    const tools: Record<string, CoreTool> = {};

    if (config.tools.webSearchEnabled) {
      tools.web_search = tool({
        description:
          "Search the web for current information. Use this when you need up-to-date information, facts, news, prices, or data that might not be in your training data. Returns an array of search results with title, url, and snippet containing the relevant information.",
        parameters: z.object({
          query: z
            .string()
            .describe("The search query to look up on the web"),
        }),
        execute: async ({ query }): Promise<WebSearchResult[]> => {
          logger.tool("web_search", "start", `Query: ${query}`);
          try {
            const results = await webSearch(query);
            logger.tool("web_search", "success", `Found ${results.length} results`);
            // Log result snippets for debugging
            for (const r of results.slice(0, 2)) {
              logger.debug(`Search result: "${r.title}" - ${r.snippet.substring(0, 100)}...`);
            }
            return results;
          } catch (error) {
            logger.tool("web_search", "error", String(error));
            throw error;
          }
        },
      });
    }

    if (config.tools.calculatorEnabled) {
      tools.calculator = tool({
        description:
          "Perform mathematical calculations. Use this for any math operations, equations, or numerical computations.",
        parameters: z.object({
          expression: z
            .string()
            .describe(
              "The mathematical expression to evaluate (e.g., '2 + 2', 'sqrt(16)', 'sin(45)')"
            ),
        }),
        execute: async ({ expression }): Promise<CalculatorResult> => {
          logger.tool("calculator", "start", `Expression: ${expression}`);
          try {
            const result = calculator(expression);
            logger.tool("calculator", "success", `Result: ${result.result}`);
            return result;
          } catch (error) {
            logger.tool("calculator", "error", String(error));
            throw error;
          }
        },
      });
    }

    if (config.tools.codeInterpreterEnabled) {
      tools.code_analysis = tool({
        description:
          "Analyze code snippets, explain code logic, identify bugs, or suggest improvements. This tool helps with code-related questions.",
        parameters: z.object({
          code: z.string().describe("The code snippet to analyze"),
          language: z
            .string()
            .optional()
            .describe("The programming language of the code"),
          task: z
            .enum(["explain", "debug", "improve", "review"])
            .describe("What to do with the code"),
        }),
        execute: async ({ code, language, task }) => {
          logger.tool("code_analysis", "start", `Task: ${task}`);
          // This is a meta-tool - it returns structured data for the LLM to use
          return {
            code,
            language: language || "unknown",
            task,
            note: "Analyze this code and provide the requested information.",
          };
        },
      });

      // Project builder tool - creates files that will be packaged into a zip
      tools.create_file = tool({
        description: `Create a file for a deliverable code project (website, app, script, tool). Only use this when the job is asking for an actual downloadable project — NOT for text-based requests like writing tweets, emails, essays, or answers. Call multiple times for multi-file projects, then use finalize_project to package them.`,
        parameters: z.object({
          path: z
            .string()
            .describe(
              "The file path relative to the project root (e.g., 'index.html', 'src/App.tsx', 'styles/main.css')"
            ),
          content: z
            .string()
            .describe("The complete content of the file"),
        }),
        execute: async ({ path, content }) => {
          logger.tool("create_file", "start", `Creating: ${path}`);
          try {
            // Initialize project builder if not exists
            if (!activeProjectBuilder) {
              activeProjectBuilder = new ProjectBuilder();
            }
            
            activeProjectBuilder.addFile(path, content);
            
            const files = activeProjectBuilder.getFiles();
            logger.tool("create_file", "success", `Created ${path}, total files: ${files.length}`);
            
            return {
              success: true,
              path,
              size: content.length,
              totalFiles: files.length,
              allFiles: files,
            };
          } catch (error) {
            logger.tool("create_file", "error", String(error));
            throw error;
          }
        },
      });

      tools.finalize_project = tool({
        description: `Package all files created with create_file into a downloadable zip. Call this after creating all project files. Only use when you've built a real code project.`,
        parameters: z.object({
          projectName: z
            .string()
            .describe("A descriptive name for the project (e.g., 'business-website', 'react-todo-app')"),
        }),
        execute: async ({ projectName }) => {
          logger.tool("finalize_project", "start", `Finalizing: ${projectName}`);
          try {
            if (!activeProjectBuilder) {
              throw new Error("No files have been created. Use create_file first.");
            }
            
            const result = await activeProjectBuilder.createZip(`${projectName}.zip`);
            logger.tool("finalize_project", "success", `Created ${result.zipPath} (${result.totalSize} bytes)`);
            
            return {
              success: result.success,
              projectName,
              zipPath: result.zipPath,
              files: result.files,
              totalSize: result.totalSize,
              error: result.error,
            };
          } catch (error) {
            logger.tool("finalize_project", "error", String(error));
            throw error;
          }
        },
      });
    }

    return tools;
  }

  /**
   * Generate a response using the LLM with optional tool calling
   */
  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const {
      prompt,
      systemPrompt,
      maxTokens = this.maxTokens,
      temperature = this.temperature,
      tools: enableTools = true,
    } = options;

    logger.debug(`Generating response with model: ${this.model}`);

    // Reset project builder for each generation
    activeProjectBuilder = null;

    const tools = enableTools ? this.getTools() : undefined;
    const hasTools = tools && Object.keys(tools).length > 0;

    let lastError: unknown;
    let attempt = 0;
    const retryConfig = getRetryConfig();

    // Retry loop for recoverable errors
    while (attempt <= retryConfig.maxRetries) {
      try {
        const result = await this.executeGeneration({
          prompt,
          systemPrompt,
          maxTokens,
          temperature,
          tools: hasTools ? tools : undefined,
        });
        
        return result;
      } catch (error) {
        lastError = error;
        
        if (isRetryableError(error) && attempt < retryConfig.maxRetries) {
          const delay = getRetryDelay(attempt, retryConfig);
          logger.warn(
            `LLM generation failed with retryable error (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), ` +
            `retrying in ${delay}ms: ${(error as Error).message?.substring(0, 100)}`
          );
          
          // Reset project builder before retry
          activeProjectBuilder = null;
          
          await sleep(delay);
          attempt++;
          continue;
        }
        
        // Not retryable or exhausted retries - try fallback if tools were enabled
        if (hasTools && retryConfig.fallbackNoTools && attempt >= retryConfig.maxRetries && isRetryableError(error)) {
          logger.warn(
            `Exhausted ${retryConfig.maxRetries} retries for tool calling, attempting fallback without tools`
          );
          
          try {
            // Reset and try without tools
            activeProjectBuilder = null;
            const fallbackResult = await this.executeGeneration({
              prompt: prompt + "\n\n[Note: Please provide a text response only, as tool execution is temporarily unavailable.]",
              systemPrompt,
              maxTokens,
              temperature,
              tools: undefined,
            });
            
            logger.info("Fallback generation without tools succeeded");
            return fallbackResult;
          } catch (fallbackError) {
            logger.error("Fallback generation also failed:", fallbackError);
            // Throw the original error as it's more informative
            throw lastError;
          }
        }
        
        // Re-throw non-retryable errors immediately
        throw error;
      }
    }

    // Should not reach here, but just in case
    throw lastError;
  }

  /**
   * Execute the actual LLM generation (separated for retry logic)
   */
  private async executeGeneration(params: {
    prompt: string;
    systemPrompt?: string;
    maxTokens: number;
    temperature: number;
    tools?: Record<string, CoreTool>;
  }): Promise<LLMResponse> {
    const { prompt, systemPrompt, maxTokens, temperature, tools } = params;
    const hasTools = tools && Object.keys(tools).length > 0;

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
      });

      // Log completion info
      logger.debug(`Generation complete - finishReason: ${result.finishReason}, steps: ${result.steps?.length || 0}`);
      
      // Extract tool calls from steps
      const toolCalls: LLMResponse["toolCalls"] = [];
      if (result.steps) {
        for (const step of result.steps) {
          const stepToolCalls = step.toolCalls as Array<{
            toolName: string;
            toolCallId: string;
            args: Record<string, unknown>;
          }> | undefined;
          const stepToolResults = step.toolResults as Array<{
            toolCallId: string;
            result: unknown;
          }> | undefined;
          
          if (stepToolCalls) {
            for (const tc of stepToolCalls) {
              const toolResult = stepToolResults?.find(
                (tr) => tr.toolCallId === tc.toolCallId
              )?.result;
              
              toolCalls.push({
                name: tc.toolName,
                args: tc.args,
                result: toolResult,
              });
              
              // Log tool results for debugging
              if (toolResult) {
                const resultStr = JSON.stringify(toolResult);
                logger.debug(`Tool ${tc.toolName} result: ${resultStr.substring(0, 200)}...`);
              }
            }
          }
        }
      }

      // Use result.text which should contain the final response after all tool calls
      // If the model stopped due to tool_calls without a final text, this might be empty
      let finalText = result.text;
      
      // If we have no text but have tool results, the model may not have generated a final response
      if (!finalText && toolCalls.length > 0) {
        logger.warn("Model finished with tool calls but no final text response. Finish reason:", result.finishReason);
        // Try to get text from the last step that has text
        if (result.steps) {
          for (let i = result.steps.length - 1; i >= 0; i--) {
            if (result.steps[i].text) {
              finalText = result.steps[i].text;
              break;
            }
          }
        }
      }

      // Check if a project was built during this generation
      let projectBuild: ProjectBuildResult | undefined;
      
      // Look for finalize_project tool call results
      const finalizeCall = toolCalls.find((tc) => tc.name === "finalize_project");
      if (finalizeCall && finalizeCall.result) {
        const finalizeResult = finalizeCall.result as {
          success: boolean;
          projectName: string;
          zipPath: string;
          files: string[];
          totalSize: number;
          error?: string;
        };
        
        // Get reference to active project builder (may have been set during tool execution)
        const builder = getActiveBuilder();
        if (finalizeResult.success && builder) {
          projectBuild = {
            success: true,
            projectDir: builder.getProjectDir(),
            zipPath: finalizeResult.zipPath,
            files: finalizeResult.files,
            totalSize: finalizeResult.totalSize,
          };
        }
      }

      return {
        text: finalText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
            }
          : undefined,
        projectBuild,
      };
    } catch (error) {
      logger.error("LLM generation failed:", error);
      throw error;
    }
  }
  
  /**
   * Get the active project builder (if any)
   */
  getActiveProjectBuilder(): ProjectBuilder | null {
    return activeProjectBuilder;
  }

  /**
   * Generate a response for a Seedstr job
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
  }
}

// Export a singleton instance
let llmClientInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient();
  }
  return llmClientInstance;
}

export default LLMClient;
