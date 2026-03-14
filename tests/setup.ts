import { vi, beforeEach, afterEach } from "vitest";

// Store original env
const originalEnv = { ...process.env };

// Mock environment variables for tests
beforeEach(() => {
  // Clear all env vars that might interfere
  delete process.env.MAX_CONCURRENT_JOBS;
  delete process.env.MIN_BUDGET;
  delete process.env.POLL_INTERVAL;
  delete process.env.TEMPERATURE;
  delete process.env.MAX_TOKENS;
  delete process.env.BEDROCK_MODEL_ID;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.GEMINI_MODEL;
  delete process.env.DEBUG;
  delete process.env.TAVILY_API_KEY;
  delete process.env.TOOL_WEB_SEARCH_ENABLED;
  delete process.env.TOOL_CALCULATOR_ENABLED;
  delete process.env.TOOL_CODE_INTERPRETER_ENABLED;
  
  // Set test values
  process.env.AWS_ACCESS_KEY_ID = "test-aws-access-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-aws-secret-key";
  process.env.AWS_REGION = "us-east-1";
  process.env.WALLET_ADDRESS = "TestWalletAddress12345678901234567890";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.SOLANA_WALLET_ADDRESS = "TestWalletAddress12345678901234567890";
  process.env.SEEDSTR_API_URL = "https://www.seedstr.io/api/v1";
  process.env.LOG_LEVEL = "error"; // Suppress logs in tests
});

afterEach(() => {
  vi.clearAllMocks();
});

// Mock fetch globally
global.fetch = vi.fn();
