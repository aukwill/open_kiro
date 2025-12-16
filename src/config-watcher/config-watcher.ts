import type { IFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import type { Disposable, WatchEvent } from '../types/index.js';
import type { ISpecManager } from '../spec-manager/spec-manager.js';
import type { IHookManager } from '../hook-manager/hook-manager.js';
import type { ISteeringManager } from '../steering-manager/steering-manager.js';

/**
 * Configuration change event types
 */
export type ConfigChangeType = 'specs' | 'hooks' | 'steering';

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  type: ConfigChangeType;
  event: WatchEvent;
}

/**
 * Configuration change handler
 */
export type ConfigChangeHandler = (event: ConfigChangeEvent) => void;

/**
 * Interface for configuration hot reload
 */
export interface IConfigWatcher {
  start(): void;
  stop(): void;
  onConfigChange(handler: ConfigChangeHandler): Disposable;
  isWatching(): boolean;
}

/**
 * Configuration paths to watch
 */
const CONFIG_PATHS = {
  specs: '.kiro/specs',
  hooks: '.kiro/hooks',
  steering: '.kiro/steering'
} as const;

/**
 * Default debounce delay in milliseconds
 */
const DEFAULT_DEBOUNCE_MS = 100;

/**
 * ConfigWatcher implementation
 * Watches .kiro/specs/, .kiro/hooks/, and .kiro/steering/ directories
 * for changes and notifies handlers with debouncing
 */
export class ConfigWatcher implements IConfigWatcher {
  private fs: IFileSystemAdapter;
  private debounceMs: number;
  private watchers: Disposable[] = [];
  private handlers: ConfigChangeHandler[] = [];
  private watching = false;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(fs: IFileSystemAdapter, debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.fs = fs;
    this.debounceMs = debounceMs;
  }

  /**
   * Start watching configuration directories
   */
  start(): void {
    if (this.watching) {
      return;
    }

    this.watching = true;

    // Set up watchers for each config directory
    for (const [type, path] of Object.entries(CONFIG_PATHS)) {
      const watcher = this.fs.watch(path, (event) => {
        this.handleChange(type as ConfigChangeType, event);
      });
      this.watchers.push(watcher);
    }
  }

  /**
   * Stop watching configuration directories
   */
  stop(): void {
    if (!this.watching) {
      return;
    }

    this.watching = false;

    // Dispose all watchers
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Register a handler for configuration changes
   */
  onConfigChange(handler: ConfigChangeHandler): Disposable {
    this.handlers.push(handler);

    return {
      dispose: () => {
        const index = this.handlers.indexOf(handler);
        if (index !== -1) {
          this.handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Check if the watcher is currently active
   */
  isWatching(): boolean {
    return this.watching;
  }

  /**
   * Handle a file change event with debouncing
   */
  private handleChange(type: ConfigChangeType, event: WatchEvent): void {
    // Create a unique key for debouncing based on type and path
    const debounceKey = `${type}:${event.path}`;

    // Clear existing timer for this key
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);
      this.notifyHandlers({ type, event });
    }, this.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Notify all registered handlers of a configuration change
   */
  private notifyHandlers(event: ConfigChangeEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors to prevent one handler from breaking others
      }
    }
  }
}


/**
 * Interface for configuration reloader
 */
export interface IConfigReloader {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  reloadSpecs(): Promise<void>;
  reloadHooks(): Promise<void>;
  reloadSteering(): Promise<void>;
  reloadAll(): Promise<void>;
}

/**
 * Logger interface for reload operations
 */
export interface IReloadLogger {
  info(message: string): void;
  error(message: string, error?: Error): void;
}

/**
 * Default console logger for reload operations
 */
export class ConsoleReloadLogger implements IReloadLogger {
  info(message: string): void {
    console.info(`[ConfigReloader] ${message}`);
  }
  error(message: string, error?: Error): void {
    console.error(`[ConfigReloader] ${message}`, error?.message || '');
  }
}

/**
 * ConfigReloader implementation
 * Integrates ConfigWatcher with managers to reload configurations on change
 */
export class ConfigReloader implements IConfigReloader {
  private watcher: ConfigWatcher;
  private specManager: ISpecManager | null;
  private hookManager: IHookManager | null;
  private steeringManager: ISteeringManager | null;
  private logger: IReloadLogger;
  private watcherDisposable: Disposable | null = null;
  private running = false;

  constructor(
    fs: IFileSystemAdapter,
    options: {
      specManager?: ISpecManager;
      hookManager?: IHookManager;
      steeringManager?: ISteeringManager;
      logger?: IReloadLogger;
      debounceMs?: number;
    } = {}
  ) {
    this.watcher = new ConfigWatcher(fs, options.debounceMs);
    this.specManager = options.specManager || null;
    this.hookManager = options.hookManager || null;
    this.steeringManager = options.steeringManager || null;
    this.logger = options.logger || new ConsoleReloadLogger();
  }

  /**
   * Start watching for configuration changes and auto-reload
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.watcherDisposable = this.watcher.onConfigChange(async (event) => {
      await this.handleConfigChange(event);
    });
    this.watcher.start();
    this.logger.info('Configuration hot reload started');
  }

  /**
   * Stop watching for configuration changes
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.watcher.stop();
    if (this.watcherDisposable) {
      this.watcherDisposable.dispose();
      this.watcherDisposable = null;
    }
    this.logger.info('Configuration hot reload stopped');
  }

  /**
   * Check if the reloader is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Handle a configuration change event
   */
  private async handleConfigChange(event: ConfigChangeEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'specs':
          await this.reloadSpecs();
          break;
        case 'hooks':
          await this.reloadHooks();
          break;
        case 'steering':
          await this.reloadSteering();
          break;
      }
    } catch (error) {
      this.logger.error(`Failed to reload ${event.type}`, error as Error);
    }
  }

  /**
   * Reload all specs from disk
   */
  async reloadSpecs(): Promise<void> {
    if (!this.specManager) {
      return;
    }

    try {
      // SpecManager loads specs on-demand via loadSpec/listSpecs
      // We just need to ensure the next access gets fresh data
      // For now, we trigger a listSpecs to refresh the cache
      await this.specManager.listSpecs();
      this.logger.info('Specs reloaded');
    } catch (error) {
      this.logger.error('Failed to reload specs', error as Error);
      throw error;
    }
  }

  /**
   * Reload all hooks from disk
   */
  async reloadHooks(): Promise<void> {
    if (!this.hookManager) {
      return;
    }

    try {
      await this.hookManager.loadHooks();
      this.logger.info('Hooks reloaded');
    } catch (error) {
      this.logger.error('Failed to reload hooks', error as Error);
      throw error;
    }
  }

  /**
   * Reload all steering files from disk
   */
  async reloadSteering(): Promise<void> {
    if (!this.steeringManager) {
      return;
    }

    try {
      // SteeringManager loads files on-demand via loadSteeringFiles
      // We trigger a load to refresh
      await this.steeringManager.loadSteeringFiles();
      this.logger.info('Steering files reloaded');
    } catch (error) {
      this.logger.error('Failed to reload steering files', error as Error);
      throw error;
    }
  }

  /**
   * Reload all configurations
   */
  async reloadAll(): Promise<void> {
    await Promise.all([
      this.reloadSpecs(),
      this.reloadHooks(),
      this.reloadSteering()
    ]);
  }
}
