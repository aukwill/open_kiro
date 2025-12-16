# Project Structure

```
src/
├── types/index.ts          # Shared type definitions
├── index.ts                # Public API exports
├── cli/                    # CLI entry point (commander-based)
├── filesystem/             # File system abstraction layer
├── spec-manager/           # Spec CRUD and task status management
├── hook-manager/           # Hook registration and event handling
├── steering-manager/       # Steering file loading and context matching
├── context-manager/        # Agent context assembly
├── config-watcher/         # File system change monitoring
├── startup-loader/         # Initialization logic
├── plugin-registry/        # Plugin system
└── __tests__/integration/  # Integration tests
```

## Conventions

- Each module has its own folder with `{name}.ts` and `{name}.test.ts`
- Interfaces prefixed with `I` (e.g., `ISpecManager`, `IFileSystemAdapter`)
- Use dependency injection via constructor for testability
- `InMemoryFileSystemAdapter` for unit tests, `NodeFileSystemAdapter` for production
- Property-based tests use `fast-check` with descriptive comments linking to requirements

## Data Storage

All data lives under `.kiro/` in the workspace:
- `.kiro/specs/{name}/` - Spec documents (requirements.md, design.md, tasks.md)
- `.kiro/hooks/{id}.json` - Hook configurations
- `.kiro/steering/*.md` - Steering files with optional YAML front-matter
