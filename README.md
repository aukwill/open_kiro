# Open-Kiro

An open-source AI-assisted development tool that provides structured workflows for building software with AI agents.

## Features

- **Specs** - Structured feature development with requirements, design, and task documents
- **Hooks** - Event-driven automation triggered by file saves, messages, or manual actions
- **Steering** - Contextual instructions that guide AI behavior based on active files
- **Plugins** - Extensible architecture for custom triggers and behaviors

## Installation

```bash
npm install open-kiro
```

## Quick Start

Initialize Open-Kiro in your project:

```bash
npx open-kiro init
```

This creates the `.kiro/` directory structure:
- `.kiro/specs/` - Feature specifications
- `.kiro/hooks/` - Automation hooks
- `.kiro/steering/` - AI guidance files

### Create a Spec

```bash
npx open-kiro spec create my-feature
```

### Create a Hook

```bash
npx open-kiro hook create --id lint-on-save --name "Lint on Save" \
  --trigger file_save --action execute_command --command "npm run lint"
```

### Create a Steering File

```bash
npx open-kiro steering create coding-standards --inclusion always
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `open-kiro init` | Initialize workspace |
| `open-kiro spec create <name>` | Create a new spec |
| `open-kiro spec list` | List all specs |
| `open-kiro spec run <name> <task>` | Run a spec task |
| `open-kiro hook create` | Create a new hook |
| `open-kiro hook list` | List all hooks |
| `open-kiro hook trigger <id>` | Manually trigger a hook |
| `open-kiro steering create <name>` | Create a steering file |
| `open-kiro steering list` | List steering files |

## Programmatic API

```typescript
import { SpecManager, HookManager, SteeringManager, NodeFileSystemAdapter } from 'open-kiro';

const fs = new NodeFileSystemAdapter();
const specManager = new SpecManager(fs);

// Create and manage specs
const spec = await specManager.createSpec('my-feature');
const specs = await specManager.listSpecs();
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run lint
```

## Requirements

- Node.js >= 18.0.0

## License

MIT
