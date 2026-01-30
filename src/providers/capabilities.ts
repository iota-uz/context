/**
 * Provider capabilities and feature detection.
 */

import type { Provider } from '../types/policy.js';

/**
 * Provider capabilities.
 */
export interface ProviderCapabilities {
  /** Provider identifier */
  provider: Provider;

  /** Supports prompt caching */
  supportsPromptCaching: boolean;

  /** Supports structured outputs */
  supportsStructuredOutputs: boolean;

  /** Supports tool/function calling */
  supportsToolCalling: boolean;

  /** Supports vision (image inputs) */
  supportsVision: boolean;

  /** Maximum context window (tokens) */
  maxContextWindow: number;

  /** Maximum output tokens */
  maxOutputTokens: number;

  /** Message format details */
  messageFormat: {
    /** Supports system messages */
    supportsSystemMessages: boolean;

    /** System message location */
    systemMessageLocation: 'inline' | 'separate' | 'none';

    /** Role names */
    roles: {
      system?: string;
      user: string;
      assistant: string;
      tool?: string;
    };
  };

  /** Cache breakpoint configuration */
  caching?: {
    /** Minimum tokens for caching */
    minTokensForCaching: number;

    /** Cache TTL (seconds) */
    cacheTTL: number;

    /** Breakpoint selector strategy */
    breakpointStrategy: 'after_last_match' | 'manual';
  };
}

/**
 * Get capabilities for a provider.
 *
 * @param provider - Provider identifier
 * @returns Provider capabilities
 */
export function getProviderCapabilities(provider: Provider): ProviderCapabilities {
  switch (provider) {
    case 'anthropic':
      return {
        provider: 'anthropic',
        supportsPromptCaching: true,
        supportsStructuredOutputs: true,
        supportsToolCalling: true,
        supportsVision: true,
        maxContextWindow: 200000,
        maxOutputTokens: 64000,
        messageFormat: {
          supportsSystemMessages: true,
          systemMessageLocation: 'separate',
          roles: {
            system: 'system',
            user: 'user',
            assistant: 'assistant',
            tool: 'user',
          },
        },
        caching: {
          minTokensForCaching: 1024,
          cacheTTL: 300,
          breakpointStrategy: 'after_last_match',
        },
      };

    case 'openai':
      return {
        provider: 'openai',
        supportsPromptCaching: false,
        supportsStructuredOutputs: true,
        supportsToolCalling: true,
        supportsVision: true,
        maxContextWindow: 128000,
        maxOutputTokens: 16000,
        messageFormat: {
          supportsSystemMessages: true,
          systemMessageLocation: 'inline',
          roles: {
            system: 'system',
            user: 'user',
            assistant: 'assistant',
            tool: 'tool',
          },
        },
      };

    case 'gemini':
      return {
        provider: 'gemini',
        supportsPromptCaching: true,
        supportsStructuredOutputs: true,
        supportsToolCalling: true,
        supportsVision: true,
        maxContextWindow: 1000000,
        maxOutputTokens: 64000,
        messageFormat: {
          supportsSystemMessages: true,
          systemMessageLocation: 'separate',
          roles: {
            user: 'user',
            assistant: 'model',
          },
        },
        caching: {
          minTokensForCaching: 32000,
          cacheTTL: 300,
          breakpointStrategy: 'after_last_match',
        },
      };

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
