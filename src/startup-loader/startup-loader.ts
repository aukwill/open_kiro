import type { ISpecManager } from '../spec-manager/spec-manager.js';
import type { IHookManager } from '../hook-manager/hook-manager.js';
import type { ISteeringManager } from '../steering-manager/steering-manager.js';
import type { SpecSummary, SteeringFile, HookConfig } from '../types/index.js';

/**
 * Result of startup configuration loading
 */
export interface StartupLoadResult {
  specs: SpecSummary[];
  hooks: HookConfig[];
  steeringFiles: SteeringFile[];
  errors: StartupLoadError[];
}

/**
 * Error that occurred during startup loading
 */
export interface StartupLoadError {
  type: 'specs' | 'hooks' | 'steering';
  message: string;
  error?: Error;
}

/**
 * Logger interface for startup operations
 */
export interface IStartupLogger {
  info(message: string): void;
  error(message: string, error?: Error): void;
}

/**
 * Default console logger for startup operations
 */
export class ConsoleStartupLogger implements IStartupLogger {
  info(message: string): void {
    console.info(`[StartupLoader] ${message}`);
  }
  error(message: string, error?: Error): void {
    console.error(`[StartupLoader] ${message}`, error?.message || '');
  }
}

/**
 * Interface for startup configuration loading
 */
export interface IStartupLoader {
  loadAll(): Promise<StartupLoadResult>;
  loadSpecs(): Promise<SpecSummary[]>;
  loadHooks(): Promise<HookConfig[]>;
  loadSteeringFiles(): Promise<SteeringFile[]>;
}


/**
 * StartupLoader implementation
 * Orchestrates loading all configurations (specs, hooks, steering) at startup
 */
export class StartupLoader implements IStartupLoader {
  private specManager: ISpecManager | null;
  private hookManager: IHookManager | null;
  private steeringManager: ISteeringManager | null;
  private logger: IStartupLogger;

  constructor(options: {
    specManager?: ISpecManager;
    hookManager?: IHookManager;
    steeringManager?: ISteeringManager;
    logger?: IStartupLogger;
  } = {}) {
    this.specManager = options.specManager || null;
    this.hookManager = options.hookManager || null;
    this.steeringManager = options.steeringManager || null;
    this.logger = options.logger || new ConsoleStartupLogger();
  }

  /**
   * Load all configurations at startup
   * Loads specs, hooks, and steering files in parallel
   * Collects errors but continues loading other configurations
   */
  async loadAll(): Promise<StartupLoadResult> {
    const errors: StartupLoadError[] = [];
    let specs: SpecSummary[] = [];
    let hooks: HookConfig[] = [];
    let steeringFiles: SteeringFile[] = [];

    this.logger.info('Starting configuration loading...');

    // Load all configurations in parallel
    const [specsResult, hooksResult, steeringResult] = await Promise.allSettled([
      this.loadSpecs(),
      this.loadHooks(),
      this.loadSteeringFiles()
    ]);

    // Process specs result
    if (specsResult.status === 'fulfilled') {
      specs = specsResult.value;
      this.logger.info(`Loaded ${specs.length} spec(s)`);
    } else {
      const error: StartupLoadError = {
        type: 'specs',
        message: specsResult.reason?.message || 'Failed to load specs',
        error: specsResult.reason
      };
      errors.push(error);
      this.logger.error('Failed to load specs', specsResult.reason);
    }

    // Process hooks result
    if (hooksResult.status === 'fulfilled') {
      hooks = hooksResult.value;
      this.logger.info(`Loaded ${hooks.length} hook(s)`);
    } else {
      const error: StartupLoadError = {
        type: 'hooks',
        message: hooksResult.reason?.message || 'Failed to load hooks',
        error: hooksResult.reason
      };
      errors.push(error);
      this.logger.error('Failed to load hooks', hooksResult.reason);
    }

    // Process steering result
    if (steeringResult.status === 'fulfilled') {
      steeringFiles = steeringResult.value;
      this.logger.info(`Loaded ${steeringFiles.length} steering file(s)`);
    } else {
      const error: StartupLoadError = {
        type: 'steering',
        message: steeringResult.reason?.message || 'Failed to load steering files',
        error: steeringResult.reason
      };
      errors.push(error);
      this.logger.error('Failed to load steering files', steeringResult.reason);
    }

    this.logger.info('Configuration loading complete');

    return {
      specs,
      hooks,
      steeringFiles,
      errors
    };
  }

  /**
   * Load all specs from .kiro/specs/
   */
  async loadSpecs(): Promise<SpecSummary[]> {
    if (!this.specManager) {
      return [];
    }

    return this.specManager.listSpecs();
  }

  /**
   * Load all hooks from .kiro/hooks/
   */
  async loadHooks(): Promise<HookConfig[]> {
    if (!this.hookManager) {
      return [];
    }

    await this.hookManager.loadHooks();
    return this.hookManager.listHooks();
  }

  /**
   * Load all steering files from .kiro/steering/
   */
  async loadSteeringFiles(): Promise<SteeringFile[]> {
    if (!this.steeringManager) {
      return [];
    }

    return this.steeringManager.loadSteeringFiles();
  }
}
