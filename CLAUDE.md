# @diyor28/context

## Design Philosophy

This library exists to make **bad context physically hard to create**. Context engineering for LLMs is subtle—small mistakes compound into degraded performance, and best practices are often non-obvious. Rather than documenting rules developers must remember, this library encodes those rules into its type system and runtime behavior.

**Core principle:** If you can compile it, it's probably good context.

## Key Design Decisions

### 1. Deterministic Block Ordering (KIND_ORDER)

**Problem:** Developers manually ordering context create inconsistent prompts. LLMs are sensitive to information position—instructions buried after conversation history get ignored.

**Solution:** Blocks declare their `kind`, and the library enforces ordering:

```
pinned → reference → memory → state → tool_output → history → turn
```

You cannot put system rules after conversation history. The type system won't allow it. This single constraint eliminates an entire class of context bugs.

### 2. Content-Addressed Blocks

**Problem:** Duplicate context wastes tokens and confuses models. Manual deduplication is error-prone.

**Solution:** Every block is hashed from its canonical form. Add the same block twice? It's automatically deduplicated. Change a block slightly? It gets a new hash and both versions can coexist if needed.

### 3. Codec-Based Rendering

**Problem:** Different content types need different rendering for different providers. Developers either create provider-specific spaghetti or lose fidelity with lowest-common-denominator approaches.

**Solution:** Codecs handle the translation. A `tool-schema` block knows how to render itself for Anthropic's tool format, OpenAI's function calling, and Gemini's declarations. Add a block once, render anywhere.

### 4. Sensitivity as a First-Class Concept

**Problem:** Sensitive data leaks into contexts where it shouldn't be—logging, forked conversations, external API calls.

**Solution:** Every block declares sensitivity (`public`, `internal`, `confidential`, `secret`). Compilers can filter or redact based on the target context. A fork for speculative execution can be constrained to `public` data only.

### 5. Token Budgeting with Automatic Compaction

**Problem:** Context overflow is discovered at API call time, leading to crude truncation or crashes.

**Solution:** Token estimation is built-in. When budget is exceeded, the library intelligently compacts—pruning old tool outputs first, then summarizing history, preserving pinned content. The overflow strategy is declared upfront, not handled ad-hoc.

### 6. Immutable Graph Operations

**Problem:** Shared mutable context leads to race conditions and debugging nightmares in concurrent systems.

**Solution:** The `ContextGraph` is immutable. Operations return new graphs. Forks create isolated branches. You can safely pass context across async boundaries.

## Architecture

```
src/
├── codecs/          # Block renderers (one per content type)
├── graph/           # Immutable context graph + KIND_ORDER
├── pipeline/        # Compaction and summarization
├── providers/       # Anthropic, OpenAI, Gemini compilers
├── types/           # Core type definitions
└── index.ts         # Public API
```

## Commands

```bash
pnpm build        # Compile TypeScript
pnpm test         # Run all tests (224 tests)
pnpm lint         # ESLint check
pnpm typecheck    # TypeScript strict check
```

## Adding a New Codec

Codecs are the extension point. To support a new content type:

1. Create `src/codecs/my-content.codec.ts`
2. Implement `BlockCodec` interface: `canonicalize`, `hash`, `validate`, `render`
3. Export from `src/codecs/index.ts`
4. Add tests in `src/__tests__/codecs.test.ts`

The `render` method returns provider-specific formats (`anthropic`, `openai`, `gemini`). This is where provider differences are encapsulated.

## Testing Philosophy

Tests verify the constraints work:
- Ordering tests confirm KIND_ORDER is enforced
- Hash tests confirm deterministic canonicalization
- Compaction tests confirm budget overflow is handled gracefully
- Integration tests confirm end-to-end compilation

If a test passes, the constraint is working. If you can write code that violates a context engineering principle, that's a missing test.
