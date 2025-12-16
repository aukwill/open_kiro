import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { InMemoryFileSystemAdapter } from './filesystem-adapter.js';

describe('InMemoryFileSystemAdapter', () => {
  let adapter: InMemoryFileSystemAdapter;

  beforeEach(() => {
    adapter = new InMemoryFileSystemAdapter();
  });

  /**
   * **Feature: open-kiro, Property 3: Hook Persistence Round-Trip** (adapted for general file operations)
   * **Validates: Requirements 5.5**
   * 
   * *For any* valid file path and content, writing the content and then reading it
   * should produce the same content (round-trip property).
   */
  describe('Property 3: File Persistence Round-Trip', () => {
    it('should preserve content through write/read cycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate valid file paths (alphanumeric with slashes, 1-50 chars)
          fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_/'.split('')),
            { minLength: 1, maxLength: 50 }
          ).filter(s => 
            !s.startsWith('/') && 
            !s.endsWith('/') && 
            !s.includes('//') &&
            s.length > 0
          ),
          // Generate arbitrary string content
          fc.string({ minLength: 0, maxLength: 1000 }),
          async (filePath, content) => {
            // Write the content
            await adapter.writeFile(filePath, content);
            
            // Read it back
            const readContent = await adapter.readFile(filePath);
            
            // Should be identical
            expect(readContent).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve JSON content through write/read cycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate valid file paths ending in .json
          fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_/'.split('')),
            { minLength: 1, maxLength: 40 }
          ).filter(s => 
            !s.startsWith('/') && 
            !s.endsWith('/') && 
            !s.includes('//') &&
            s.length > 0
          ).map(s => s + '.json'),
          // Generate arbitrary JSON-serializable objects
          fc.jsonValue(),
          async (filePath, jsonValue) => {
            const content = JSON.stringify(jsonValue);
            
            // Write the JSON content
            await adapter.writeFile(filePath, content);
            
            // Read it back
            const readContent = await adapter.readFile(filePath);
            
            // Parse and compare
            const parsedContent = JSON.parse(readContent);
            expect(parsedContent).toEqual(jsonValue);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('File existence', () => {
    it('should report file exists after write', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
            { minLength: 1, maxLength: 20 }
          ),
          fc.string({ minLength: 1, maxLength: 100 }),
          async (filePath, content) => {
            // Clear adapter state for each iteration
            adapter.clear();
            
            // File should not exist initially
            expect(await adapter.exists(filePath)).toBe(false);
            
            // Write file
            await adapter.writeFile(filePath, content);
            
            // File should exist now
            expect(await adapter.exists(filePath)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('File deletion', () => {
    it('should remove file after delete', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
            { minLength: 1, maxLength: 20 }
          ),
          fc.string({ minLength: 1, maxLength: 100 }),
          async (filePath, content) => {
            // Write file
            await adapter.writeFile(filePath, content);
            expect(await adapter.exists(filePath)).toBe(true);
            
            // Delete file
            await adapter.delete(filePath);
            
            // File should not exist
            expect(await adapter.exists(filePath)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Directory listing', () => {
    it('should list files in directory', async () => {
      // Create some files in a directory structure
      await adapter.writeFile('dir/file1.txt', 'content1');
      await adapter.writeFile('dir/file2.txt', 'content2');
      await adapter.writeFile('dir/subdir/file3.txt', 'content3');
      
      const entries = await adapter.readdir('dir');
      
      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
      expect(entries).toContain('subdir');
      expect(entries.length).toBe(3);
    });
  });

  describe('Watch notifications', () => {
    it('should notify on file changes', async () => {
      const events: Array<{ type: string; path: string }> = [];
      
      adapter.watch('test', (event) => {
        events.push(event);
      });
      
      await adapter.writeFile('test/file.txt', 'content');
      
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('create');
      expect(events[0].path).toBe('test/file.txt');
      
      await adapter.writeFile('test/file.txt', 'updated');
      
      expect(events.length).toBe(2);
      expect(events[1].type).toBe('change');
    });
  });

  describe('Error handling', () => {
    it('should throw when reading non-existent file', async () => {
      await expect(adapter.readFile('nonexistent.txt')).rejects.toThrow('ENOENT');
    });
  });
});
