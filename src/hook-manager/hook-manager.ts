import type { HookConfig, HookResult, HookContext, HookAction, Disposable } from '../types/index.js';
import type { IFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Interface for managing hooks lifecycle
 */
export interface IHookManager {
  registerHook(hook: HookConfig): Promise<void>;
  removeHook(hookId: string): Promise<void>;
  listHooks(): Promise<HookConfig[]>;
  triggerHook(hookId: string, context?: HookContext): Promise<HookResult>;
  setHookEnabled(hookId: string, enabled: boolean): Promise<void>;
  loadHooks(): Promise<void>;
  triggerByEvent(eventType: HookEventType, context?: HookContext): Promise<void>;
}

/**
 * Event types that can trigger hooks
 */
export type HookEventType = 'file_save' | 'message_sent' | 'session_created' | 'agent_complete' | 'manual';

/**
 * Event handler function type
 */
export type HookEventHandler = (context: HookContext) => void;

/**
 * Message sender interface for send_message action
 */
export interface IMessageSender {
  sendMessage(message: string): Promise<void>;
}

/**
 * Logger interface for hook execution errors
 */
export interface IHookLogger {
  error(message: string, error?: Error): void;
  info(message: string): void;
}

/**
 * Default console logger
 */
export class ConsoleHookLogger implements IHookLogger {
  error(message: string, error?: Error): void {
    console.error(`[HookManager] ${message}`, error?.message || '');
  }
  info(message: string): void {
    console.info(`[HookManager] ${message}`);
  }
}


/**
 * HookManager implementation
 * Manages hook registration, event listening, and action execution
 */
export class HookManager implements IHookManager {
  private readonly hooksBasePath = '.kiro/hooks';
  private hooks: Map<string, HookConfig> = new Map();
  private eventListeners: Map<HookEventType, HookEventHandler[]> = new Map();
  private messageSender: IMessageSender | null = null;
  private logger: IHookLogger;

  constructor(
    private readonly fs: IFileSystemAdapter,
    logger?: IHookLogger
  ) {
    this.logger = logger || new ConsoleHookLogger();
  }

  /**
   * Set the message sender for send_message actions
   */
  setMessageSender(sender: IMessageSender): void {
    this.messageSender = sender;
  }

  /**
   * Get the path to a hook file
   */
  private getHookPath(hookId: string): string {
    return `${this.hooksBasePath}/${hookId}.json`;
  }

  /**
   * Validate hook configuration
   */
  private validateHook(hook: HookConfig): void {
    if (!hook.id || hook.id.trim().length === 0) {
      throw new Error('Hook ID cannot be empty');
    }
    if (!hook.name || hook.name.trim().length === 0) {
      throw new Error('Hook name cannot be empty');
    }
    if (!hook.trigger || !hook.trigger.type) {
      throw new Error('Hook trigger is required');
    }
    if (!hook.action || !hook.action.type) {
      throw new Error('Hook action is required');
    }
    
    // Validate action type
    if (hook.action.type === 'send_message' && !('message' in hook.action)) {
      throw new Error('send_message action requires a message');
    }
    if (hook.action.type === 'execute_command' && !('command' in hook.action)) {
      throw new Error('execute_command action requires a command');
    }
  }

  /**
   * Register a new hook
   * Saves hook configuration to .kiro/hooks/{hookId}.json
   */
  async registerHook(hook: HookConfig): Promise<void> {
    this.validateHook(hook);
    
    // Ensure hooks directory exists
    await this.fs.mkdir(this.hooksBasePath);
    
    // Save hook to file
    const hookPath = this.getHookPath(hook.id);
    await this.fs.writeFile(hookPath, JSON.stringify(hook, null, 2));
    
    // Add to in-memory cache
    this.hooks.set(hook.id, hook);
  }

  /**
   * Remove a hook by ID
   */
  async removeHook(hookId: string): Promise<void> {
    const hookPath = this.getHookPath(hookId);
    
    if (await this.fs.exists(hookPath)) {
      await this.fs.delete(hookPath);
    }
    
    this.hooks.delete(hookId);
  }

  /**
   * List all registered hooks
   */
  async listHooks(): Promise<HookConfig[]> {
    return Array.from(this.hooks.values());
  }

  /**
   * Load all hooks from .kiro/hooks/ directory
   */
  async loadHooks(): Promise<void> {
    this.hooks.clear();
    
    if (!await this.fs.exists(this.hooksBasePath)) {
      return;
    }

    const entries = await this.fs.readdir(this.hooksBasePath);
    
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        try {
          const hookPath = `${this.hooksBasePath}/${entry}`;
          const content = await this.fs.readFile(hookPath);
          const hook = JSON.parse(content) as HookConfig;
          this.hooks.set(hook.id, hook);
        } catch (error) {
          this.logger.error(`Failed to load hook from ${entry}`, error as Error);
        }
      }
    }
  }


  /**
   * Get a hook by ID
   */
  getHook(hookId: string): HookConfig | undefined {
    return this.hooks.get(hookId);
  }

  /**
   * Enable or disable a hook
   */
  async setHookEnabled(hookId: string, enabled: boolean): Promise<void> {
    const hook = this.hooks.get(hookId);
    if (!hook) {
      throw new Error(`Hook '${hookId}' not found`);
    }

    hook.enabled = enabled;
    
    // Update file
    const hookPath = this.getHookPath(hookId);
    await this.fs.writeFile(hookPath, JSON.stringify(hook, null, 2));
  }

  /**
   * Subscribe to hook events
   */
  on(eventType: HookEventType, handler: HookEventHandler): Disposable {
    const handlers = this.eventListeners.get(eventType) || [];
    handlers.push(handler);
    this.eventListeners.set(eventType, handlers);

    return {
      dispose: () => {
        const currentHandlers = this.eventListeners.get(eventType) || [];
        const index = currentHandlers.indexOf(handler);
        if (index !== -1) {
          currentHandlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit an event to trigger matching hooks
   */
  async emit(eventType: HookEventType, context: HookContext = {}): Promise<void> {
    // Find all enabled hooks with matching trigger
    const matchingHooks = Array.from(this.hooks.values()).filter(hook => 
      hook.enabled && hook.trigger.type === eventType
    );

    // Execute each matching hook
    for (const hook of matchingHooks) {
      // For file_save triggers, check pattern match
      if (hook.trigger.type === 'file_save' && hook.trigger.pattern && context.filePath) {
        if (!this.matchesPattern(context.filePath, hook.trigger.pattern)) {
          continue;
        }
      }

      try {
        const result = await this.executeHookAction(hook, context);
        // Log if action returned an error result
        if (!result.success && result.error) {
          this.logger.error(`Hook '${hook.id}' execution failed: ${result.error}`);
        }
      } catch (error) {
        // Log error but don't propagate - failure isolation
        this.logger.error(`Hook '${hook.id}' execution failed`, error as Error);
      }
    }

    // Notify event listeners
    const handlers = this.eventListeners.get(eventType) || [];
    for (const handler of handlers) {
      try {
        handler(context);
      } catch (error) {
        this.logger.error(`Event handler for '${eventType}' failed`, error as Error);
      }
    }
  }

  /**
   * Manually trigger a specific hook
   */
  async triggerHook(hookId: string, context: HookContext = {}): Promise<HookResult> {
    const hook = this.hooks.get(hookId);
    if (!hook) {
      return { success: false, error: `Hook '${hookId}' not found` };
    }

    if (!hook.enabled) {
      return { success: false, error: `Hook '${hookId}' is disabled` };
    }

    try {
      const result = await this.executeHookAction(hook, context);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Hook '${hookId}' execution failed`, error as Error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute a hook's action
   */
  private async executeHookAction(hook: HookConfig, context: HookContext): Promise<HookResult> {
    const action = hook.action;

    if (action.type === 'send_message') {
      return this.executeSendMessage(action.message, context);
    } else if (action.type === 'execute_command') {
      return this.executeCommand(action.command, action.cwd);
    }

    return { success: false, error: `Unknown action type: ${(action as HookAction).type}` };
  }

  /**
   * Execute send_message action
   */
  private async executeSendMessage(message: string, context: HookContext): Promise<HookResult> {
    if (!this.messageSender) {
      return { success: false, error: 'No message sender configured' };
    }

    try {
      // Interpolate context variables in message
      const interpolatedMessage = this.interpolateMessage(message, context);
      await this.messageSender.sendMessage(interpolatedMessage);
      return { success: true, output: interpolatedMessage };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute shell command action
   */
  private async executeCommand(command: string, cwd?: string): Promise<HookResult> {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd });
      return { 
        success: true, 
        output: stdout || stderr 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Interpolate context variables in message
   */
  private interpolateMessage(message: string, context: HookContext): string {
    let result = message;
    if (context.filePath) {
      result = result.replace(/\{filePath\}/g, context.filePath);
    }
    if (context.message) {
      result = result.replace(/\{message\}/g, context.message);
    }
    if (context.event) {
      result = result.replace(/\{event\}/g, context.event);
    }
    return result;
  }

  /**
   * Trigger hooks by event type (alias for emit)
   */
  async triggerByEvent(eventType: HookEventType, context: HookContext = {}): Promise<void> {
    await this.emit(eventType, context);
  }

  /**
   * Check if a file path matches a glob pattern
   * Simple implementation - supports * and ** wildcards
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Convert glob pattern to regex
    // First escape special regex chars except * 
    let regexPattern = pattern
      .replace(/\\/g, '/')
      .replace(/[.+^${}()|[\]]/g, '\\$&');
    
    // Replace ** with a placeholder, then * with [^/]*, then placeholder with .*
    regexPattern = regexPattern
      .replace(/\*\*/g, '\0')  // Placeholder for **
      .replace(/\*/g, '[^/]*') // Single * matches anything except /
      .replace(/\0/g, '.*');   // ** matches anything including /
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }
}
