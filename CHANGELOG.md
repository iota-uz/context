# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-31

### Added
- Initial public release
- Context management library for LLM conversations
- Token budgeting with automatic compaction
- Multi-provider support (Anthropic, OpenAI, Gemini)
- Flexible codec system for block encoding/decoding
- Content-addressed blocks with stable hashing
- Query-based block selection
- Context forking with sensitivity filtering
- Comprehensive test suite

### Features
- **Block Ordering**: Deterministic ordering (pinned → reference → memory → state → tool_output → history → turn)
- **Token Budgeting**: Context window size configuration with per-kind priorities
- **Codecs**: System rules, conversation history, tool schemas, tool output, references, redacted stubs
- **Token Estimators**: Anthropic, OpenAI (tiktoken), and Gemini
- **Providers**: Anthropic, OpenAI, and Gemini compiler support
- **Builder API**: Fluent interface for composing context blocks
- **Policies**: Configurable token management and compaction strategies
