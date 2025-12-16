import { describe, it, expect, beforeEach } from 'vitest';
import { SpecManager } from '../spec-manager/spec-manager.js';
import { HookManager } from '../hook-manager/hook-manager.js';
import { SteeringManager } from '../steering-manager/steering-manager.js';
import { InMemoryFileSystemAdapter } from '../filesystem/filesystem-adapter.js';

/**
 * CLI Integration Tests
 * Tests the CLI commands through the underlying managers
 * 
 * Note: These tests verify the manager functionality that the CLI uses,
 * rather than testing the CLI argument parsing directly.
 */

describe('CLI - Spec Commands', () => {
  let fs: InMemoryFileSystemAdapter;
  let specManager: SpecManager;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    specManager = new SpecManager(fs);
  });

  describe('spec create', () => {
    it('should create a new spec with all required files', async () => {
      const spec = await specManager.createSpec('my-feature');
      
      expect(spec.name).toBe('my-feature');
      expect(spec.path).toBe('.kiro/specs/my-feature');
      expect(await fs.exists('.kiro/specs/my-feature/requirements.md')).toBe(true);
      expect(await fs.exists('.kiro/specs/my-feature/design.md')).toBe(true);
      expect(await fs.exists('.kiro/specs/my-feature/tasks.md')).toBe(true);
    });

    it('should reject invalid spec names', async () => {
      await expect(specManager.createSpec('Invalid Name')).rejects.toThrow();
      await expect(specManager.createSpec('')).rejects.toThrow();
      await expect(specManager.createSpec('123-start')).rejects.toThrow();
    });
  });

  describe('spec list', () => {
    it('should list all specs in workspace', async () => {
      await specManager.createSpec('feature-one');
      await specManager.createSpec('feature-two');
      
      const specs = await specManager.listSpecs();
      
      expect(specs).toHaveLength(2);
      expect(specs.map(s => s.name)).toContain('feature-one');
      expect(specs.map(s => s.name)).toContain('feature-two');
    });

    it('should return empty array when no specs exist', async () => {
      const specs = await specManager.listSpecs();
      expect(specs).toHaveLength(0);
    });
  });


  describe('spec run', () => {
    it('should update task status to in_progress', async () => {
      await specManager.createSpec('test-spec');
      
      // Update tasks.md with a proper task
      const tasksContent = `# Implementation Plan

- [ ] 1. First task
  - Task details
  - _Requirements: 1.1_
`;
      await specManager.updateDocument('test-spec', 'tasks', tasksContent);
      
      // Run the task
      await specManager.setTaskStatus('test-spec', '1', 'in_progress');
      
      // Verify status changed
      const statuses = await specManager.getTaskStatus('test-spec');
      expect(statuses[0].status).toBe('in_progress');
    });
  });
});

describe('CLI - Hook Commands', () => {
  let fs: InMemoryFileSystemAdapter;
  let hookManager: HookManager;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    hookManager = new HookManager(fs);
  });

  describe('hook create', () => {
    it('should create a new hook with send_message action', async () => {
      const hook = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' as const },
        action: { type: 'send_message' as const, message: 'Hello' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      const hooks = await hookManager.listHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0].id).toBe('test-hook');
      expect(hooks[0].action.type).toBe('send_message');
    });

    it('should create a new hook with execute_command action', async () => {
      const hook = {
        id: 'cmd-hook',
        name: 'Command Hook',
        trigger: { type: 'file_save' as const },
        action: { type: 'execute_command' as const, command: 'echo test' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      const hooks = await hookManager.listHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks[0].action.type).toBe('execute_command');
    });
  });

  describe('hook list', () => {
    it('should list all hooks after loading', async () => {
      await hookManager.registerHook({
        id: 'hook-1',
        name: 'Hook One',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'msg1' },
        enabled: true
      });
      await hookManager.registerHook({
        id: 'hook-2',
        name: 'Hook Two',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'msg2' },
        enabled: false
      });
      
      // Simulate reload
      const newHookManager = new HookManager(fs);
      await newHookManager.loadHooks();
      
      const hooks = await newHookManager.listHooks();
      expect(hooks).toHaveLength(2);
    });
  });

  describe('hook trigger', () => {
    it('should trigger a manual hook', async () => {
      await hookManager.registerHook({
        id: 'echo-hook',
        name: 'Echo Hook',
        trigger: { type: 'manual' },
        action: { type: 'execute_command', command: 'echo hello' },
        enabled: true
      });
      
      const result = await hookManager.triggerHook('echo-hook');
      expect(result.success).toBe(true);
    });

    it('should fail for non-existent hook', async () => {
      const result = await hookManager.triggerHook('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});


describe('CLI - Steering Commands', () => {
  let fs: InMemoryFileSystemAdapter;
  let steeringManager: SteeringManager;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    steeringManager = new SteeringManager(fs);
  });

  describe('steering create', () => {
    it('should create a steering file with always inclusion', async () => {
      await steeringManager.createSteeringFile('coding-standards', {
        inclusion: 'always'
      }, '# Coding Standards\n\nFollow these rules.');
      
      const files = await steeringManager.loadSteeringFiles();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('coding-standards');
      expect(files[0].config.inclusion).toBe('always');
    });

    it('should create a steering file with fileMatch inclusion', async () => {
      await steeringManager.createSteeringFile('typescript-rules', {
        inclusion: 'fileMatch',
        fileMatchPattern: '**/*.ts'
      }, '# TypeScript Rules');
      
      const files = await steeringManager.loadSteeringFiles();
      expect(files).toHaveLength(1);
      expect(files[0].config.inclusion).toBe('fileMatch');
      expect(files[0].config.fileMatchPattern).toBe('**/*.ts');
    });

    it('should create a steering file with manual inclusion', async () => {
      await steeringManager.createSteeringFile('special-rules', {
        inclusion: 'manual',
        description: 'Special rules for specific cases'
      }, '# Special Rules');
      
      const files = await steeringManager.loadSteeringFiles();
      expect(files).toHaveLength(1);
      expect(files[0].config.inclusion).toBe('manual');
    });
  });

  describe('steering list', () => {
    it('should list all steering files', async () => {
      await steeringManager.createSteeringFile('rules-one', { inclusion: 'always' }, 'Content 1');
      await steeringManager.createSteeringFile('rules-two', { inclusion: 'manual' }, 'Content 2');
      
      const files = await steeringManager.loadSteeringFiles();
      expect(files).toHaveLength(2);
      expect(files.map(f => f.name)).toContain('rules-one');
      expect(files.map(f => f.name)).toContain('rules-two');
    });

    it('should return empty array when no steering files exist', async () => {
      const files = await steeringManager.loadSteeringFiles();
      expect(files).toHaveLength(0);
    });
  });
});
