import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ContextManager } from './context-manager.js';
import { SpecManager } from '../spec-manager/spec-manager.js';
import { SteeringManager } from '../steering-manager/steering-manager.js';
import { InMemoryFileSystemAdapter } from '../filesystem/filesystem-adapter.js';

describe('ContextManager', () => {
  let fs: InMemoryFileSystemAdapter;
  let specManager: SpecManager;
  let steeringManager: SteeringManager;
  let contextManager: ContextManager;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    specManager = new SpecManager(fs);
    steeringManager = new SteeringManager(fs);
    contextManager = new ContextManager(fs, specManager, steeringManager);
  });

  /**
   * **Feature: open-kiro, Property 12: Task Execution Context Loading**
   * **Validates: Requirements 4.1**
   * 
   * *For any* task being executed, the system should load the associated spec's
   * requirements.md and design.md into the agent context before execution begins.
   */
  describe('Property 12: Task Execution Context Loading', () => {
    // Generator for valid spec names
    const validSpecNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 30 }
    ).filter(s => /^[a-z][a-z0-9-]*$/.test(s) && !s.includes('--'));

    it('should load requirements and design when spec is specified', async () => {
      await fc.assert(
        fc.asyncProperty(
          validSpecNameArb,
          async (specName) => {
            fs.clear();

            // Create a spec
            await specManager.createSpec(specName);

            // Build context with spec reference
            const context = await contextManager.buildContext({
              message: 'Execute task',
              spec: specName
            });

            // Verify spec context is loaded
            expect(context.specContext).toBeDefined();
            expect(context.specContext?.name).toBe(specName);
            expect(context.specContext?.requirements).not.toBeNull();
            expect(context.specContext?.design).not.toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });


    it('should load current task when taskId is specified', async () => {
      fs.clear();

      // Create a spec with tasks
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. First task
  - Task details
  - _Requirements: 1.1_

- [ ] 2. Second task
  - [ ] 2.1 Sub-task one
    - _Requirements: 2.1_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Build context with spec and task reference
      const context = await contextManager.buildContext({
        message: 'Execute task',
        spec: 'test-spec',
        taskId: '2.1'
      });

      // Verify current task is loaded
      expect(context.specContext?.currentTask).toBeDefined();
      expect(context.specContext?.currentTask?.id).toBe('2.1');
      expect(context.specContext?.currentTask?.description).toBe('Sub-task one');
    });

    it('should include spec files in active files for steering context', async () => {
      fs.clear();

      // Create a spec
      await specManager.createSpec('test-spec');

      // Create a steering file that matches spec files
      await fs.writeFile('.kiro/steering/spec-helper.md', `---
inclusion: fileMatch
fileMatchPattern: "**/*.md"
---

# Spec Helper

Guidelines for working with specs.
`);

      // Build context with spec reference
      const context = await contextManager.buildContext({
        message: 'Execute task',
        spec: 'test-spec'
      });

      // Steering content should be included because spec files match the pattern
      expect(context.steeringContent).toContain('Spec Helper');
    });

    it('should return empty specContext when no spec is specified', async () => {
      fs.clear();

      const context = await contextManager.buildContext({
        message: 'General question'
      });

      expect(context.specContext).toBeUndefined();
    });

    it('should throw when loading non-existent spec', async () => {
      fs.clear();

      await expect(
        contextManager.buildContext({
          message: 'Execute task',
          spec: 'nonexistent-spec'
        })
      ).rejects.toThrow("Spec 'nonexistent-spec' not found");
    });
  });

  /**
   * **Feature: open-kiro, Property 18: Context Reference Resolution**
   * **Validates: Requirements 6.2, 6.3**
   * 
   * *For any* user message containing `#File` or `#Folder` references,
   * the referenced content should be included in the agent context.
   */
  describe('Property 18: Context Reference Resolution', () => {
    // Generator for valid file paths
    const validFilePathArb = fc.tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 10 }),
      fc.constantFrom('.ts', '.js', '.md', '.json', '.txt')
    ).map(([name, ext]) => `src/${name}${ext}`);

    // Generator for file content
    const fileContentArb = fc.string({ minLength: 1, maxLength: 500 });

    it('should include explicit file content in context', async () => {
      await fc.assert(
        fc.asyncProperty(
          validFilePathArb,
          fileContentArb,
          async (filePath, fileContent) => {
            fs.clear();

            // Create the file
            await fs.writeFile(filePath, fileContent);

            // Build context with explicit file reference
            const context = await contextManager.buildContext({
              message: 'Help with this file',
              explicitFiles: [filePath]
            });

            // Verify file content is included
            const foundFile = context.fileContents.find(f => f.path === filePath);
            expect(foundFile).toBeDefined();
            expect(foundFile?.content).toBe(fileContent);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include folder contents in context', async () => {
      fs.clear();

      // Create files in a folder
      await fs.writeFile('src/utils/helper.ts', 'export function helper() {}');
      await fs.writeFile('src/utils/constants.ts', 'export const VALUE = 42;');

      // Build context with explicit folder reference
      const context = await contextManager.buildContext({
        message: 'Help with this folder',
        explicitFolders: ['src/utils']
      });

      // Verify folder contents are included
      expect(context.fileContents.length).toBeGreaterThanOrEqual(2);
      
      const helperFile = context.fileContents.find(f => f.path === 'src/utils/helper.ts');
      const constantsFile = context.fileContents.find(f => f.path === 'src/utils/constants.ts');
      
      expect(helperFile).toBeDefined();
      expect(helperFile?.content).toBe('export function helper() {}');
      expect(constantsFile).toBeDefined();
      expect(constantsFile?.content).toBe('export const VALUE = 42;');
    });

    it('should handle multiple file references', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(validFilePathArb, fileContentArb),
            { minLength: 1, maxLength: 5 }
          ).filter(arr => {
            // Ensure unique paths
            const paths = arr.map(([p]) => p);
            return new Set(paths).size === paths.length;
          }),
          async (filesWithContent) => {
            fs.clear();

            // Create all files
            for (const [path, content] of filesWithContent) {
              await fs.writeFile(path, content);
            }

            const filePaths = filesWithContent.map(([p]) => p);

            // Build context with multiple file references
            const context = await contextManager.buildContext({
              message: 'Help with these files',
              explicitFiles: filePaths
            });

            // Verify all files are included
            for (const [path, content] of filesWithContent) {
              const foundFile = context.fileContents.find(f => f.path === path);
              expect(foundFile).toBeDefined();
              expect(foundFile?.content).toBe(content);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should skip non-existent files gracefully', async () => {
      fs.clear();

      // Create one file but reference two
      await fs.writeFile('src/exists.ts', 'content');

      const context = await contextManager.buildContext({
        message: 'Help with files',
        explicitFiles: ['src/exists.ts', 'src/nonexistent.ts']
      });

      // Only existing file should be included
      expect(context.fileContents.length).toBe(1);
      expect(context.fileContents[0].path).toBe('src/exists.ts');
    });

    it('should deduplicate file references', async () => {
      fs.clear();

      await fs.writeFile('src/file.ts', 'content');

      // Reference same file multiple times
      const context = await contextManager.buildContext({
        message: 'Help with file',
        explicitFiles: ['src/file.ts', 'src/file.ts', 'src/file.ts']
      });

      // File should only appear once
      const matchingFiles = context.fileContents.filter(f => f.path === 'src/file.ts');
      expect(matchingFiles.length).toBe(1);
    });
  });

  describe('Context Management', () => {
    it('should add files to explicit context', async () => {
      fs.clear();

      await fs.writeFile('src/file.ts', 'content');

      // Add file to context
      await contextManager.addFile('src/file.ts');

      // Build context - file should be included
      const context = await contextManager.buildContext({
        message: 'Help'
      });

      expect(context.fileContents.some(f => f.path === 'src/file.ts')).toBe(true);
    });

    it('should throw when adding non-existent file', async () => {
      fs.clear();

      await expect(
        contextManager.addFile('nonexistent.ts')
      ).rejects.toThrow('File not found: nonexistent.ts');
    });

    it('should add folders to explicit context', async () => {
      fs.clear();

      await fs.writeFile('src/utils/file.ts', 'content');

      // Add folder to context
      await contextManager.addFolder('src/utils');

      // Build context - folder contents should be included
      const context = await contextManager.buildContext({
        message: 'Help'
      });

      expect(context.fileContents.some(f => f.path === 'src/utils/file.ts')).toBe(true);
    });

    it('should throw when adding non-existent folder', async () => {
      fs.clear();

      await expect(
        contextManager.addFolder('nonexistent')
      ).rejects.toThrow('Folder not found: nonexistent');
    });

    it('should clear context', async () => {
      fs.clear();

      await fs.writeFile('src/file.ts', 'content');
      await fs.writeFile('src/utils/helper.ts', 'helper');

      // Add file and folder
      await contextManager.addFile('src/file.ts');
      await contextManager.addFolder('src/utils');

      // Clear context
      contextManager.clearContext();

      // Build context - nothing should be included from explicit context
      const context = await contextManager.buildContext({
        message: 'Help'
      });

      expect(context.fileContents.length).toBe(0);
    });

    it('should maintain conversation history', () => {
      contextManager.addMessage({
        role: 'user',
        content: 'Hello',
        timestamp: new Date()
      });

      contextManager.addMessage({
        role: 'assistant',
        content: 'Hi there!',
        timestamp: new Date()
      });

      const history = contextManager.getConversationHistory();
      expect(history.length).toBe(2);
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
    });

    it('should clear conversation history on clearContext', () => {
      contextManager.addMessage({
        role: 'user',
        content: 'Hello',
        timestamp: new Date()
      });

      contextManager.clearContext();

      const history = contextManager.getConversationHistory();
      expect(history.length).toBe(0);
    });
  });

  describe('System Prompt and Steering Integration', () => {
    it('should include system prompt in context', async () => {
      fs.clear();

      const context = await contextManager.buildContext({
        message: 'Help'
      });

      expect(context.systemPrompt).toBeDefined();
      expect(context.systemPrompt.length).toBeGreaterThan(0);
    });

    it('should include steering content in context', async () => {
      fs.clear();

      // Create an always-included steering file
      await fs.writeFile('.kiro/steering/coding-standards.md', `# Coding Standards

Always use TypeScript strict mode.
`);

      const context = await contextManager.buildContext({
        message: 'Help'
      });

      expect(context.steeringContent).toContain('Coding Standards');
    });

    it('should return empty steering content when no steering files exist', async () => {
      fs.clear();

      const context = await contextManager.buildContext({
        message: 'Help'
      });

      expect(context.steeringContent).toBe('');
    });

    /**
     * Tests for steering inclusion modes (Requirements 3.2, 3.3, 3.4)
     */
    it('should include always-mode steering regardless of active files', async () => {
      fs.clear();

      // Create an always-included steering file
      await fs.writeFile('.kiro/steering/always-included.md', `# Always Included

This content should always be included.
`);

      const context = await contextManager.buildContext({
        message: 'Help',
        explicitFiles: [] // No files
      });

      expect(context.steeringContent).toContain('Always Included');
    });

    it('should include fileMatch-mode steering only when matching files are active', async () => {
      fs.clear();

      // Create a fileMatch steering file for TypeScript
      await fs.writeFile('.kiro/steering/typescript-rules.md', `---
inclusion: fileMatch
fileMatchPattern: "**/*.ts"
---

# TypeScript Rules

Use strict mode.
`);

      // Create a TypeScript file
      await fs.writeFile('src/app.ts', 'const x = 1;');

      // Context with matching file - should include steering
      const contextWithTs = await contextManager.buildContext({
        message: 'Help',
        explicitFiles: ['src/app.ts']
      });
      expect(contextWithTs.steeringContent).toContain('TypeScript Rules');

      // Context without matching file - should not include steering
      const contextWithoutTs = await contextManager.buildContext({
        message: 'Help',
        explicitFiles: []
      });
      expect(contextWithoutTs.steeringContent).not.toContain('TypeScript Rules');
    });

    it('should include manual-mode steering only when explicitly referenced', async () => {
      fs.clear();

      // Create a manual steering file
      await fs.writeFile('.kiro/steering/special-guide.md', `---
inclusion: manual
---

# Special Guide

This is a special guide that must be manually included.
`);

      // Context without manual inclusion - should not include steering
      const contextWithout = await contextManager.buildContext({
        message: 'Help'
      });
      expect(contextWithout.steeringContent).not.toContain('Special Guide');

      // Context with manual inclusion - should include steering
      const contextWith = await contextManager.buildContext({
        message: 'Help',
        manualSteering: ['special-guide']
      });
      expect(contextWith.steeringContent).toContain('Special Guide');
    });

    it('should combine multiple steering files based on their inclusion modes', async () => {
      fs.clear();

      // Create multiple steering files with different modes
      await fs.writeFile('.kiro/steering/always.md', '# Always Content');
      
      await fs.writeFile('.kiro/steering/ts-only.md', `---
inclusion: fileMatch
fileMatchPattern: "**/*.ts"
---

# TS Only Content
`);

      await fs.writeFile('.kiro/steering/manual-only.md', `---
inclusion: manual
---

# Manual Only Content
`);

      // Create a TypeScript file
      await fs.writeFile('src/file.ts', 'code');

      // Context with TS file and manual inclusion
      const context = await contextManager.buildContext({
        message: 'Help',
        explicitFiles: ['src/file.ts'],
        manualSteering: ['manual-only']
      });

      expect(context.steeringContent).toContain('Always Content');
      expect(context.steeringContent).toContain('TS Only Content');
      expect(context.steeringContent).toContain('Manual Only Content');
    });
  });
});
