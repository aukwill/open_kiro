import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import type { Disposable, WatchCallback, WatchEvent } from '../types/index.js';

/**
 * Interface for file system operations
 * Abstracts file system for testability and cross-platform support
 */
export interface IFileSystemAdapter {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
  readdir(dirPath: string): Promise<string[]>;
  watch(pattern: string, callback: WatchCallback): Disposable;
  delete(targetPath: string): Promise<void>;
}

/**
 * Node.js file system adapter implementation
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter {
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  private resolvePath(filePath: string): string {
    return path.resolve(this.basePath, filePath);
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }


  async exists(filePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    await fs.mkdir(fullPath, { recursive: true });
  }

  async readdir(dirPath: string): Promise<string[]> {
    const fullPath = this.resolvePath(dirPath);
    return fs.readdir(fullPath);
  }

  watch(pattern: string, callback: WatchCallback): Disposable {
    const fullPath = this.resolvePath(pattern);
    const watcher: FSWatcher = fsWatch(fullPath, { recursive: true }, (eventType, filename) => {
      if (filename) {
        const event: WatchEvent = {
          type: eventType === 'rename' ? 'create' : 'change',
          path: filename
        };
        callback(event);
      }
    });

    return {
      dispose: () => watcher.close()
    };
  }

  async delete(targetPath: string): Promise<void> {
    const fullPath = this.resolvePath(targetPath);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: true });
    } else {
      await fs.unlink(fullPath);
    }
  }
}

/**
 * In-memory file system adapter for testing
 */
export class InMemoryFileSystemAdapter implements IFileSystemAdapter {
  private files: Map<string, string> = new Map();
  private watchers: Map<string, WatchCallback[]> = new Map();

  async readFile(filePath: string): Promise<string> {
    const normalizedPath = this.normalizePath(filePath);
    const content = this.files.get(normalizedPath);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const normalizedPath = this.normalizePath(filePath);
    const isNew = !this.files.has(normalizedPath);
    this.files.set(normalizedPath, content);
    this.notifyWatchers(normalizedPath, isNew ? 'create' : 'change');
  }

  async exists(filePath: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(filePath);
    return this.files.has(normalizedPath) || this.hasDirectory(normalizedPath);
  }

  async mkdir(_dirPath: string): Promise<void> {
    // In-memory adapter doesn't need explicit directory creation
    // Directories are implicit based on file paths
  }

  async readdir(dirPath: string): Promise<string[]> {
    const normalizedDir = this.normalizePath(dirPath);
    const entries = new Set<string>();
    
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(normalizedDir + '/')) {
        const relativePath = filePath.slice(normalizedDir.length + 1);
        const firstSegment = relativePath.split('/')[0];
        entries.add(firstSegment);
      }
    }
    
    return Array.from(entries);
  }

  watch(pattern: string, callback: WatchCallback): Disposable {
    const normalizedPattern = this.normalizePath(pattern);
    const callbacks = this.watchers.get(normalizedPattern) || [];
    callbacks.push(callback);
    this.watchers.set(normalizedPattern, callbacks);

    return {
      dispose: () => {
        const cbs = this.watchers.get(normalizedPattern) || [];
        const index = cbs.indexOf(callback);
        if (index !== -1) {
          cbs.splice(index, 1);
        }
      }
    };
  }

  async delete(targetPath: string): Promise<void> {
    const normalizedPath = this.normalizePath(targetPath);
    
    // Delete exact file
    if (this.files.has(normalizedPath)) {
      this.files.delete(normalizedPath);
      this.notifyWatchers(normalizedPath, 'delete');
      return;
    }
    
    // Delete directory (all files with this prefix)
    const prefix = normalizedPath + '/';
    const toDelete: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        toDelete.push(filePath);
      }
    }
    
    for (const filePath of toDelete) {
      this.files.delete(filePath);
      this.notifyWatchers(filePath, 'delete');
    }
  }

  // Helper methods for testing
  clear(): void {
    this.files.clear();
    this.watchers.clear();
  }

  getFiles(): Map<string, string> {
    return new Map(this.files);
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private hasDirectory(dirPath: string): boolean {
    const prefix = dirPath + '/';
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  private notifyWatchers(filePath: string, eventType: WatchEvent['type']): void {
    for (const [pattern, callbacks] of this.watchers.entries()) {
      if (filePath.startsWith(pattern) || pattern === filePath) {
        const event: WatchEvent = { type: eventType, path: filePath };
        for (const callback of callbacks) {
          callback(event);
        }
      }
    }
  }
}
