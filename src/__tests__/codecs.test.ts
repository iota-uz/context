/**
 * Unit tests for built-in codecs.
 *
 * Tests canonicalization, hash computation, validation, and rendering for all codecs.
 */

import { describe, it, expect } from 'vitest';
import {
  SystemRulesCodec,
  ToolSchemaCodec,
  StructuredReferenceCodec,
  ConversationHistoryCodec,
  ToolOutputCodec,
  RedactedStubCodec,
  UnsafeTextCodec,
  BUILT_IN_CODECS,
  getCodec,
  registerCodec,
} from '../codecs/index.js';
import type { ContextBlock } from '../types/block.js';
import type { BlockCodec } from '../types/codec.js';

describe('Codecs', () => {
  describe('SystemRulesCodec', () => {
    it('should canonicalize payload deterministically', () => {
      const payload1 = { text: '  System rules  ', priority: 1, cacheable: true };
      const payload2 = { text: 'System rules', cacheable: true, priority: 1 };

      const canon1 = SystemRulesCodec.canonicalize(payload1);
      const canon2 = SystemRulesCodec.canonicalize(payload2);

      expect(canon1).toEqual(canon2);
    });

    it('should produce consistent hash for same input', () => {
      const payload = { text: 'Test rules', priority: 1 };

      const canon1 = SystemRulesCodec.canonicalize(payload);
      const canon2 = SystemRulesCodec.canonicalize(payload);

      const hash1 = SystemRulesCodec.hash(canon1);
      const hash2 = SystemRulesCodec.hash(canon2);

      expect(hash1).toBe(hash2);
    });

    it('should validate correct payload', () => {
      const payload = { text: 'Valid rules' };

      const validated = SystemRulesCodec.validate(payload);

      expect(validated).toEqual({ text: 'Valid rules' });
    });

    it('should reject invalid payload', () => {
      const invalid = { text: 123 }; // text must be string

      expect(() => SystemRulesCodec.validate(invalid)).toThrow();
    });

    it('should render for all providers', () => {
      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'pinned',
          sensitivity: 'public',
          codecId: 'system-rules',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: { text: 'System rules', cacheable: true },
      };

      const rendered = SystemRulesCodec.render(block);

      expect(rendered.anthropic).toBeDefined();
      expect(rendered.openai).toBeDefined();
      expect(rendered.gemini).toBeDefined();

      // Anthropic includes cache control
      expect(rendered.anthropic).toHaveProperty('cache_control');
      // OpenAI is a system message
      expect(rendered.openai).toHaveProperty('role', 'system');
      // Gemini is a string
      expect(typeof rendered.gemini).toBe('string');
    });
  });

  describe('ToolSchemaCodec', () => {
    it('should canonicalize tool schema deterministically', () => {
      const payload1 = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: { arg: { type: 'string' } } },
      };
      const payload2 = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { properties: { arg: { type: 'string' } }, type: 'object' },
      };

      const canon1 = ToolSchemaCodec.canonicalize(payload1);
      const canon2 = ToolSchemaCodec.canonicalize(payload2);

      // Should be equal after key sorting
      expect(canon1).toEqual(canon2);
    });

    it('should validate tool schema', () => {
      const payload = {
        name: 'test',
        description: 'A test tool',
        inputSchema: { type: 'object' },
      };

      const validated = ToolSchemaCodec.validate(payload);

      expect(validated.name).toBe('test');
      expect(validated.description).toBe('A test tool');
    });

    it('should render tool schemas for all providers', () => {
      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'reference',
          sensitivity: 'public',
          codecId: 'tool-schema',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: {
          name: 'test_tool',
          description: 'Test',
          inputSchema: { type: 'object' },
        },
      };

      const rendered = ToolSchemaCodec.render(block);

      expect(rendered.anthropic).toBeDefined();
      expect(rendered.openai).toBeDefined();
      expect(rendered.gemini).toBeDefined();
    });
  });

  describe('StructuredReferenceCodec', () => {
    it('should canonicalize structured reference', () => {
      const payload = {
        title: 'Test File',
        content: '  content  ',
        mimeType: 'text/plain',
        sourceUrl: 'file:///test.txt',
      };

      const canon = StructuredReferenceCodec.canonicalize(payload);

      expect(canon).toHaveProperty('title', 'Test File');
      expect(canon).toHaveProperty('content', '  content  '); // Content not trimmed
    });

    it('should validate structured reference', () => {
      const payload = {
        title: 'Test',
        content: 'Test content',
        mimeType: 'text/plain',
      };

      const validated = StructuredReferenceCodec.validate(payload);

      expect(validated.title).toBe('Test');
    });
  });

  describe('ConversationHistoryCodec', () => {
    it('should canonicalize conversation history', () => {
      const payload = {
        messages: [
          { role: 'user' as const, content: 'Hello' },
          { role: 'assistant' as const, content: 'Hi' },
        ],
      };

      const canon = ConversationHistoryCodec.canonicalize(payload);

      expect(canon).toHaveProperty('messages');
      expect(Array.isArray((canon as any).messages)).toBe(true);
    });

    it('should validate conversation history', () => {
      const payload = {
        messages: [{ role: 'user' as const, content: 'Test' }],
      };

      const validated = ConversationHistoryCodec.validate(payload);

      expect(validated.messages).toHaveLength(1);
    });

    it('should render conversation history for all providers', () => {
      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'history',
          sensitivity: 'public',
          codecId: 'conversation-history',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: {
          messages: [
            { role: 'user' as const, content: 'Hello' },
            { role: 'assistant' as const, content: 'Hi there!' },
          ],
        },
      };

      const rendered = ConversationHistoryCodec.render(block);

      expect(rendered.anthropic).toBeDefined();
      expect(rendered.openai).toBeDefined();
      expect(rendered.gemini).toBeDefined();

      // Should render as message arrays
      expect(Array.isArray(rendered.anthropic)).toBe(true);
      expect(Array.isArray(rendered.openai)).toBe(true);
      expect(Array.isArray(rendered.gemini)).toBe(true);
    });
  });

  describe('ToolOutputCodec', () => {
    it('should canonicalize tool output', () => {
      const payload = {
        toolName: 'test_tool',
        toolCallId: 'call_123',
        output: { success: true as const, result: 'success' },
        durationMs: 100,
      };

      const canon = ToolOutputCodec.canonicalize(payload);

      expect(canon).toHaveProperty('toolName', 'test_tool');
      expect(canon).toHaveProperty('output');
    });

    it('should validate tool output', () => {
      const payload = {
        toolName: 'test',
        toolCallId: 'call_123',
        output: { success: true as const, result: 'result' },
      };

      const validated = ToolOutputCodec.validate(payload);

      expect(validated.toolName).toBe('test');
    });

    it('should compact large tool outputs', () => {
      const largeOutput = 'x'.repeat(10000);
      const payload = {
        toolName: 'test',
        toolCallId: 'call_123',
        output: { success: true as const, result: largeOutput },
      };

      const canon = ToolOutputCodec.canonicalize(payload);

      // Canon should have output property
      expect((canon as any).output).toBeDefined();
    });
  });

  describe('RedactedStubCodec', () => {
    it('should canonicalize redacted stub', () => {
      const payload = {
        originalBlockHash: 'hash123',
        reason: 'Sensitivity redaction',
        placeholder: '[REDACTED]',
      };

      const canon = RedactedStubCodec.canonicalize(payload);

      expect(canon).toHaveProperty('originalBlockHash', 'hash123');
      expect(canon).toHaveProperty('reason');
    });

    it('should validate redacted stub', () => {
      const payload = {
        originalBlockHash: 'hash123',
        reason: 'Test',
      };

      const validated = RedactedStubCodec.validate(payload);

      expect(validated.originalBlockHash).toBe('hash123');
    });

    it('should render redacted stub for all providers', () => {
      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'memory',
          sensitivity: 'public',
          codecId: 'redacted-stub',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: {
          originalBlockHash: 'hash123',
          reason: 'Redacted',
        },
      };

      const rendered = RedactedStubCodec.render(block);

      // Should render as placeholder text
      expect(rendered.anthropic).toBeDefined();
      expect(rendered.openai).toBeDefined();
      expect(rendered.gemini).toBeDefined();
    });
  });

  describe('UnsafeTextCodec', () => {
    it('should canonicalize unsafe text', () => {
      const payload = {
        text: '  Test text  ',
      };

      const canon = UnsafeTextCodec.canonicalize(payload);

      expect(canon).toHaveProperty('text', 'Test text'); // trimmed
    });

    it('should validate unsafe text', () => {
      const payload = {
        text: 'Test',
      };

      const validated = UnsafeTextCodec.validate(payload);

      expect(validated.text).toBe('Test');
    });

    it('should render unsafe text for all providers', () => {
      const block: ContextBlock<any> = {
        blockHash: 'test',
        meta: {
          kind: 'turn',
          sensitivity: 'public',
          codecId: 'unsafe-text',
          codecVersion: '1.0.0',
          createdAt: Date.now(),
        },
        payload: {
          text: 'User message',
        },
      };

      const rendered = UnsafeTextCodec.render(block);

      expect(rendered.anthropic).toBeDefined();
      expect(rendered.openai).toBeDefined();
      expect(rendered.gemini).toBeDefined();
    });
  });

  describe('Codec Registry', () => {
    it('should retrieve built-in codecs', () => {
      expect(getCodec('system-rules')).toBe(SystemRulesCodec);
      expect(getCodec('tool-schema')).toBe(ToolSchemaCodec);
      expect(getCodec('structured-reference')).toBe(StructuredReferenceCodec);
      expect(getCodec('conversation-history')).toBe(ConversationHistoryCodec);
      expect(getCodec('tool-output')).toBe(ToolOutputCodec);
      expect(getCodec('redacted-stub')).toBe(RedactedStubCodec);
      expect(getCodec('unsafe-text')).toBe(UnsafeTextCodec);
    });

    it('should return undefined for unknown codec', () => {
      expect(getCodec('non-existent')).toBeUndefined();
    });

    it('should register custom codec', () => {
      const customCodec: BlockCodec<string> = {
        codecId: 'custom-test',
        version: '1.0.0',
        payloadSchema: null as any,
        canonicalize: (payload) => payload,
        hash: (canon) => 'test-hash',
        validate: (payload) => payload as string,
        render: () => ({
          anthropic: 'test',
          openai: 'test',
          gemini: 'test',
        }),
      };

      registerCodec(customCodec);

      expect(getCodec('custom-test')).toBe(customCodec);
    });

    it('should throw on duplicate codec registration', () => {
      expect(() => registerCodec(SystemRulesCodec)).toThrow('already registered');
    });

    it('should have all built-in codecs in registry', () => {
      expect(Object.keys(BUILT_IN_CODECS)).toHaveLength(8);
      expect(BUILT_IN_CODECS['system-rules']).toBeDefined();
      expect(BUILT_IN_CODECS['tool-schema']).toBeDefined();
      expect(BUILT_IN_CODECS['structured-reference']).toBeDefined();
      expect(BUILT_IN_CODECS['conversation-history']).toBeDefined();
      expect(BUILT_IN_CODECS['tool-output']).toBeDefined();
      expect(BUILT_IN_CODECS['redacted-stub']).toBeDefined();
      expect(BUILT_IN_CODECS['unsafe-text']).toBeDefined();
    });
  });
});
