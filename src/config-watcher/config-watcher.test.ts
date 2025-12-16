import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ConfigWatcher, ConfigReloader, type ConfigChangeEvent, type ConfigChangeType, type IReloadLogger } from './config-watcher.js';
import { InMemoryFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import { SpecManager } from '../spec-manager/spec-manager.js';
import { HookManager } from '../hook-manager/hook-manager.js';
import { SteeringManager } from '../steering-manager/steering-manager.js';

describe('ConfigWatcher', () => {
  let fs: InMemoryFileSystemAdapter;
  let watcher: ConfigWatcher;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    // Use 0ms debounce for faster tests
    watcher = new ConfigWatcher(fs, 0);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  describe('start/stop', () => {
    it('should start watching', () => {
      expect(watcher.isWatching()).toBe(false);
      watcher.start();
      expect(watcher.isWatching()).toBe(true);
    });

    it('should stop watching', () => {
      watcher.start();
      expect(watcher.isWatching()).toBe(true);
      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should be idempotent for start', () => {
      watcher.start();
      watcher.start();
      expect(watcher.isWatching()).toBe(true);
    });

    it('should be idempotent for stop', () => {
      watcher.start();
      watcher.stop();
      watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe('onConfigChange', () => {
    it('should register handler and receive events', async () => {
      const events: ConfigChangeEvent[] = [];
      watcher.onConfigChange((event) => events.push(event));
      watcher.start();

      // Trigger a change in specs directory
      await fs.writeFile('.kiro/specs/test-spec/requirements.md', '# Test');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('specs');
    });

    it('should allow disposing handler', async () => {
      const events: ConfigChangeEvent[] = [];
      const disposable = watcher.onConfigChange((event) => events.push(event));
      watcher.start();

      // Dispose the handler
      disposable.dispose();

      // Trigger a change
      await fs.writeFile('.kiro/specs/test-spec/requirements.md', '# Test');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(events.length).toBe(0);
    });

    it('should notify multiple handlers', async () => {
      const events1: ConfigChangeEvent[] = [];
      const events2: ConfigChangeEvent[] = [];
      
      watcher.onConfigChange((event) => events1.push(event));
      watcher.onConfigChange((event) => events2.push(event));
      watcher.start();

      await fs.writeFile('.kiro/hooks/test-hook.json', '{}');

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(events1.length).toBeGreaterThan(0);
      expect(events2.length).toBeGreaterThan(0);
    });
  });

  describe('debouncing', () => {
    it('should debounce rapid changes', async () => {
      vi.useFakeTimers();
      const watcherWithDebounce = new ConfigWatcher(fs, 100);
      const events: ConfigChangeEvent[] = [];
      
      watcherWithDebounce.onConfigChange((event) => events.push(event));
      watcherWithDebounce.start();

      // Trigger multiple rapid changes to the same file
      await fs.writeFile('.kiro/specs/test/file.md', 'v1');
      await fs.writeFile('.kiro/specs/test/file.md', 'v2');
      await fs.writeFile('.kiro/specs/test/file.md', 'v3');

      // Before debounce completes
      expect(events.length).toBe(0);

      // After debounce
      vi.advanceTimersByTime(150);
      
      // Should only have one event due to debouncing
      expect(events.length).toBe(1);

      watcherWithDebounce.stop();
    });
  });

  describe('config type detection', () => {
    it('should detect specs changes', async () => {
      const events: ConfigChangeEvent[] = [];
      watcher.onConfigChange((event) => events.push(event));
      watcher.start();

      await fs.writeFile('.kiro/specs/my-feature/requirements.md', '# Req');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(events.some(e => e.type === 'specs')).toBe(true);
    });

    it('should detect hooks changes', async () => {
      const events: ConfigChangeEvent[] = [];
      watcher.onConfigChange((event) => events.push(event));
      watcher.start();

      await fs.writeFile('.kiro/hooks/my-hook.json', '{}');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(events.some(e => e.type === 'hooks')).toBe(true);
    });

    it('should detect steering changes', async () => {
      const events: ConfigChangeEvent[] = [];
      watcher.onConfigChange((event) => events.push(event));
      watcher.start();

      await fs.writeFile('.kiro/steering/my-steering.md', '# Steering');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(events.some(e => e.type === 'steering')).toBe(true);
    });
  });

  describe('handler error isolation', () => {
    it('should continue notifying other handlers if one throws', async () => {
      const events: ConfigChangeEvent[] = [];
      
      // First handler throws
      watcher.onConfigChange(() => {
        throw new Error('Handler error');
      });
      
      // Second handler should still receive events
      watcher.onConfigChange((event) => events.push(event));
      watcher.start();

      await fs.writeFile('.kiro/specs/test/file.md', 'content');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(events.length).toBeGreaterThan(0);
    });
  });
});

describe('Property: Configuration Hot Reload', () => {
  /**
   * **Feature: open-kiro, Property 16: Configuration Hot Reload**
   * **Validates: Requirements 5.4**
   * 
   * For any configuration file modified externally while the system is running,
   * the system should detect the change and reload the configuration within
   * a reasonable time window.
   */
  it('should detect configuration changes for any valid config type and path', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<ConfigChangeType>('specs', 'hooks', 'steering'),
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-z][a-z0-9-]*$/.test(s)),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (configType, fileName, content) => {
          const fs = new InMemoryFileSystemAdapter();
          const watcher = new ConfigWatcher(fs, 0);
          const events: ConfigChangeEvent[] = [];

          watcher.onConfigChange((event) => events.push(event));
          watcher.start();

          // Determine the path based on config type
          const basePaths: Record<ConfigChangeType, string> = {
            specs: '.kiro/specs',
            hooks: '.kiro/hooks',
            steering: '.kiro/steering'
          };
          const extension = configType === 'hooks' ? '.json' : '.md';
          const filePath = `${basePaths[configType]}/${fileName}${extension}`;

          // Write a file to trigger the change
          await fs.writeFile(filePath, content);

          // Wait for debounce
          await new Promise(resolve => setTimeout(resolve, 10));

          watcher.stop();

          // Verify that a change event was detected for the correct type
          const matchingEvents = events.filter(e => e.type === configType);
          return matchingEvents.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('ConfigReloader', () => {
  let fs: InMemoryFileSystemAdapter;
  let specManager: SpecManager;
  let hookManager: HookManager;
  let steeringManager: SteeringManager;
  let reloader: ConfigReloader;
  let mockLogger: IReloadLogger;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    specManager = new SpecManager(fs);
    hookManager = new HookManager(fs);
    steeringManager = new SteeringManager(fs);
    mockLogger = {
      info: vi.fn(),
      error: vi.fn()
    };
    reloader = new ConfigReloader(fs, {
      specManager,
      hookManager,
      steeringManager,
      logger: mockLogger,
      debounceMs: 0
    });
  });

  afterEach(() => {
    reloader.stop();
  });

  describe('start/stop', () => {
    it('should start the reloader', () => {
      expect(reloader.isRunning()).toBe(false);
      reloader.start();
      expect(reloader.isRunning()).toBe(true);
    });

    it('should stop the reloader', () => {
      reloader.start();
      expect(reloader.isRunning()).toBe(true);
      reloader.stop();
      expect(reloader.isRunning()).toBe(false);
    });

    it('should be idempotent for start', () => {
      reloader.start();
      reloader.start();
      expect(reloader.isRunning()).toBe(true);
    });

    it('should be idempotent for stop', () => {
      reloader.start();
      reloader.stop();
      reloader.stop();
      expect(reloader.isRunning()).toBe(false);
    });
  });

  describe('reloadSpecs', () => {
    it('should reload specs when called', async () => {
      // Create a spec first
      await specManager.createSpec('test-spec');
      
      // Reload should not throw
      await reloader.reloadSpecs();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Specs reloaded');
    });

    it('should handle missing spec manager gracefully', async () => {
      const reloaderNoSpec = new ConfigReloader(fs, {
        hookManager,
        steeringManager,
        logger: mockLogger,
        debounceMs: 0
      });

      // Should not throw
      await reloaderNoSpec.reloadSpecs();
    });
  });

  describe('reloadHooks', () => {
    it('should reload hooks when called', async () => {
      // Create a hook first
      await hookManager.registerHook({
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      });
      
      // Reload should not throw
      await reloader.reloadHooks();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Hooks reloaded');
    });

    it('should handle missing hook manager gracefully', async () => {
      const reloaderNoHook = new ConfigReloader(fs, {
        specManager,
        steeringManager,
        logger: mockLogger,
        debounceMs: 0
      });

      // Should not throw
      await reloaderNoHook.reloadHooks();
    });
  });

  describe('reloadSteering', () => {
    it('should reload steering files when called', async () => {
      // Create a steering file first
      await steeringManager.createSteeringFile('test-steering', { inclusion: 'always' }, '# Test');
      
      // Reload should not throw
      await reloader.reloadSteering();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Steering files reloaded');
    });

    it('should handle missing steering manager gracefully', async () => {
      const reloaderNoSteering = new ConfigReloader(fs, {
        specManager,
        hookManager,
        logger: mockLogger,
        debounceMs: 0
      });

      // Should not throw
      await reloaderNoSteering.reloadSteering();
    });
  });

  describe('reloadAll', () => {
    it('should reload all configurations', async () => {
      await reloader.reloadAll();
      
      expect(mockLogger.info).toHaveBeenCalledWith('Specs reloaded');
      expect(mockLogger.info).toHaveBeenCalledWith('Hooks reloaded');
      expect(mockLogger.info).toHaveBeenCalledWith('Steering files reloaded');
    });
  });

  describe('auto-reload on file changes', () => {
    it('should reload specs when spec files change', async () => {
      reloader.start();
      
      // Create a spec file
      await fs.writeFile('.kiro/specs/new-spec/requirements.md', '# Requirements');
      
      // Wait for debounce and reload
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockLogger.info).toHaveBeenCalledWith('Specs reloaded');
    });

    it('should reload hooks when hook files change', async () => {
      reloader.start();
      
      // Create a hook file
      await fs.writeFile('.kiro/hooks/new-hook.json', JSON.stringify({
        id: 'new-hook',
        name: 'New Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      }));
      
      // Wait for debounce and reload
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockLogger.info).toHaveBeenCalledWith('Hooks reloaded');
    });

    it('should reload steering when steering files change', async () => {
      reloader.start();
      
      // Create a steering file
      await fs.writeFile('.kiro/steering/new-steering.md', '# Steering');
      
      // Wait for debounce and reload
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockLogger.info).toHaveBeenCalledWith('Steering files reloaded');
    });
  });
});
