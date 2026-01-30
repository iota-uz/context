# @foundry/context

Context management library for LLM conversations with deterministic block ordering, token budgeting, and multi-provider support.

## Features

- **Deterministic block ordering**: KIND_ORDER ensures consistent context compilation
- **Content-addressed blocks**: Stable hashing for deduplication and caching
- **Token budgeting**: First-class token estimation and overflow handling
- **Multi-provider support**: Anthropic Claude, OpenAI GPT, Google Gemini
- **Codec system**: Extensible block rendering with validation
- **Automatic compaction**: Tool output pruning and history summarization
- **Sensitivity filtering**: Fine-grained content control for sensitive data
- **Attachment management**: Budget-aware file selection

## Installation

```bash
pnpm add @foundry/context
```

## Quick Start

```typescript
import {
  ContextBuilder,
  DEFAULT_POLICY,
  BUILT_IN_CODECS,
  AnthropicTokenEstimator,
  AnthropicCompiler,
} from '@foundry/context';

// 1. Create a context builder with default policy
const builder = new ContextBuilder({
  policy: DEFAULT_POLICY,
  codecs: BUILT_IN_CODECS,
  tokenEstimator: new AnthropicTokenEstimator('claude-sonnet-4-5'),
});

// 2. Add context blocks
builder.addBlock({
  kind: 'pinned',
  codecId: 'system-rules',
  payload: {
    rules: ['Be helpful and concise', 'Always validate inputs'],
  },
  sensitivity: 'public',
});

builder.addBlock({
  kind: 'history',
  codecId: 'conversation-history',
  payload: {
    messages: [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi! How can I help you?' },
    ],
  },
  sensitivity: 'public',
});

// 3. Compile to provider-specific format
const compiled = AnthropicCompiler.compile(builder.getGraph());

// 4. Send to LLM
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 8000,
  system: compiled.system,
  messages: compiled.messages,
});
```

## Core Concepts

### Context Blocks

Context blocks are the fundamental unit of context management. Each block has:

- **kind**: Determines ordering and priority (`pinned`, `reference`, `memory`, `state`, `tool_output`, `history`, `turn`)
- **codecId**: Defines how the block is rendered (e.g., `system-rules`, `tool-schema`, `conversation-history`)
- **payload**: The actual content (codec-specific structure)
- **sensitivity**: Access level (`public`, `internal`, `confidential`, `secret`)

### Block Ordering (KIND_ORDER)

Blocks are automatically ordered by kind for deterministic compilation:

1. `pinned` - System rules, core instructions (always at top)
2. `reference` - Documentation, schemas, guidelines
3. `memory` - Long-term facts, user preferences
4. `state` - Workflow state, execution context
5. `tool_output` - Tool/function call results
6. `history` - Conversation history
7. `turn` - Current user message (always at bottom)

### Token Budgeting

The library automatically manages token budgets:

```typescript
const policy = {
  ...DEFAULT_POLICY,
  contextWindow: 200_000,
  completionReserve: 8_000,
  overflowStrategy: 'compact', // Auto-prune old tool outputs
};
```

### Built-in Codecs

- `system-rules` - System instructions and rules
- `tool-schema` - Function/tool definitions
- `structured-reference` - Markdown documentation
- `conversation-history` - Chat messages
- `tool-output` - Function call results
- `redacted-stub` - Placeholder for sensitive content
- `unsafe-text` - Raw text (bypasses validation)

### Custom Codecs

Implement the `BlockCodec` interface to create custom renderers:

```typescript
import { BlockCodec, registerCodec } from '@foundry/context';

const myCodec: BlockCodec = {
  codecId: 'my-custom-codec',

  encode(payload: unknown) {
    // Validate and return typed payload
    return payload as MyPayloadType;
  },

  render(payload: MyPayloadType) {
    // Return rendered text
    return `# Custom Content\n${payload.text}`;
  },

  estimateTokens(payload: MyPayloadType) {
    // Return estimated token count
    return payload.text.length / 4;
  },
};

registerCodec(myCodec);
```

## Multi-Provider Support

### Anthropic Claude

```typescript
import { AnthropicTokenEstimator, AnthropicCompiler } from '@foundry/context';

const estimator = new AnthropicTokenEstimator('claude-sonnet-4-5');
const compiled = AnthropicCompiler.compile(graph);
```

### OpenAI GPT

```typescript
import { OpenAITokenEstimator, OpenAICompiler } from '@foundry/context';

const estimator = new OpenAITokenEstimator('gpt-5.2');
const compiled = OpenAICompiler.compile(graph);
```

### Google Gemini

```typescript
import { GeminiTokenEstimator, GeminiCompiler } from '@foundry/context';

const estimator = new GeminiTokenEstimator('gemini-3-pro-preview');
const compiled = GeminiCompiler.compile(graph);
```

## Advanced Features

### Automatic Compaction

When token budget is exceeded, the library automatically:

1. Prunes old tool outputs (configurable age threshold)
2. Summarizes conversation history
3. Removes least-recently-used attachments

```typescript
const policy = {
  ...DEFAULT_POLICY,
  compaction: {
    pruneToolOutputs: true,
    maxToolOutputAge: 3600, // 1 hour
    summarizeHistory: true,
    maxHistoryMessages: 20,
  },
};
```

### Context Forking

Create isolated branches for parallel operations:

```typescript
const fork = builder.fork({
  branchId: 'speculative-execution',
  sensitivity: {
    maxSensitivity: 'public', // Restrict to public data only
    redactRestricted: true,
  },
});

fork.addBlock({
  kind: 'turn',
  codecId: 'conversation-history',
  payload: { messages: [{ role: 'user', content: 'What if...?' }] },
  sensitivity: 'public',
});

// Original builder is unchanged
```

### Attachment Management

Smart selection of attachments based on budget and priority:

```typescript
import { AttachmentSelector } from '@foundry/context';

const selector = new AttachmentSelector({
  maxTokensTotal: 10_000,
  selectionStrategy: {
    rankBy: ['purpose', 'user_mention', 'recency'],
    purposePriority: {
      evidence: 1,    // Highest priority
      input: 2,
      context: 3,
      artifact: 4,    // Lowest priority
    },
  },
});

const selected = selector.select(attachments, tokenEstimator);
```

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Watch mode
pnpm test:watch
```

## Documentation

See `/docs` for detailed documentation:

- Architecture overview
- Token estimation guide
- Custom codec development
- Provider integration guide

## License

MIT
