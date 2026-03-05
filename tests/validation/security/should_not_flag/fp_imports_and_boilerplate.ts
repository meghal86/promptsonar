// Test: Imports, types, interfaces — zero findings expected
import { OpenAI } from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import type { ChatCompletion, Message } from "openai/resources";

interface PromptConfig {
  system: string;
  temperature: number;
  maxTokens: number;
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY  // env var reference — NOT in prompt — should not flag
});

type SafePrompt = {
  role: "system" | "user" | "assistant";
  content: string;
};