import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getConfig, validateConfig } from "../src/config/index.js";

describe("Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getConfig", () => {
    it("should return default values", () => {
      // Clear LOG_LEVEL set by setup.ts to test actual default
      delete process.env.LOG_LEVEL;

      const config = getConfig();

      expect(config.model).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
      expect(config.model).toBe("gemini-1.5-flash");
      expect(config.maxTokens).toBe(4096);
      expect(config.temperature).toBe(0.7);
      expect(config.minBudget).toBe(0.5);
      expect(config.pollInterval).toBe(30);
      expect(config.maxConcurrentJobs).toBe(3);
      expect(config.logLevel).toBe("info");
    });

    it("should use environment variables", () => {
      process.env.BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0";
      process.env.GEMINI_MODEL = "gemini-1.5-pro";
      process.env.MAX_TOKENS = "8000";
      process.env.TEMPERATURE = "0.5";
      process.env.MIN_BUDGET = "1.00";
      process.env.POLL_INTERVAL = "60";

      const config = getConfig();

      expect(config.model).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
      expect(config.model).toBe("gemini-1.5-pro");
      expect(config.maxTokens).toBe(8000);
      expect(config.temperature).toBe(0.5);
      expect(config.minBudget).toBe(1.0);
      expect(config.pollInterval).toBe(60);
    });

    it("should enable tools by default", () => {
      const config = getConfig();

      expect(config.tools.webSearchEnabled).toBe(true);
      expect(config.tools.calculatorEnabled).toBe(true);
      expect(config.tools.codeInterpreterEnabled).toBe(true);
    });

    it("should disable tools when set to false", () => {
      process.env.TOOL_WEB_SEARCH_ENABLED = "false";
      process.env.TOOL_CALCULATOR_ENABLED = "false";

      const config = getConfig();

      expect(config.tools.webSearchEnabled).toBe(false);
      expect(config.tools.calculatorEnabled).toBe(false);
    });
  });

  describe("validateConfig", () => {
    it("should return no errors for valid config", () => {
      const config = getConfig();
      const errors = validateConfig(config);

      expect(errors).toHaveLength(0);
    });

    it("should require AWS_ACCESS_KEY_ID", () => {
      process.env.AWS_ACCESS_KEY_ID = "";
    it("should require GEMINI_API_KEY", () => {
      process.env.GEMINI_API_KEY = "";

      const config = getConfig();
      const errors = validateConfig(config);

      expect(errors).toContain("AWS_ACCESS_KEY_ID is required");
    });

    it("should require AWS_SECRET_ACCESS_KEY", () => {
      process.env.AWS_SECRET_ACCESS_KEY = "";

      const config = getConfig();
      const errors = validateConfig(config);

      expect(errors).toContain("AWS_SECRET_ACCESS_KEY is required");
    });

    it("should require AWS_REGION", () => {
      process.env.AWS_REGION = "";

      const config = getConfig();
      const errors = validateConfig(config);

      expect(errors).toContain("AWS_REGION is required");
    });

    it("should require WALLET_ADDRESS", () => {
      // Delete env var to test validation behavior
      delete process.env.WALLET_ADDRESS;

      const config = getConfig();
      expect(errors).toContain("GEMINI_API_KEY is required");
    });

    it("should require WALLET_ADDRESS", () => {
      delete process.env.WALLET_ADDRESS;
      delete process.env.SOLANA_WALLET_ADDRESS;

      const config = getConfig();
      const testConfig = { ...config, walletAddress: "" };
      const errors = validateConfig(testConfig);

      expect(errors).toContain("WALLET_ADDRESS is required");
    });
  });
});
