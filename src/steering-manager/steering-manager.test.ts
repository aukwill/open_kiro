import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { 
  SteeringManager, 
  parseFrontMatter, 
  serializeFrontMatter,
  matchesPattern 
} from './steering-manager.js';
import { InMemoryFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import type { SteeringConfig, SteeringContext } from '../types/index.js';

describe('SteeringManager', () => {
  let fs: InMemoryFileSystemAdapter;
  let steeringManager: SteeringManager;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    steeringManager = new SteeringManager(fs);
  });

  /**
   * **Feature: open-kiro, Property 7: Steering File Parsing Round-Trip**
   * **Validates: Requirements 3.1**
   * 
   * *For any* valid steering file with front-matter and content,
   * parsing and then serializing should produce equivalent content.
   */
  describe('Property 7: Steering File Parsing Round-Trip', () => {
    // Generator for valid inclusion modes
    const inclusionModeArb = fc.constantFrom('always', 'fileMatch', 'manual') as fc.Arbitrary<SteeringConfig['inclusion']>;

    // Generator for valid file match patterns
    const fileMatchPatternArb = fc.oneof(
      fc.constant('**/*.ts'),
      fc.constant('**/*.js'),
      fc.constant('src/**/*'),
      fc.constant('*.md'),
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz*/.'.split('')), { minLength: 1, maxLength: 20 })
    );

    // Generator for description strings
    const descriptionArb = fc.string({ minLength: 0, maxLength: 100 })
      .filter(s => !s.includes('---') && !s.includes('\n'));

    // Generator for markdown body content
    const bodyContentArb = fc.string({ minLength: 0, maxLength: 500 })
      .filter(s => !s.startsWith('---'));

    // Generator for valid steering configs
    const steeringConfigArb = fc.record({
      inclusion: inclusionModeArb,
      fileMatchPattern: fc.option(fileMatchPatternArb, { nil: undefined }),
      description: fc.option(descriptionArb, { nil: undefined })
    }).map(({ inclusion, fileMatchPattern, description }) => {
      const config: SteeringConfig = { inclusion };
      if (fileMatchPattern) config.fileMatchPattern = fileMatchPattern;
      if (description) config.description = description;
      return config;
    });


    it('should round-trip steering config through serialize/parse', async () => {
      await fc.assert(
        fc.asyncProperty(
          steeringConfigArb,
          bodyContentArb,
          async (config, body) => {
            // Serialize config and body to markdown
            const serialized = serializeFrontMatter(config, body);
            
            // Parse it back
            const { config: parsedConfig, body: parsedBody } = parseFrontMatter(serialized);

            // Verify config equivalence
            expect(parsedConfig.inclusion).toBe(config.inclusion);
            
            if (config.fileMatchPattern) {
              expect(parsedConfig.fileMatchPattern).toBe(config.fileMatchPattern);
            }
            
            if (config.description) {
              expect(parsedConfig.description).toBe(config.description);
            }

            // Verify body equivalence (trimmed comparison due to whitespace handling)
            expect(parsedBody.trim()).toBe(body.trim());
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should round-trip through file system operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 20 }),
          steeringConfigArb,
          bodyContentArb,
          async (name, config, body) => {
            fs.clear();

            // Create steering file
            await steeringManager.createSteeringFile(name, config, body);

            // Load steering files
            const files = await steeringManager.loadSteeringFiles();
            const loadedFile = files.find(f => f.name === name);

            expect(loadedFile).toBeDefined();
            expect(loadedFile!.config.inclusion).toBe(config.inclusion);
            
            if (config.fileMatchPattern) {
              expect(loadedFile!.config.fileMatchPattern).toBe(config.fileMatchPattern);
            }
            
            if (config.description) {
              expect(loadedFile!.config.description).toBe(config.description);
            }

            expect(loadedFile!.content.trim()).toBe(body.trim());
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should parse files without front-matter as always inclusion', () => {
      const content = '# My Steering File\n\nSome content here.';
      const { config, body } = parseFrontMatter(content);

      expect(config.inclusion).toBe('always');
      expect(body).toBe(content);
    });

    it('should handle malformed front-matter gracefully', () => {
      const content = '---\ninvalid: [yaml: content\n---\n\n# Content';
      const { config, body } = parseFrontMatter(content);

      // Should fall back to defaults
      expect(config.inclusion).toBe('always');
      expect(body).toBe('# Content');
    });

    it('should handle missing closing delimiter', () => {
      const content = '---\ninclusion: manual\n\n# Content without closing delimiter';
      const { config, body } = parseFrontMatter(content);

      // Should treat entire content as body
      expect(config.inclusion).toBe('always');
      expect(body).toBe(content);
    });
  });


  /**
   * **Feature: open-kiro, Property 8: Steering Inclusion - Always**
   * **Validates: Requirements 3.2**
   * 
   * *For any* steering file with `inclusion: always` (or no front-matter),
   * the steering content should be included in the agent context regardless
   * of which files are active.
   */
  describe('Property 8: Steering Inclusion - Always', () => {
    // Generator for random active files
    const activeFilesArb = fc.array(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz/.'.split('')), { minLength: 3, maxLength: 30 }),
      { minLength: 0, maxLength: 5 }
    );

    // Generator for random manual inclusions
    const manualInclusionsArb = fc.array(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 15 }),
      { minLength: 0, maxLength: 3 }
    );

    it('should always include steering files with inclusion: always', async () => {
      await fc.assert(
        fc.asyncProperty(
          activeFilesArb,
          manualInclusionsArb,
          async (activeFiles, manualInclusions) => {
            fs.clear();

            const steeringContent = '# Always Included\n\nThis content should always appear.';
            await steeringManager.createSteeringFile('always-steering', { inclusion: 'always' }, steeringContent);

            const context: SteeringContext = { activeFiles, manualInclusions };
            const result = await steeringManager.getActiveSteeringContent(context);

            expect(result).toContain('This content should always appear.');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include steering files without front-matter (default to always)', async () => {
      await fc.assert(
        fc.asyncProperty(
          activeFilesArb,
          manualInclusionsArb,
          async (activeFiles, manualInclusions) => {
            fs.clear();

            // Write file directly without front-matter
            const content = '# No Front Matter\n\nDefault inclusion content.';
            await fs.writeFile('.kiro/steering/no-frontmatter.md', content);

            const context: SteeringContext = { activeFiles, manualInclusions };
            const result = await steeringManager.getActiveSteeringContent(context);

            expect(result).toContain('Default inclusion content.');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: open-kiro, Property 9: Steering Inclusion - FileMatch**
   * **Validates: Requirements 3.3**
   * 
   * *For any* steering file with `inclusion: fileMatch` and a pattern,
   * the steering content should be included if and only if at least one
   * active file matches the pattern.
   */
  describe('Property 9: Steering Inclusion - FileMatch', () => {
    it('should include fileMatch steering when active file matches pattern', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('ts', 'js', 'tsx', 'jsx'),
          async (extension) => {
            fs.clear();

            const pattern = `**/*.${extension}`;
            await steeringManager.createSteeringFile(
              'typescript-rules',
              { inclusion: 'fileMatch', fileMatchPattern: pattern },
              `# ${extension.toUpperCase()} Rules\n\nRules for ${extension} files.`
            );

            // Context with matching file
            const context: SteeringContext = {
              activeFiles: [`src/components/Button.${extension}`],
              manualInclusions: []
            };

            const result = await steeringManager.getActiveSteeringContent(context);
            expect(result).toContain(`Rules for ${extension} files.`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT include fileMatch steering when no active file matches', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('ts', 'js', 'py', 'rb'),
          async (extension) => {
            fs.clear();

            await steeringManager.createSteeringFile(
              'typescript-only',
              { inclusion: 'fileMatch', fileMatchPattern: '**/*.ts' },
              '# TypeScript Only\n\nThis should only appear for .ts files.'
            );

            // Context with non-matching file
            const context: SteeringContext = {
              activeFiles: extension === 'ts' ? [] : [`src/file.${extension}`],
              manualInclusions: []
            };

            const result = await steeringManager.getActiveSteeringContent(context);
            
            if (extension === 'ts') {
              // Empty active files - should not include
              expect(result).not.toContain('This should only appear for .ts files.');
            } else {
              // Non-matching extension - should not include
              expect(result).not.toContain('This should only appear for .ts files.');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include when at least one of multiple active files matches', async () => {
      fs.clear();

      await steeringManager.createSteeringFile(
        'js-rules',
        { inclusion: 'fileMatch', fileMatchPattern: '**/*.js' },
        '# JS Rules\n\nJavaScript specific rules.'
      );

      const context: SteeringContext = {
        activeFiles: ['src/utils.ts', 'src/helper.js', 'README.md'],
        manualInclusions: []
      };

      const result = await steeringManager.getActiveSteeringContent(context);
      expect(result).toContain('JavaScript specific rules.');
    });
  });


  /**
   * **Feature: open-kiro, Property 10: Steering Inclusion - Manual**
   * **Validates: Requirements 3.4**
   * 
   * *For any* steering file with `inclusion: manual`, the steering content
   * should be included if and only if the user explicitly references it.
   */
  describe('Property 10: Steering Inclusion - Manual', () => {
    // Generator for steering file names
    const steeringNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      { minLength: 1, maxLength: 15 }
    );

    it('should include manual steering only when explicitly referenced', async () => {
      await fc.assert(
        fc.asyncProperty(
          steeringNameArb,
          async (name) => {
            fs.clear();

            await steeringManager.createSteeringFile(
              name,
              { inclusion: 'manual' },
              `# Manual Content\n\nContent for ${name}.`
            );

            // Context WITH manual inclusion
            const contextWithInclusion: SteeringContext = {
              activeFiles: ['src/app.ts'],
              manualInclusions: [name]
            };

            const resultIncluded = await steeringManager.getActiveSteeringContent(contextWithInclusion);
            expect(resultIncluded).toContain(`Content for ${name}.`);

            // Context WITHOUT manual inclusion
            const contextWithoutInclusion: SteeringContext = {
              activeFiles: ['src/app.ts'],
              manualInclusions: []
            };

            const resultExcluded = await steeringManager.getActiveSteeringContent(contextWithoutInclusion);
            expect(resultExcluded).not.toContain(`Content for ${name}.`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not include manual steering when different file is referenced', async () => {
      fs.clear();

      await steeringManager.createSteeringFile(
        'manual-one',
        { inclusion: 'manual' },
        '# Manual One\n\nContent for manual-one.'
      );

      await steeringManager.createSteeringFile(
        'manual-two',
        { inclusion: 'manual' },
        '# Manual Two\n\nContent for manual-two.'
      );

      const context: SteeringContext = {
        activeFiles: [],
        manualInclusions: ['manual-one']
      };

      const result = await steeringManager.getActiveSteeringContent(context);
      expect(result).toContain('Content for manual-one.');
      expect(result).not.toContain('Content for manual-two.');
    });
  });

  /**
   * **Feature: open-kiro, Property 11: Steering Reference Resolution**
   * **Validates: Requirements 3.5**
   * 
   * *For any* steering content containing `#[[file:<path>]]` references,
   * resolving the content should replace each reference with the actual
   * file content at that path.
   */
  describe('Property 11: Steering Reference Resolution', () => {
    // Generator for file paths
    const filePathArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz/.-_'.split('')),
      { minLength: 3, maxLength: 30 }
    ).filter(s => !s.startsWith('/') && !s.endsWith('/') && !s.includes('//'));

    // Generator for file content
    const fileContentArb = fc.string({ minLength: 1, maxLength: 200 })
      .filter(s => !s.includes('#[[file:'));

    it('should resolve file references with actual content', async () => {
      await fc.assert(
        fc.asyncProperty(
          filePathArb,
          fileContentArb,
          async (filePath, fileContent) => {
            fs.clear();

            // Create the referenced file
            await fs.writeFile(filePath, fileContent);

            // Create steering content with reference
            const steeringContent = `# Steering\n\nReference: #[[file:${filePath}]]`;

            const resolved = await steeringManager.resolveReferences(steeringContent);

            expect(resolved).toContain(fileContent);
            expect(resolved).not.toContain(`#[[file:${filePath}]]`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle multiple file references', async () => {
      fs.clear();

      await fs.writeFile('config/settings.json', '{"debug": true}');
      await fs.writeFile('docs/api.md', '# API Documentation');

      const content = `# Steering

Settings: #[[file:config/settings.json]]

API Docs: #[[file:docs/api.md]]`;

      const resolved = await steeringManager.resolveReferences(content);

      expect(resolved).toContain('{"debug": true}');
      expect(resolved).toContain('# API Documentation');
      expect(resolved).not.toContain('#[[file:');
    });

    it('should handle missing file references gracefully', async () => {
      fs.clear();

      const content = '# Steering\n\nMissing: #[[file:nonexistent/file.txt]]';

      const resolved = await steeringManager.resolveReferences(content);

      expect(resolved).toContain('[File not found: nonexistent/file.txt]');
      expect(resolved).not.toContain('#[[file:');
    });

    it('should return content unchanged when no references exist', async () => {
      const content = '# Steering\n\nNo references here.';

      const resolved = await steeringManager.resolveReferences(content);

      expect(resolved).toBe(content);
    });
  });


  describe('Pattern Matching', () => {
    it('should match glob patterns correctly', () => {
      // Basic extension matching
      expect(matchesPattern('src/file.ts', '**/*.ts')).toBe(true);
      expect(matchesPattern('src/file.js', '**/*.ts')).toBe(false);

      // Directory matching
      expect(matchesPattern('src/components/Button.tsx', 'src/**/*')).toBe(true);
      expect(matchesPattern('lib/utils.ts', 'src/**/*')).toBe(false);

      // Simple wildcard
      expect(matchesPattern('README.md', '*.md')).toBe(true);
      expect(matchesPattern('docs/guide.md', '*.md')).toBe(true); // matchBase: true

      // Nested paths
      expect(matchesPattern('a/b/c/d.ts', '**/*.ts')).toBe(true);
    });
  });

  describe('Steering File Management', () => {
    it('should create steering file with config', async () => {
      fs.clear();

      await steeringManager.createSteeringFile(
        'test-steering',
        { inclusion: 'fileMatch', fileMatchPattern: '**/*.ts', description: 'Test' },
        '# Test Content'
      );

      const files = await steeringManager.loadSteeringFiles();
      expect(files.length).toBe(1);
      expect(files[0].name).toBe('test-steering');
      expect(files[0].config.inclusion).toBe('fileMatch');
      expect(files[0].config.fileMatchPattern).toBe('**/*.ts');
    });

    it('should reject invalid steering file names', async () => {
      fs.clear();

      await expect(
        steeringManager.createSteeringFile('Invalid Name', { inclusion: 'always' })
      ).rejects.toThrow('Invalid steering file name');

      await expect(
        steeringManager.createSteeringFile('123-invalid', { inclusion: 'always' })
      ).rejects.toThrow('Invalid steering file name');
    });

    it('should reject duplicate steering file creation', async () => {
      fs.clear();

      await steeringManager.createSteeringFile('test', { inclusion: 'always' });

      await expect(
        steeringManager.createSteeringFile('test', { inclusion: 'always' })
      ).rejects.toThrow("Steering file 'test' already exists");
    });

    it('should update steering file content preserving config', async () => {
      fs.clear();

      await steeringManager.createSteeringFile(
        'updatable',
        { inclusion: 'fileMatch', fileMatchPattern: '**/*.ts' },
        '# Original Content'
      );

      await steeringManager.updateSteeringFile('updatable', '# Updated Content');

      const files = await steeringManager.loadSteeringFiles();
      const file = files.find(f => f.name === 'updatable');

      expect(file?.content).toBe('# Updated Content');
      expect(file?.config.inclusion).toBe('fileMatch');
      expect(file?.config.fileMatchPattern).toBe('**/*.ts');
    });

    it('should throw when updating non-existent file', async () => {
      fs.clear();

      await expect(
        steeringManager.updateSteeringFile('nonexistent', '# Content')
      ).rejects.toThrow("Steering file 'nonexistent' not found");
    });

    it('should return empty array when steering directory does not exist', async () => {
      fs.clear();

      const files = await steeringManager.loadSteeringFiles();
      expect(files).toEqual([]);
    });

    it('should skip non-markdown files in steering directory', async () => {
      fs.clear();

      await fs.writeFile('.kiro/steering/valid.md', '# Valid');
      await fs.writeFile('.kiro/steering/invalid.txt', 'Not markdown');
      await fs.writeFile('.kiro/steering/config.json', '{}');

      const files = await steeringManager.loadSteeringFiles();
      expect(files.length).toBe(1);
      expect(files[0].name).toBe('valid');
    });
  });
});
