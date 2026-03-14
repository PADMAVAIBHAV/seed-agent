import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText, tool } from "ai";
import { z } from "zod";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { ProjectBuilder, type ProjectFile, type ProjectBuildResult } from "../tools/projectBuilder.js";

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
  projectBuild?: ProjectBuildResult;
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

const CODE_GEN_SYSTEM_PROMPT = `You are an expert frontend engineer building fast, production-ready React + Tailwind apps.
Return only strict JSON with this shape:
{
  "files": [
    { "path": "src/App.tsx", "content": "..." }
  ]
}
No markdown, no code fences, no explanations.`;

const CRITIC_SYSTEM_PROMPT = `You are a senior frontend reviewer.
Improve the provided React + Tailwind project JSON while preserving intent.
Return only strict JSON with the same schema.`;

class MalformedJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedJsonError";
  }
}

function parseJsonResponse(text: string): GeneratedProject {
  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "");

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

  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const {
      prompt,
      systemPrompt,
      maxTokens = this.maxTokens,
      temperature = this.temperature,
      tools: useTools = false,
    } = options;

    logger.debug(`Generating response with model: ${this.model}`);

    if (!useTools) {
      const result = await generateText({
        model: this.bedrock(this.model),
        prompt,
        system: systemPrompt,
        maxTokens,
        temperature,
        maxSteps: 1,
      });

      return {
        text: result.text,
        usage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
            }
          : undefined,
      };
    }

    // Tool-based generation: LLM can create files and finalize a deliverable zip
    let projectBuild: ProjectBuildResult | undefined;
    const projectBuilder = new ProjectBuilder();

    const toolDefs = {
      create_file: tool({
        description: "Create a file in the project. Use this to write code files, configs, README, etc.",
        parameters: z.object({
          path: z.string().describe("Relative file path within the project (e.g. src/App.tsx)"),
          content: z.string().describe("Complete file content"),
        }),
        execute: async ({ path, content }: { path: string; content: string }) => {
          try {
            projectBuilder.addFile(path, content);
            return { success: true, path };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, path, error: msg };
          }
        },
      }),
      finalize_project: tool({
        description: "Package all created files into a downloadable zip. Call this after all files are created.",
        parameters: z.object({}),
        execute: async () => {
          const result = await projectBuilder.createZip();
          projectBuild = result;
          return {
            success: result.success,
            files: result.files,
            totalSize: result.totalSize,
          };
        },
      }),
    };

    const result = await generateText({
      model: this.bedrock(this.model),
      prompt,
      system: systemPrompt,
      maxTokens,
      temperature,
      maxSteps: 30,
      tools: toolDefs,
    });

    // Collect all tool call summaries across steps
    const toolCalls: NonNullable<LLMResponse["toolCalls"]> = [];
    for (const step of result.steps) {
      for (const tc of step.toolCalls ?? []) {
        const toolResult = (step.toolResults ?? []).find(
          (tr) => tr.toolCallId === tc.toolCallId
        );
        toolCalls.push({
          name: tc.toolName,
          args: tc.args as Record<string, unknown>,
          result: toolResult?.result,
        });
      }
    }

    return {
      text: result.text,
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
  }

  async generateCode(prompt: string): Promise<GeneratedProject> {
    const result = await this.generate({
      prompt: `${CODE_GEN_SYSTEM_PROMPT}\n\nUser request:\n${prompt}`,
      tools: false,
    });

    return parseJsonResponse(result.text);
  }

  async reviewAndImprove(project: GeneratedProject): Promise<GeneratedProject> {
    const codeJSON = JSON.stringify(project, null, 2);
    const result = await this.generate({
      prompt: `${CRITIC_SYSTEM_PROMPT}\n\nProject JSON:\n\n${codeJSON}`,
      tools: false,
    });

    try {
      return parseJsonResponse(result.text);
    } catch {
      logger.warn("Critic output was not valid JSON, using original generated project");
      return project;
    }
  }

  async generateJobResponse(job: { prompt: string; budget: number }): Promise<string> {
    const result = await this.generate({
      prompt: job.prompt,
      systemPrompt: `You are an autonomous AI software engineer. Job budget: $${job.budget.toFixed(2)}.`,
      tools: false,
    });

    return result.text;
  }
}

let llmClientInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmClientInstance) {
    llmClientInstance = new LLMClient();
  }
  return llmClientInstance;
}

export default LLMClient;
