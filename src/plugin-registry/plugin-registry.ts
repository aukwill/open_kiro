import type {
  Plugin,
  PluginContext,
  CustomHookTrigger,
  CustomSteeringMode,
  Command
} from '../types/index.js';

/**
 * Logger interface for plugin operations
 */
export interface IPluginLogger {
  error(message: string, error?: Error): void;
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Default console logger
 */
export class ConsolePluginLogger implements IPluginLogger {
  error(message: string, error?: Error): void {
    console.error(`[PluginRegistry] ${message}`, error?.message || '');
  }
  info(message: string): void {
    console.info(`[PluginRegistry] ${message}`);
  }
  warn(message: string): void {
    console.warn(`[PluginRegistry] ${message}`);
  }
}

/**
 * Interface for the plugin registry
 */
export interface IPluginRegistry {
  register(plugin: Plugin): Promise<void>;
  registerAll(plugins: Plugin[]): Promise<PluginRegistrationResult[]>;
  unregister(pluginId: string): Promise<void>;
  getPlugins(): Plugin[];
  getPlugin(pluginId: string): Plugin | undefined;
  getCustomHookTriggers(): CustomHookTrigger[];
  getCustomSteeringModes(): CustomSteeringMode[];
  getCommands(): Command[];
}

/**
 * PluginRegistry implementation
 * Manages plugin registration, lifecycle, and extension points
 */
export class PluginRegistry implements IPluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private activePlugins: Set<string> = new Set();
  private customHookTriggers: Map<string, CustomHookTrigger> = new Map();
  private customSteeringModes: Map<string, CustomSteeringMode> = new Map();
  private commands: Map<string, Command> = new Map();
  private pluginExtensions: Map<string, PluginExtensions> = new Map();
  private logger: IPluginLogger;
  private workspacePath: string;

  constructor(workspacePath: string, logger?: IPluginLogger) {
    this.workspacePath = workspacePath;
    this.logger = logger || new ConsolePluginLogger();
  }

  /**
   * Register and activate a plugin
   * Validates plugin, calls activate(), and registers extensions
   */
  async register(plugin: Plugin): Promise<void> {
    // Validate plugin
    this.validatePlugin(plugin);

    // Check for duplicate registration
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin '${plugin.id}' is already registered`);
    }

    // Store plugin
    this.plugins.set(plugin.id, plugin);

    // Create plugin context for activation
    const extensions: PluginExtensions = {
      hookTriggers: [],
      steeringModes: [],
      commands: []
    };

    const context = this.createPluginContext(plugin.id, extensions);

    try {
      // Activate plugin
      await plugin.activate(context);
      this.activePlugins.add(plugin.id);

      // Register any extensions defined on the plugin itself
      if (plugin.hookTriggers) {
        for (const trigger of plugin.hookTriggers) {
          this.registerHookTriggerInternal(plugin.id, trigger, extensions);
        }
      }
      if (plugin.steeringModes) {
        for (const mode of plugin.steeringModes) {
          this.registerSteeringModeInternal(plugin.id, mode, extensions);
        }
      }
      if (plugin.commands) {
        for (const command of plugin.commands) {
          this.registerCommandInternal(plugin.id, command, extensions);
        }
      }

      // Store extensions for cleanup
      this.pluginExtensions.set(plugin.id, extensions);

      this.logger.info(`Plugin '${plugin.name}' (${plugin.id}) v${plugin.version} activated`);
    } catch (error) {
      // Remove plugin on activation failure
      this.plugins.delete(plugin.id);
      this.logger.error(`Failed to activate plugin '${plugin.id}'`, error as Error);
      throw error;
    }
  }

  /**
   * Register multiple plugins with failure isolation
   * If one plugin fails to load, others will still be registered
   * Returns an array of results indicating success/failure for each plugin
   */
  async registerAll(plugins: Plugin[]): Promise<PluginRegistrationResult[]> {
    const results: PluginRegistrationResult[] = [];

    for (const plugin of plugins) {
      try {
        await this.register(plugin);
        results.push({
          pluginId: plugin.id,
          success: true
        });
      } catch (error) {
        // Log error but continue with other plugins
        this.logger.error(`Failed to register plugin '${plugin.id}'`, error as Error);
        results.push({
          pluginId: plugin.id,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  /**
   * Unregister and deactivate a plugin
   * Calls deactivate() and removes all extensions
   */
  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' is not registered`);
    }

    // Deactivate plugin if it was active
    if (this.activePlugins.has(pluginId)) {
      try {
        await plugin.deactivate();
      } catch (error) {
        this.logger.error(`Error during deactivation of plugin '${pluginId}'`, error as Error);
        // Continue with cleanup even if deactivate fails
      }
      // Always remove from active plugins, even if deactivate fails
      this.activePlugins.delete(pluginId);
    }

    // Remove all extensions registered by this plugin
    this.removePluginExtensions(pluginId);

    // Remove plugin
    this.plugins.delete(pluginId);
    this.pluginExtensions.delete(pluginId);

    this.logger.info(`Plugin '${pluginId}' unregistered`);
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Check if a plugin is active
   */
  isPluginActive(pluginId: string): boolean {
    return this.activePlugins.has(pluginId);
  }

  /**
   * Get all custom hook triggers from all plugins
   */
  getCustomHookTriggers(): CustomHookTrigger[] {
    return Array.from(this.customHookTriggers.values());
  }

  /**
   * Get a custom hook trigger by type
   */
  getCustomHookTrigger(type: string): CustomHookTrigger | undefined {
    return this.customHookTriggers.get(type);
  }

  /**
   * Get all custom steering modes from all plugins
   */
  getCustomSteeringModes(): CustomSteeringMode[] {
    return Array.from(this.customSteeringModes.values());
  }

  /**
   * Get a custom steering mode by name
   */
  getCustomSteeringMode(name: string): CustomSteeringMode | undefined {
    return this.customSteeringModes.get(name);
  }

  /**
   * Get all commands from all plugins
   */
  getCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get a command by ID
   */
  getCommand(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  /**
   * Validate plugin structure
   */
  private validatePlugin(plugin: Plugin): void {
    if (!plugin.id || typeof plugin.id !== 'string' || plugin.id.trim().length === 0) {
      throw new Error('Plugin ID is required and must be a non-empty string');
    }
    if (!plugin.name || typeof plugin.name !== 'string' || plugin.name.trim().length === 0) {
      throw new Error('Plugin name is required and must be a non-empty string');
    }
    if (!plugin.version || typeof plugin.version !== 'string') {
      throw new Error('Plugin version is required and must be a string');
    }
    if (typeof plugin.activate !== 'function') {
      throw new Error('Plugin must have an activate method');
    }
    if (typeof plugin.deactivate !== 'function') {
      throw new Error('Plugin must have a deactivate method');
    }
  }

  /**
   * Create a plugin context for activation
   */
  private createPluginContext(pluginId: string, extensions: PluginExtensions): PluginContext {
    return {
      workspacePath: this.workspacePath,
      registerHookTrigger: (trigger: CustomHookTrigger) => {
        this.registerHookTriggerInternal(pluginId, trigger, extensions);
      },
      registerSteeringMode: (mode: CustomSteeringMode) => {
        this.registerSteeringModeInternal(pluginId, mode, extensions);
      },
      registerCommand: (command: Command) => {
        this.registerCommandInternal(pluginId, command, extensions);
      }
    };
  }

  /**
   * Register a custom hook trigger
   */
  private registerHookTriggerInternal(
    _pluginId: string,
    trigger: CustomHookTrigger,
    extensions: PluginExtensions
  ): void {
    if (this.customHookTriggers.has(trigger.type)) {
      this.logger.warn(`Hook trigger type '${trigger.type}' already registered, skipping`);
      return;
    }
    this.customHookTriggers.set(trigger.type, trigger);
    extensions.hookTriggers.push(trigger.type);
  }

  /**
   * Register a custom steering mode
   */
  private registerSteeringModeInternal(
    _pluginId: string,
    mode: CustomSteeringMode,
    extensions: PluginExtensions
  ): void {
    if (this.customSteeringModes.has(mode.name)) {
      this.logger.warn(`Steering mode '${mode.name}' already registered, skipping`);
      return;
    }
    this.customSteeringModes.set(mode.name, mode);
    extensions.steeringModes.push(mode.name);
  }

  /**
   * Register a command
   */
  private registerCommandInternal(
    _pluginId: string,
    command: Command,
    extensions: PluginExtensions
  ): void {
    if (this.commands.has(command.id)) {
      this.logger.warn(`Command '${command.id}' already registered, skipping`);
      return;
    }
    this.commands.set(command.id, command);
    extensions.commands.push(command.id);
  }

  /**
   * Remove all extensions registered by a plugin
   */
  private removePluginExtensions(pluginId: string): void {
    const extensions = this.pluginExtensions.get(pluginId);
    if (!extensions) return;

    for (const type of extensions.hookTriggers) {
      this.customHookTriggers.delete(type);
    }
    for (const name of extensions.steeringModes) {
      this.customSteeringModes.delete(name);
    }
    for (const id of extensions.commands) {
      this.commands.delete(id);
    }
  }
}

/**
 * Tracks extensions registered by a plugin for cleanup
 */
interface PluginExtensions {
  hookTriggers: string[];
  steeringModes: string[];
  commands: string[];
}

/**
 * Result of a plugin registration attempt
 */
export interface PluginRegistrationResult {
  pluginId: string;
  success: boolean;
  error?: string;
}
