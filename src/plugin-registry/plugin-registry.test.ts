import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { PluginRegistry, type IPluginLogger } from './plugin-registry.js';
import type { Plugin, PluginContext, CustomHookTrigger, CustomSteeringMode, Command } from '../types/index.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  let mockLogger: IPluginLogger;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };
    registry = new PluginRegistry('/workspace', mockLogger);
  });

  // Generators for property-based testing
  const pluginIdArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 30 }
  ).filter(s => /^[a-z][a-z0-9-]*$/.test(s));

  const pluginNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0);

  const versionArb = fc.tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 })
  ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

  /**
   * Creates a valid plugin for testing
   */
  function createTestPlugin(overrides: Partial<Plugin> = {}): Plugin {
    return {
      id: overrides.id || 'test-plugin',
      name: overrides.name || 'Test Plugin',
      version: overrides.version || '1.0.0',
      activate: overrides.activate || (async () => {}),
      deactivate: overrides.deactivate || (async () => {}),
      ...overrides
    };
  }

  describe('Plugin Registration', () => {
    it('should register a valid plugin', async () => {
      const plugin = createTestPlugin();
      await registry.register(plugin);

      const plugins = registry.getPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0].id).toBe('test-plugin');
    });

    it('should reject plugin with empty ID', async () => {
      const plugin = createTestPlugin({ id: '' });
      await expect(registry.register(plugin)).rejects.toThrow('Plugin ID is required');
    });


    it('should reject plugin with empty name', async () => {
      const plugin = createTestPlugin({ name: '' });
      await expect(registry.register(plugin)).rejects.toThrow('Plugin name is required');
    });

    it('should reject plugin without version', async () => {
      const plugin = createTestPlugin({ version: '' });
      await expect(registry.register(plugin)).rejects.toThrow('Plugin version is required');
    });

    it('should reject plugin without activate method', async () => {
      const plugin = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        deactivate: async () => {}
      } as unknown as Plugin;
      await expect(registry.register(plugin)).rejects.toThrow('Plugin must have an activate method');
    });

    it('should reject plugin without deactivate method', async () => {
      const plugin = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        activate: async () => {}
      } as unknown as Plugin;
      await expect(registry.register(plugin)).rejects.toThrow('Plugin must have a deactivate method');
    });

    it('should reject duplicate plugin registration', async () => {
      const plugin = createTestPlugin();
      await registry.register(plugin);
      await expect(registry.register(plugin)).rejects.toThrow("Plugin 'test-plugin' is already registered");
    });

    it('should call activate on registration', async () => {
      const activateFn = vi.fn();
      const plugin = createTestPlugin({ activate: activateFn });
      
      await registry.register(plugin);
      
      expect(activateFn).toHaveBeenCalledTimes(1);
    });

    it('should provide plugin context to activate', async () => {
      let receivedContext: PluginContext | undefined;
      const plugin = createTestPlugin({
        activate: async (ctx) => { receivedContext = ctx; }
      });
      
      await registry.register(plugin);
      
      expect(receivedContext).toBeDefined();
      expect(receivedContext!.workspacePath).toBe('/workspace');
      expect(typeof receivedContext!.registerHookTrigger).toBe('function');
      expect(typeof receivedContext!.registerSteeringMode).toBe('function');
      expect(typeof receivedContext!.registerCommand).toBe('function');
    });

    it('should remove plugin if activation fails', async () => {
      const plugin = createTestPlugin({
        activate: async () => { throw new Error('Activation failed'); }
      });
      
      await expect(registry.register(plugin)).rejects.toThrow('Activation failed');
      expect(registry.getPlugin('test-plugin')).toBeUndefined();
    });
  });

  describe('Plugin Unregistration', () => {
    it('should unregister a plugin', async () => {
      const plugin = createTestPlugin();
      await registry.register(plugin);
      
      await registry.unregister('test-plugin');
      
      expect(registry.getPlugin('test-plugin')).toBeUndefined();
      expect(registry.getPlugins().length).toBe(0);
    });

    it('should call deactivate on unregistration', async () => {
      const deactivateFn = vi.fn();
      const plugin = createTestPlugin({ deactivate: deactivateFn });
      
      await registry.register(plugin);
      await registry.unregister('test-plugin');
      
      expect(deactivateFn).toHaveBeenCalledTimes(1);
    });

    it('should throw when unregistering non-existent plugin', async () => {
      await expect(registry.unregister('non-existent'))
        .rejects.toThrow("Plugin 'non-existent' is not registered");
    });

    it('should continue cleanup even if deactivate fails', async () => {
      const plugin = createTestPlugin({
        deactivate: async () => { throw new Error('Deactivate failed'); }
      });
      
      await registry.register(plugin);
      await registry.unregister('test-plugin');
      
      // Plugin should still be removed
      expect(registry.getPlugin('test-plugin')).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Plugin Retrieval', () => {
    it('should get plugin by ID', async () => {
      const plugin = createTestPlugin();
      await registry.register(plugin);
      
      const retrieved = registry.getPlugin('test-plugin');
      expect(retrieved?.id).toBe('test-plugin');
    });

    it('should return undefined for non-existent plugin', () => {
      expect(registry.getPlugin('non-existent')).toBeUndefined();
    });

    it('should list all plugins', async () => {
      const plugin1 = createTestPlugin({ id: 'plugin-1', name: 'Plugin 1' });
      const plugin2 = createTestPlugin({ id: 'plugin-2', name: 'Plugin 2' });
      
      await registry.register(plugin1);
      await registry.register(plugin2);
      
      const plugins = registry.getPlugins();
      expect(plugins.length).toBe(2);
      expect(plugins.map(p => p.id)).toContain('plugin-1');
      expect(plugins.map(p => p.id)).toContain('plugin-2');
    });

    it('should check if plugin is active', async () => {
      const plugin = createTestPlugin();
      
      expect(registry.isPluginActive('test-plugin')).toBe(false);
      
      await registry.register(plugin);
      expect(registry.isPluginActive('test-plugin')).toBe(true);
      
      await registry.unregister('test-plugin');
      expect(registry.isPluginActive('test-plugin')).toBe(false);
    });
  });

  /**
   * **Feature: open-kiro, Property 20: Plugin Lifecycle**
   * **Validates: Requirements 7.1, 7.5**
   * 
   * *For any* registered plugin, the plugin's `activate` method should be called
   * at startup, and `deactivate` should be called on unregistration.
   */
  describe('Property 20: Plugin Lifecycle', () => {
    it('should call activate on registration and deactivate on unregistration for any valid plugin', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          pluginNameArb,
          versionArb,
          async (id, name, version) => {
            const newRegistry = new PluginRegistry('/workspace', mockLogger);
            
            let activateCalled = false;
            let deactivateCalled = false;
            let activateContext: PluginContext | undefined;
            
            const plugin: Plugin = {
              id,
              name,
              version,
              activate: async (ctx) => {
                activateCalled = true;
                activateContext = ctx;
              },
              deactivate: async () => {
                deactivateCalled = true;
              }
            };
            
            // Register should call activate
            await newRegistry.register(plugin);
            expect(activateCalled).toBe(true);
            expect(activateContext!.workspacePath).toBe('/workspace');
            expect(newRegistry.isPluginActive(id)).toBe(true);
            
            // Unregister should call deactivate
            await newRegistry.unregister(id);
            expect(deactivateCalled).toBe(true);
            expect(newRegistry.isPluginActive(id)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain correct active state through lifecycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(pluginIdArb, { minLength: 1, maxLength: 5 })
            .filter(ids => new Set(ids).size === ids.length), // unique IDs
          async (pluginIds) => {
            const newRegistry = new PluginRegistry('/workspace', mockLogger);
            
            // Register all plugins
            for (const id of pluginIds) {
              const plugin = createTestPlugin({ id, name: `Plugin ${id}` });
              await newRegistry.register(plugin);
              expect(newRegistry.isPluginActive(id)).toBe(true);
            }
            
            expect(newRegistry.getPlugins().length).toBe(pluginIds.length);
            
            // Unregister all plugins
            for (const id of pluginIds) {
              await newRegistry.unregister(id);
              expect(newRegistry.isPluginActive(id)).toBe(false);
            }
            
            expect(newRegistry.getPlugins().length).toBe(0);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Plugin Extension Points', () => {
    it('should allow plugins to register custom hook triggers', async () => {
      const customTrigger: CustomHookTrigger = {
        type: 'custom-trigger',
        description: 'A custom trigger',
        handler: (_callback) => {
          return { dispose: () => {} };
        }
      };

      const plugin = createTestPlugin({
        activate: async (ctx) => {
          ctx.registerHookTrigger(customTrigger);
        }
      });

      await registry.register(plugin);

      const triggers = registry.getCustomHookTriggers();
      expect(triggers.length).toBe(1);
      expect(triggers[0].type).toBe('custom-trigger');
    });

    it('should allow plugins to register custom steering modes', async () => {
      const customMode: CustomSteeringMode = {
        name: 'custom-mode',
        description: 'A custom steering mode',
        shouldInclude: () => true
      };

      const plugin = createTestPlugin({
        activate: async (ctx) => {
          ctx.registerSteeringMode(customMode);
        }
      });

      await registry.register(plugin);

      const modes = registry.getCustomSteeringModes();
      expect(modes.length).toBe(1);
      expect(modes[0].name).toBe('custom-mode');
    });

    it('should allow plugins to register commands', async () => {
      const command: Command = {
        id: 'custom-command',
        name: 'Custom Command',
        handler: async () => {}
      };

      const plugin = createTestPlugin({
        activate: async (ctx) => {
          ctx.registerCommand(command);
        }
      });

      await registry.register(plugin);

      const commands = registry.getCommands();
      expect(commands.length).toBe(1);
      expect(commands[0].id).toBe('custom-command');
    });

    it('should register extensions defined on plugin object', async () => {
      const plugin = createTestPlugin({
        hookTriggers: [{
          type: 'plugin-trigger',
          description: 'Trigger from plugin',
          handler: () => ({ dispose: () => {} })
        }],
        steeringModes: [{
          name: 'plugin-mode',
          description: 'Mode from plugin',
          shouldInclude: () => false
        }],
        commands: [{
          id: 'plugin-command',
          name: 'Command from plugin',
          handler: async () => {}
        }]
      });

      await registry.register(plugin);

      expect(registry.getCustomHookTriggers().length).toBe(1);
      expect(registry.getCustomSteeringModes().length).toBe(1);
      expect(registry.getCommands().length).toBe(1);
    });

    it('should remove extensions when plugin is unregistered', async () => {
      const plugin = createTestPlugin({
        activate: async (ctx) => {
          ctx.registerHookTrigger({
            type: 'temp-trigger',
            description: 'Temporary',
            handler: () => ({ dispose: () => {} })
          });
          ctx.registerSteeringMode({
            name: 'temp-mode',
            description: 'Temporary',
            shouldInclude: () => true
          });
          ctx.registerCommand({
            id: 'temp-command',
            name: 'Temporary',
            handler: async () => {}
          });
        }
      });

      await registry.register(plugin);
      expect(registry.getCustomHookTriggers().length).toBe(1);
      expect(registry.getCustomSteeringModes().length).toBe(1);
      expect(registry.getCommands().length).toBe(1);

      await registry.unregister('test-plugin');
      expect(registry.getCustomHookTriggers().length).toBe(0);
      expect(registry.getCustomSteeringModes().length).toBe(0);
      expect(registry.getCommands().length).toBe(0);
    });

    it('should skip duplicate hook trigger types with warning', async () => {
      const plugin1 = createTestPlugin({
        id: 'plugin-1',
        activate: async (ctx) => {
          ctx.registerHookTrigger({
            type: 'shared-trigger',
            description: 'First',
            handler: () => ({ dispose: () => {} })
          });
        }
      });

      const plugin2 = createTestPlugin({
        id: 'plugin-2',
        activate: async (ctx) => {
          ctx.registerHookTrigger({
            type: 'shared-trigger',
            description: 'Second',
            handler: () => ({ dispose: () => {} })
          });
        }
      });

      await registry.register(plugin1);
      await registry.register(plugin2);

      const triggers = registry.getCustomHookTriggers();
      expect(triggers.length).toBe(1);
      expect(triggers[0].description).toBe('First');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should get custom hook trigger by type', async () => {
      const plugin = createTestPlugin({
        activate: async (ctx) => {
          ctx.registerHookTrigger({
            type: 'findable-trigger',
            description: 'Can be found',
            handler: () => ({ dispose: () => {} })
          });
        }
      });

      await registry.register(plugin);

      const trigger = registry.getCustomHookTrigger('findable-trigger');
      expect(trigger).toBeDefined();
      expect(trigger?.description).toBe('Can be found');

      expect(registry.getCustomHookTrigger('non-existent')).toBeUndefined();
    });

    it('should get custom steering mode by name', async () => {
      const plugin = createTestPlugin({
        activate: async (ctx) => {
          ctx.registerSteeringMode({
            name: 'findable-mode',
            description: 'Can be found',
            shouldInclude: () => true
          });
        }
      });

      await registry.register(plugin);

      const mode = registry.getCustomSteeringMode('findable-mode');
      expect(mode).toBeDefined();
      expect(mode?.description).toBe('Can be found');

      expect(registry.getCustomSteeringMode('non-existent')).toBeUndefined();
    });

    it('should get command by ID', async () => {
      const plugin = createTestPlugin({
        activate: async (ctx) => {
          ctx.registerCommand({
            id: 'findable-command',
            name: 'Findable Command',
            handler: async () => {}
          });
        }
      });

      await registry.register(plugin);

      const command = registry.getCommand('findable-command');
      expect(command).toBeDefined();
      expect(command?.name).toBe('Findable Command');

      expect(registry.getCommand('non-existent')).toBeUndefined();
    });
  });

  /**
   * **Feature: open-kiro, Property 21: Plugin Extension Registration**
   * **Validates: Requirements 7.2, 7.3**
   * 
   * *For any* plugin that defines custom hook triggers or steering modes,
   * those extensions should be available for use after the plugin is activated.
   */
  describe('Property 21: Plugin Extension Registration', () => {
    const triggerTypeArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 20 }
    ).filter(s => /^[a-z][a-z0-9-]*$/.test(s));

    const steeringModeNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 20 }
    ).filter(s => /^[a-z][a-z0-9-]*$/.test(s));

    const commandIdArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 20 }
    ).filter(s => /^[a-z][a-z0-9-]*$/.test(s));

    it('should make custom hook triggers available after plugin activation', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          fc.array(triggerTypeArb, { minLength: 1, maxLength: 3 })
            .filter(types => new Set(types).size === types.length), // unique types
          async (pluginId, triggerTypes) => {
            const newRegistry = new PluginRegistry('/workspace', mockLogger);

            const hookTriggers: CustomHookTrigger[] = triggerTypes.map(type => ({
              type,
              description: `Trigger ${type}`,
              handler: () => ({ dispose: () => {} })
            }));

            const plugin = createTestPlugin({
              id: pluginId,
              hookTriggers
            });

            await newRegistry.register(plugin);

            // All triggers should be available
            for (const trigger of hookTriggers) {
              const found = newRegistry.getCustomHookTrigger(trigger.type);
              expect(found).toBeDefined();
              expect(found?.type).toBe(trigger.type);
              expect(found?.description).toBe(trigger.description);
            }

            expect(newRegistry.getCustomHookTriggers().length).toBe(triggerTypes.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should make custom steering modes available after plugin activation', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          fc.array(steeringModeNameArb, { minLength: 1, maxLength: 3 })
            .filter(names => new Set(names).size === names.length), // unique names
          async (pluginId, modeNames) => {
            const newRegistry = new PluginRegistry('/workspace', mockLogger);

            const steeringModes: CustomSteeringMode[] = modeNames.map(name => ({
              name,
              description: `Mode ${name}`,
              shouldInclude: () => true
            }));

            const plugin = createTestPlugin({
              id: pluginId,
              steeringModes
            });

            await newRegistry.register(plugin);

            // All modes should be available
            for (const mode of steeringModes) {
              const found = newRegistry.getCustomSteeringMode(mode.name);
              expect(found).toBeDefined();
              expect(found?.name).toBe(mode.name);
              expect(found?.description).toBe(mode.description);
            }

            expect(newRegistry.getCustomSteeringModes().length).toBe(modeNames.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should make extensions registered via context available', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          triggerTypeArb,
          steeringModeNameArb,
          commandIdArb,
          async (pluginId, triggerType, modeName, commandId) => {
            const newRegistry = new PluginRegistry('/workspace', mockLogger);

            const plugin = createTestPlugin({
              id: pluginId,
              activate: async (ctx) => {
                ctx.registerHookTrigger({
                  type: triggerType,
                  description: 'Dynamic trigger',
                  handler: () => ({ dispose: () => {} })
                });
                ctx.registerSteeringMode({
                  name: modeName,
                  description: 'Dynamic mode',
                  shouldInclude: () => false
                });
                ctx.registerCommand({
                  id: commandId,
                  name: 'Dynamic command',
                  handler: async () => {}
                });
              }
            });

            await newRegistry.register(plugin);

            // All extensions should be available
            expect(newRegistry.getCustomHookTrigger(triggerType)).toBeDefined();
            expect(newRegistry.getCustomSteeringMode(modeName)).toBeDefined();
            expect(newRegistry.getCommand(commandId)).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove extensions when plugin is unregistered', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          triggerTypeArb,
          steeringModeNameArb,
          async (pluginId, triggerType, modeName) => {
            const newRegistry = new PluginRegistry('/workspace', mockLogger);

            const plugin = createTestPlugin({
              id: pluginId,
              hookTriggers: [{
                type: triggerType,
                description: 'Will be removed',
                handler: () => ({ dispose: () => {} })
              }],
              steeringModes: [{
                name: modeName,
                description: 'Will be removed',
                shouldInclude: () => true
              }]
            });

            await newRegistry.register(plugin);
            
            // Extensions should exist
            expect(newRegistry.getCustomHookTrigger(triggerType)).toBeDefined();
            expect(newRegistry.getCustomSteeringMode(modeName)).toBeDefined();

            await newRegistry.unregister(pluginId);

            // Extensions should be removed
            expect(newRegistry.getCustomHookTrigger(triggerType)).toBeUndefined();
            expect(newRegistry.getCustomSteeringMode(modeName)).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: open-kiro, Property 22: Plugin Failure Isolation**
   * **Validates: Requirements 7.4**
   * 
   * *For any* plugin that fails to load or activate, the system should log
   * the error and continue operating with all other functionality intact.
   */
  describe('Property 22: Plugin Failure Isolation', () => {
    it('should continue registering other plugins when one fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(pluginIdArb, { minLength: 2, maxLength: 5 })
            .filter(ids => new Set(ids).size === ids.length), // unique IDs
          fc.integer({ min: 0, max: 4 }), // index of failing plugin
          async (pluginIds, failIndex) => {
            const actualFailIndex = failIndex % pluginIds.length;
            const newRegistry = new PluginRegistry('/workspace', mockLogger);

            const plugins = pluginIds.map((id, index) => createTestPlugin({
              id,
              name: `Plugin ${id}`,
              activate: async () => {
                if (index === actualFailIndex) {
                  throw new Error(`Plugin ${id} failed to activate`);
                }
              }
            }));

            const results = await newRegistry.registerAll(plugins);

            // Should have results for all plugins
            expect(results.length).toBe(plugins.length);

            // The failing plugin should have failed
            const failedResult = results[actualFailIndex];
            expect(failedResult.success).toBe(false);
            expect(failedResult.error).toBeDefined();

            // All other plugins should have succeeded
            for (let i = 0; i < results.length; i++) {
              if (i !== actualFailIndex) {
                expect(results[i].success).toBe(true);
                expect(newRegistry.isPluginActive(pluginIds[i])).toBe(true);
              }
            }

            // The failing plugin should not be active
            expect(newRegistry.isPluginActive(pluginIds[actualFailIndex])).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should log errors for failed plugins without throwing', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          fc.string({ minLength: 1, maxLength: 50 }),
          async (pluginId, errorMessage) => {
            const newRegistry = new PluginRegistry('/workspace', mockLogger);

            const failingPlugin = createTestPlugin({
              id: pluginId,
              activate: async () => {
                throw new Error(errorMessage);
              }
            });

            const results = await newRegistry.registerAll([failingPlugin]);

            // Should not throw, should return failure result
            expect(results.length).toBe(1);
            expect(results[0].success).toBe(false);
            expect(results[0].error).toContain(errorMessage);

            // Error should be logged
            expect(mockLogger.error).toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should keep system functional after plugin failure', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          pluginIdArb,
          async (failingId, successId) => {
            // Ensure different IDs
            if (failingId === successId) return;

            const newRegistry = new PluginRegistry('/workspace', mockLogger);

            const failingPlugin = createTestPlugin({
              id: failingId,
              activate: async () => { throw new Error('Activation failed'); }
            });

            const successPlugin = createTestPlugin({
              id: successId,
              hookTriggers: [{
                type: `trigger-${successId}`,
                description: 'Test trigger',
                handler: () => ({ dispose: () => {} })
              }]
            });

            // Register both - failing first
            await newRegistry.registerAll([failingPlugin, successPlugin]);

            // System should still be functional
            expect(newRegistry.isPluginActive(successId)).toBe(true);
            expect(newRegistry.getCustomHookTrigger(`trigger-${successId}`)).toBeDefined();

            // Can still register new plugins
            const anotherPlugin = createTestPlugin({
              id: `another-${successId}`,
              name: 'Another Plugin'
            });
            await newRegistry.register(anotherPlugin);
            expect(newRegistry.isPluginActive(`another-${successId}`)).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle validation errors gracefully in registerAll', async () => {
      const newRegistry = new PluginRegistry('/workspace', mockLogger);

      const invalidPlugin = {
        id: '',  // Invalid - empty ID
        name: 'Invalid Plugin',
        version: '1.0.0',
        activate: async () => {},
        deactivate: async () => {}
      } as Plugin;

      const validPlugin = createTestPlugin({ id: 'valid-plugin' });

      const results = await newRegistry.registerAll([invalidPlugin, validPlugin]);

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true);
      expect(newRegistry.isPluginActive('valid-plugin')).toBe(true);
    });

    it('should isolate deactivation failures during unregister', async () => {
      await fc.assert(
        fc.asyncProperty(
          pluginIdArb,
          async (pluginId) => {
            // Create fresh logger for each iteration
            const testLogger: IPluginLogger = {
              error: vi.fn(),
              info: vi.fn(),
              warn: vi.fn()
            };
            const newRegistry = new PluginRegistry('/workspace', testLogger);

            const plugin = createTestPlugin({
              id: pluginId,
              deactivate: async () => {
                throw new Error('Deactivation failed');
              }
            });

            await newRegistry.register(plugin);
            expect(newRegistry.isPluginActive(pluginId)).toBe(true);

            // Unregister should not throw even if deactivate fails
            await newRegistry.unregister(pluginId);

            // Plugin should still be removed
            expect(newRegistry.isPluginActive(pluginId)).toBe(false);
            expect(newRegistry.getPlugin(pluginId)).toBeUndefined();

            // Error should be logged
            expect(testLogger.error).toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
