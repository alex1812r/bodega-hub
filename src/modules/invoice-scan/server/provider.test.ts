/**
 * @jest-environment node
 */

import {
  createAssistantModel,
  resetAssistantProviderWarning,
  resetModelProviderWarning,
} from "@/modules/assistant/server/provider";

import { createInvoiceScanModel } from "./provider";

const ENV_KEYS = [
  "INVOICE_SCAN_PROVIDER",
  "INVOICE_SCAN_MODEL",
  "ASSISTANT_PROVIDER",
  "ASSISTANT_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

describe("createInvoiceScanModel", () => {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    resetModelProviderWarning("invoice-scan");
    resetAssistantProviderWarning();
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    ENV_KEYS.forEach((key) => {
      const value = original[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it("defaults to Google gemini-3.5-flash-lite without INVOICE_SCAN_MODEL", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";
    process.env.ANTHROPIC_API_KEY = "a-key";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "gemini-3.5-flash-lite",
      provider: "google",
    });
  });

  it("uses INVOICE_SCAN_MODEL over the Google default", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";
    process.env.INVOICE_SCAN_MODEL = " gemini-3.6-flash ";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "gemini-3.6-flash",
      provider: "google",
    });
  });

  it("respects anthropic with its default model and the INVOICE_SCAN_MODEL override", () => {
    process.env.INVOICE_SCAN_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "a-key";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "claude-haiku-5-5",
      provider: "anthropic",
    });

    process.env.INVOICE_SCAN_MODEL = "claude-sonnet-4-5";
    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "claude-sonnet-4-5",
      provider: "anthropic",
    });
  });

  it("respects mock even with keys", () => {
    process.env.INVOICE_SCAN_PROVIDER = "mock";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "invoice-scan-mock",
      provider: "mock",
    });
  });

  it("falls back to Anthropic with the scan Haiku default without the Google key", () => {
    process.env.INVOICE_SCAN_PROVIDER = "google";
    process.env.INVOICE_SCAN_MODEL = "gemini-otro";
    process.env.ANTHROPIC_API_KEY = "a-key";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "claude-haiku-5-5",
      provider: "anthropic",
    });
    expect(consoleWarn).toHaveBeenCalledWith('[invoice-scan] Sin key para "google"; se usa Anthropic.');
  });

  it("falls back to Google with the scan lite default without the Anthropic key", () => {
    process.env.INVOICE_SCAN_PROVIDER = "anthropic";
    process.env.INVOICE_SCAN_MODEL = "claude-otro";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "gemini-3.5-flash-lite",
      provider: "google",
    });
    expect(consoleWarn).toHaveBeenCalledWith('[invoice-scan] Sin key para "anthropic"; se usa Google.');
  });

  it("falls back to mock without any key, also for an invalid provider", () => {
    process.env.INVOICE_SCAN_PROVIDER = "inventado";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "invoice-scan-mock",
      provider: "mock",
    });
  });

  it("does not read the assistant variables", () => {
    process.env.ASSISTANT_PROVIDER = "mock";
    process.env.ASSISTANT_MODEL = "otro";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";

    expect(createInvoiceScanModel()).toMatchObject({
      modelId: "gemini-3.5-flash-lite",
      provider: "google",
    });
    expect(createAssistantModel()).toMatchObject({ modelId: "assistant-mock", provider: "mock" });
  });

  it("keeps the assistant defaults (gemini-2.5-flash / claude-haiku-4-5)", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";
    process.env.ANTHROPIC_API_KEY = "a-key";

    expect(createAssistantModel()).toMatchObject({ modelId: "gemini-2.5-flash", provider: "google" });

    process.env.ASSISTANT_PROVIDER = "anthropic";
    expect(createAssistantModel()).toMatchObject({ modelId: "claude-haiku-4-5", provider: "anthropic" });

    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.ASSISTANT_PROVIDER = "google";
    expect(createAssistantModel()).toMatchObject({ modelId: "claude-haiku-4-5", provider: "anthropic" });
  });

  it("keeps the assistant factory behaviour", () => {
    process.env.ASSISTANT_PROVIDER = "anthropic";
    process.env.ASSISTANT_MODEL = "claude-custom";
    process.env.ANTHROPIC_API_KEY = "a-key";

    expect(createAssistantModel()).toMatchObject({
      modelId: "claude-custom",
      provider: "anthropic",
    });

    delete process.env.ANTHROPIC_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-key";
    expect(createAssistantModel()).toMatchObject({
      modelId: "gemini-2.5-flash",
      provider: "google",
    });
    expect(consoleWarn).toHaveBeenCalledWith('[assistant] Sin key para "anthropic"; se usa Google.');
  });
});
