import { describe, it, expect, beforeEach } from 'vitest';
import { SteeringManager } from '../../steering-manager/steering-manager.js';
import { SpecManager } from '../../spec-manager/spec-manager.js';
import { ContextManager } from '../../context-manager/context-manager.js';
import { InMemoryFileSystemAdapter } from '../../filesystem/filesystem-adapter.js';
import type { SteeringConfig } from '../../types/index.js';

/**
 * Integration tests for steering
 * Tests steering loading and context inclusion
 * 
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
 */
describe('Steering Integration', () => {
  let fs: InMemoryFileSystemAdapter;
  let steeringManager: SteeringManager;
  let specManager: SpecManager;
  let contextManager: ContextManager;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    steeringManager = new SteeringManager(fs);
    specManager = new SpecManager(fs);
    contextManager = new ContextManager(fs, specManager, steeringManager);
  });

  describe('Steering File Creation and Loading', () => {
    /**
     * Tests that steering files can be created and loaded
     */
    it('should create and load steering files', async () => {
      const config: SteeringConfig = {
        inclusion: 'always',
        description: 'Test steering file'
      };
      
      await steeringManager.createSteeringFile('test-steering', config, '# Test Content\n\nThis is test content.');
      
      const files = await steeringManager.loadSteeringFiles();
      
      expect(files.length).toBe(1);
      expect(files[0].name).toBe('test-steering');
      expect(files[0].content).toContain('Test Content');
      expect(files[0].config.inclusion).toBe('always');
    });

    /**
     * Tests that multiple steering files can be loaded
     */
    it('should load multiple steering files', async () => {
      await steeringManager.createSteeringFile('steering-one', { inclusion: 'always' }, 'Content one');
      await steeringManager.createSteeringFile('steering-two', { inclusion: 'manual' }, 'Content two');
      await steeringManager.createSteeringFile('steering-three', { 
        inclusion: 'fileMatch', 
        fileMatchPattern: '**/*.ts' 
      }, 'Content three');
      
      const files = await steeringManager.loadSteeringFiles();
      
      expect(files.length).toBe(3);
      expect(files.map(f => f.name).sort()).toEqual(['steering-one', 'steering-three', 'steering-two']);
    });

    /**
     * Tests that steering files can be updated
     */
    it('should update steering file content', async () => {
      await steeringManager.createSteeringFile('updatable', { inclusion: 'always' }, 'Original content');
      
      await steeringManager.updateSteeringFile('updatable', 'Updated content');
      
      const files = await steeringManager.loadSteeringFiles();
      expect(files[0].content).toBe('Updated content');
      // Config should be preserved
      expect(files[0].config.inclusion).toBe('always');
    });
  });

  describe('Inclusion Mode: Always', () => {
    /**
     * Tests that 'always' inclusion mode includes content regardless of context
     * 
     * **Validates: Requirements 3.2**
     */
    it('should include always-mode steering in all contexts', async () => {
      await steeringManager.createSteeringFile('always-steering', { 
        inclusion: 'always' 
      }, '# Always Included\n\nThis content is always included.');
      
      // Test with empty context
      let content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: []
      });
      expect(content).toContain('Always Included');
      
      // Test with some files in context
      content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/test.js'],
        manualInclusions: []
      });
      expect(content).toContain('Always Included');
    });

    /**
     * Tests that steering without front-matter defaults to 'always'
     */
    it('should default to always inclusion when no front-matter', async () => {
      // Write file directly without front-matter
      await fs.writeFile('.kiro/steering/no-frontmatter.md', '# No Front Matter\n\nJust content.');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: []
      });
      
      expect(content).toContain('No Front Matter');
    });

    /**
     * Tests that multiple always-mode files are all included
     */
    it('should include all always-mode steering files', async () => {
      await steeringManager.createSteeringFile('always-one', { inclusion: 'always' }, 'Content One');
      await steeringManager.createSteeringFile('always-two', { inclusion: 'always' }, 'Content Two');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: []
      });
      
      expect(content).toContain('Content One');
      expect(content).toContain('Content Two');
    });
  });

  describe('Inclusion Mode: FileMatch', () => {
    /**
     * Tests that fileMatch inclusion only includes when pattern matches
     * 
     * **Validates: Requirements 3.3**
     */
    it('should include fileMatch steering when pattern matches', async () => {
      await steeringManager.createSteeringFile('ts-steering', {
        inclusion: 'fileMatch',
        fileMatchPattern: '**/*.ts'
      }, '# TypeScript Guidelines\n\nUse strict mode.');
      
      // Should include when .ts file is active
      let content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/index.ts'],
        manualInclusions: []
      });
      expect(content).toContain('TypeScript Guidelines');
      
      // Should not include when no .ts files
      content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/index.js'],
        manualInclusions: []
      });
      expect(content).not.toContain('TypeScript Guidelines');
    });

    /**
     * Tests various glob patterns for fileMatch
     */
    it('should support various glob patterns', async () => {
      await steeringManager.createSteeringFile('test-steering', {
        inclusion: 'fileMatch',
        fileMatchPattern: '**/*.test.ts'
      }, 'Test file guidelines');
      
      // Should match test files
      let content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/utils.test.ts'],
        manualInclusions: []
      });
      expect(content).toContain('Test file guidelines');
      
      // Should not match non-test files
      content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/utils.ts'],
        manualInclusions: []
      });
      expect(content).not.toContain('Test file guidelines');
    });

    /**
     * Tests that fileMatch works with multiple active files
     */
    it('should include when any active file matches pattern', async () => {
      await steeringManager.createSteeringFile('react-steering', {
        inclusion: 'fileMatch',
        fileMatchPattern: '**/*.tsx'
      }, 'React component guidelines');
      
      // Should include when at least one file matches
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/utils.ts', 'src/App.tsx', 'package.json'],
        manualInclusions: []
      });
      expect(content).toContain('React component guidelines');
    });

    /**
     * Tests that fileMatch without pattern doesn't include
     */
    it('should not include fileMatch steering without pattern', async () => {
      await steeringManager.createSteeringFile('no-pattern', {
        inclusion: 'fileMatch'
        // No fileMatchPattern
      }, 'Should not appear');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/anything.ts'],
        manualInclusions: []
      });
      expect(content).not.toContain('Should not appear');
    });
  });

  describe('Inclusion Mode: Manual', () => {
    /**
     * Tests that manual inclusion only includes when explicitly referenced
     * 
     * **Validates: Requirements 3.4**
     */
    it('should include manual steering only when explicitly referenced', async () => {
      await steeringManager.createSteeringFile('manual-steering', {
        inclusion: 'manual'
      }, '# Manual Content\n\nOnly when requested.');
      
      // Should not include without manual reference
      let content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/test.ts'],
        manualInclusions: []
      });
      expect(content).not.toContain('Manual Content');
      
      // Should include when manually referenced
      content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/test.ts'],
        manualInclusions: ['manual-steering']
      });
      expect(content).toContain('Manual Content');
    });

    /**
     * Tests that multiple manual inclusions work
     */
    it('should include multiple manually referenced steering files', async () => {
      await steeringManager.createSteeringFile('manual-one', { inclusion: 'manual' }, 'Manual One');
      await steeringManager.createSteeringFile('manual-two', { inclusion: 'manual' }, 'Manual Two');
      await steeringManager.createSteeringFile('manual-three', { inclusion: 'manual' }, 'Manual Three');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: ['manual-one', 'manual-three']
      });
      
      expect(content).toContain('Manual One');
      expect(content).not.toContain('Manual Two');
      expect(content).toContain('Manual Three');
    });
  });

  describe('File Reference Resolution', () => {
    /**
     * Tests that file references are resolved in steering content
     * 
     * **Validates: Requirements 3.5**
     */
    it('should resolve file references in steering content', async () => {
      // Create a referenced file
      await fs.writeFile('tsconfig.json', '{"compilerOptions": {"strict": true}}');
      
      await steeringManager.createSteeringFile('with-reference', {
        inclusion: 'always'
      }, '# Config Reference\n\nSee config: #[[file:tsconfig.json]]');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: []
      });
      
      expect(content).toContain('compilerOptions');
      expect(content).toContain('strict');
      expect(content).not.toContain('#[[file:');
    });

    /**
     * Tests that multiple file references are resolved
     */
    it('should resolve multiple file references', async () => {
      await fs.writeFile('file1.txt', 'Content of file 1');
      await fs.writeFile('file2.txt', 'Content of file 2');
      
      await steeringManager.createSteeringFile('multi-ref', {
        inclusion: 'always'
      }, 'First: #[[file:file1.txt]]\n\nSecond: #[[file:file2.txt]]');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: []
      });
      
      expect(content).toContain('Content of file 1');
      expect(content).toContain('Content of file 2');
    });

    /**
     * Tests that missing file references are handled gracefully
     */
    it('should handle missing file references gracefully', async () => {
      await steeringManager.createSteeringFile('missing-ref', {
        inclusion: 'always'
      }, 'Reference: #[[file:nonexistent.txt]]');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: []
      });
      
      expect(content).toContain('File not found');
      expect(content).toContain('nonexistent.txt');
    });

    /**
     * Tests that file references work with nested paths
     */
    it('should resolve file references with nested paths', async () => {
      await fs.writeFile('src/config/settings.json', '{"debug": true}');
      
      await steeringManager.createSteeringFile('nested-ref', {
        inclusion: 'always'
      }, 'Settings: #[[file:src/config/settings.json]]');
      
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: [],
        manualInclusions: []
      });
      
      expect(content).toContain('debug');
      expect(content).toContain('true');
    });
  });

  describe('Context Manager Integration', () => {
    /**
     * Tests that steering content is included in agent context
     */
    it('should include steering content in agent context', async () => {
      await steeringManager.createSteeringFile('context-steering', {
        inclusion: 'always'
      }, '# Steering for Context\n\nImportant guidelines.');
      
      const context = await contextManager.buildContext({
        message: 'Test message'
      });
      
      expect(context.steeringContent).toContain('Steering for Context');
      expect(context.steeringContent).toContain('Important guidelines');
    });

    /**
     * Tests that fileMatch steering is included based on explicit files
     */
    it('should include fileMatch steering based on explicit files', async () => {
      await steeringManager.createSteeringFile('ts-context', {
        inclusion: 'fileMatch',
        fileMatchPattern: '**/*.ts'
      }, 'TypeScript context steering');
      
      // Create a file to reference
      await fs.writeFile('src/test.ts', 'const x = 1;');
      
      const context = await contextManager.buildContext({
        message: 'Test message',
        explicitFiles: ['src/test.ts']
      });
      
      expect(context.steeringContent).toContain('TypeScript context steering');
    });

    /**
     * Tests that manual steering is included via context request
     */
    it('should include manual steering via context request', async () => {
      await steeringManager.createSteeringFile('manual-context', {
        inclusion: 'manual'
      }, 'Manual context steering');
      
      const context = await contextManager.buildContext({
        message: 'Test message',
        manualSteering: ['manual-context']
      });
      
      expect(context.steeringContent).toContain('Manual context steering');
    });

    /**
     * Tests that spec files trigger fileMatch steering
     */
    it('should include fileMatch steering based on spec files', async () => {
      await steeringManager.createSteeringFile('spec-steering', {
        inclusion: 'fileMatch',
        fileMatchPattern: '**/*.md'
      }, 'Markdown file steering');
      
      // Create a spec
      await specManager.createSpec('test-spec');
      
      const context = await contextManager.buildContext({
        message: 'Test message',
        spec: 'test-spec'
      });
      
      // Spec files are .md files, so should trigger the steering
      expect(context.steeringContent).toContain('Markdown file steering');
    });
  });

  describe('Front-Matter Parsing', () => {
    /**
     * Tests that YAML front-matter is correctly parsed
     */
    it('should parse YAML front-matter correctly', async () => {
      const content = `---
inclusion: fileMatch
fileMatchPattern: "**/*.tsx"
description: React component guidelines
---

# React Guidelines

Use functional components.`;
      
      await fs.writeFile('.kiro/steering/react.md', content);
      
      const files = await steeringManager.loadSteeringFiles();
      
      expect(files.length).toBe(1);
      expect(files[0].config.inclusion).toBe('fileMatch');
      expect(files[0].config.fileMatchPattern).toBe('**/*.tsx');
      expect(files[0].config.description).toBe('React component guidelines');
      expect(files[0].content).toContain('React Guidelines');
      expect(files[0].content).not.toContain('---');
    });

    /**
     * Tests that invalid front-matter defaults to 'always'
     */
    it('should default to always when front-matter is invalid', async () => {
      const content = `---
invalid: yaml: content
---

# Content`;
      
      await fs.writeFile('.kiro/steering/invalid.md', content);
      
      const files = await steeringManager.loadSteeringFiles();
      
      expect(files.length).toBe(1);
      expect(files[0].config.inclusion).toBe('always');
    });
  });

  describe('Mixed Inclusion Modes', () => {
    /**
     * Tests that different inclusion modes work together correctly
     */
    it('should correctly combine different inclusion modes', async () => {
      // Create steering files with different modes
      await steeringManager.createSteeringFile('always-file', { inclusion: 'always' }, 'Always content');
      await steeringManager.createSteeringFile('ts-file', { 
        inclusion: 'fileMatch', 
        fileMatchPattern: '**/*.ts' 
      }, 'TypeScript content');
      await steeringManager.createSteeringFile('manual-file', { inclusion: 'manual' }, 'Manual content');
      
      // Test with TypeScript file and manual inclusion
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/index.ts'],
        manualInclusions: ['manual-file']
      });
      
      expect(content).toContain('Always content');
      expect(content).toContain('TypeScript content');
      expect(content).toContain('Manual content');
    });

    /**
     * Tests selective inclusion based on context
     */
    it('should selectively include based on context', async () => {
      await steeringManager.createSteeringFile('always-file', { inclusion: 'always' }, 'Always');
      await steeringManager.createSteeringFile('ts-file', { 
        inclusion: 'fileMatch', 
        fileMatchPattern: '**/*.ts' 
      }, 'TypeScript');
      await steeringManager.createSteeringFile('js-file', { 
        inclusion: 'fileMatch', 
        fileMatchPattern: '**/*.js' 
      }, 'JavaScript');
      
      // Test with only JS file
      const content = await steeringManager.getActiveSteeringContent({
        activeFiles: ['src/index.js'],
        manualInclusions: []
      });
      
      expect(content).toContain('Always');
      expect(content).not.toContain('TypeScript');
      expect(content).toContain('JavaScript');
    });
  });
});
