# Tech Stack

## Runtime & Language
- Node.js >= 18.0.0
- TypeScript 5.3+ with strict mode enabled
- ES Modules (ESM) - use `.js` extensions in imports

## Dependencies
- `commander` - CLI framework
- `yaml` - YAML parsing for front-matter
- `minimatch` - Glob pattern matching

## Dev Dependencies
- `vitest` - Test framework
- `fast-check` - Property-based testing

## Build & Commands

```bash
# Build TypeScript to dist/
npm run build

# Run tests (single run)
npm test

# Type check without emitting
npm run lint
```

## TypeScript Configuration
- Target: ES2022
- Module: ESNext with bundler resolution
- Strict null checks and all strict options enabled
- No unused locals/parameters allowed
- Output to `dist/` with declarations and source maps
