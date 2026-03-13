import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { readFileSync, statSync } from "fs";
import { basename } from "path";
import type {
  AgentInfo,
  Job,
  JobsListResponse,
  RegisterResponse,
  SubmitResponseResult,
  SubmitResponseOptions,
  VerifyResponse,
  UpdateProfileResponse,
  ApiError,
  FileAttachment,
  FileUploadResult,
  AcceptJobResult,
  DeclineJobResult,
} from "../types/index.js";

export class SeedstrClient {
  private baseUrl: string;
  private baseUrlV2: string;
  private apiKey: string;

  constructor(apiKey?: string, baseUrl?: string) {
    const config = getConfig();
    this.apiKey = apiKey ?? config.seedstrApiKey ?? "";
    this.baseUrl = baseUrl ?? config.seedstrApiUrl;
    this.baseUrlV2 = config.seedstrApiUrlV2;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    useV2 = false
  ): Promise<T> {
    const base = useV2 ? this.baseUrlV2 : this.baseUrl;
    const url = `${base}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      ...(options.headers as Record<string, string>),
    };

    logger.debug(`API Request: ${options.method || "GET"} ${url}`);

    let response: Response;

    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (error) {
      logger.error("Network error calling Seedstr API:", error);
      throw new Error("Network error contacting Seedstr API");
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      throw new Error("Invalid JSON response from Seedstr API");
    }

    if (!response.ok) {
      const error = data as ApiError;
      logger.error(`Seedstr API Error: ${error.message}`);
      throw new Error(error.message || `API request failed: ${response.status}`);
    }

    return data as T;
  }

  /**
   * Register agent
   */
  async register(
    walletAddress: string,
    walletType: "ETH" | "SOL" = "ETH",
    ownerUrl?: string
  ): Promise<RegisterResponse> {
    return this.request<RegisterResponse>(
      "/register",
      {
        method: "POST",
        body: JSON.stringify({
          walletAddress,
          walletType,
          ownerUrl,
        }),
      },
      true
    );
  }

  async getMe(): Promise<AgentInfo> {
    return this.request<AgentInfo>("/me");
  }

  async updateProfile(data: {
    name?: string;
    bio?: string;
    profilePicture?: string;
  }): Promise<UpdateProfileResponse> {
    return this.request<UpdateProfileResponse>("/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async verify(): Promise<VerifyResponse> {
    return this.request<VerifyResponse>("/verify", {
      method: "POST",
    });
  }

  async listJobs(limit = 20, offset = 0): Promise<JobsListResponse> {
    return this.request<JobsListResponse>(`/jobs?limit=${limit}&offset=${offset}`);
  }

  async listJobsV2(limit = 20, offset = 0): Promise<JobsListResponse> {
    return this.request<JobsListResponse>(
      `/jobs?limit=${limit}&offset=${offset}`,
      {},
      true
    );
  }

  async getJobV2(jobId: string): Promise<Job> {
    return this.request<Job>(`/jobs/${jobId}`, {}, true);
  }

  async getJob(jobId: string): Promise<Job> {
    return this.request<Job>(`/jobs/${jobId}`);
  }

  async acceptJob(jobId: string): Promise<AcceptJobResult> {
    return this.request<AcceptJobResult>(
      `/jobs/${jobId}/accept`,
      { method: "POST" },
      true
    );
  }

  async declineJob(jobId: string, reason?: string): Promise<DeclineJobResult> {
    return this.request<DeclineJobResult>(
      `/jobs/${jobId}/decline`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
      true
    );
  }

  async updateSkills(skills: string[]): Promise<UpdateProfileResponse> {
    return this.request<UpdateProfileResponse>("/me", {
      method: "PATCH",
      body: JSON.stringify({ skills }),
    });
  }

  async submitResponse(
    jobId: string,
    content: string
  ): Promise<SubmitResponseResult> {
    return this.request<SubmitResponseResult>(`/jobs/${jobId}/respond`, {
      method: "POST",
      body: JSON.stringify({
        content,
        responseType: "TEXT",
      }),
    });
  }

  async submitResponseV2(
    jobId: string,
    content: string,
    responseType: "TEXT" | "FILE" = "TEXT",
    files?: FileAttachment[]
  ): Promise<SubmitResponseResult> {
    const body: Record<string, unknown> = {
      content,
      responseType,
    };

    if (files && files.length > 0) body.files = files;

    return this.request<SubmitResponseResult>(
      `/jobs/${jobId}/respond`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      true
    );
  }

  async uploadFile(filePath: string): Promise<FileAttachment> {
    const config = getConfig();

    const stats = statSync(filePath);
    const fileName = basename(filePath);

    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    const mimeTypes: Record<string, string> = {
      zip: "application/zip",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      json: "application/json",
      html: "text/html",
      css: "text/css",
      js: "text/javascript",
      ts: "text/typescript",
      md: "text/markdown",
      txt: "text/plain",
    };

    const mimeType = mimeTypes[ext] || "application/octet-stream";

    logger.debug(`Uploading file: ${fileName}`);

    const fileBuffer = readFileSync(filePath);
    const base64Content = fileBuffer.toString("base64");

    const uploadUrl = `${config.seedstrApiUrl}/upload`;

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [
          {
            name: fileName,
            content: base64Content,
            type: mimeType,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error("Upload failed:", text);
      throw new Error("File upload failed");
    }

    const result = (await response.json()) as {
      success: boolean;
      files: FileUploadResult[];
    };

    if (!result.success || result.files.length === 0) {
      throw new Error("Upload failed: no files returned");
    }

    const fileResult = result.files[0];

    return {
      url: fileResult.url,
      name: fileResult.name,
      size: fileResult.size,
      type: fileResult.type,
    };
  }

  async uploadFiles(filePaths: string[]): Promise<FileAttachment[]> {
    const attachments: FileAttachment[] = [];

    for (const filePath of filePaths) {
      const file = await this.uploadFile(filePath);
      attachments.push(file);
    }

    return attachments;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }
}

export const seedstrClient = new SeedstrClient();

export default SeedstrClient;