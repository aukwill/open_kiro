import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { StartupLoader } from './startup-loader.js';
import { SpecManager } from '../spec-manager/spec-manager.js';
import { HookManager } from '../hook-manager/hook-manager.js';
import { SteeringManager } from '../steering-manager/steering-manager.js';
import { InMemoryFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import type { HookConfig, SteeringConfig } from '../types/index.js';

/**
 * Silent logger for tests
 */
const silentLogger = {
  info: () => {},
  error: () => {}
};

describe('StartupLoader', () => {
  let fs: InMemoryFileSystemAdapter;
  let specManager: SpecManager;
  let hookManager: HookManager;
  let steeringManager: SteeringManager;
  let startupLoader: StartupLoader;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    specManager = new SpecManager(fs);
    hookManager = new HookManager(fs, silentLogger);
    steeringManager = new SteeringManager(fs);
    startupLoader = new StartupLoader({
      specManager,
      hookManager,
      steeringManager,
      logger: silentLogger
    });
  });

  /**
   * **Feature: open-kiro, Property 15: Configuration Loading at Startup**
   * **Validates: Requirements 5.1, 5.2, 5.3**
   * 
   * *For any* workspace with existing configurations (specs, hooks, steering files),
   * starting the system should load all configurations into memory.
   */
  describe('Property 15: Configuration Loading at Startup', () => {
    // Generator for valid spec names
    const validSpecNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 30 }
    ).filter(s => /^[a-z][a-z0-9-]*$/.test(s) && !s.includes('--'));

    // Generator for valid hook IDs
    const validHookIdArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 30 }
    ).filter(s => /^[a-z][a-z0-9-]*$/.test(s) && !s.includes('--'));

    // Generator for valid steering file names
    const validSteeringNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')),
      { minLength: 1, maxLength: 30 }
    ).filter(s => /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s) && !s.includes('--'));


    // Generator for hook configs
    const hookConfigArb = (id: string): fc.Arbitrary<HookConfig> => fc.record({
      id: fc.constant(id),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      trigger: fc.oneof(
        fc.constant({ type: 'manual' as const }),
        fc.constant({ type: 'message_sent' as const }),
        fc.constant({ type: 'session_created' as const }),
        fc.constant({ type: 'agent_complete' as const })
      ),
      action: fc.oneof(
        fc.record({
          type: fc.constant('send_message' as const),
          message: fc.string({ minLength: 1, maxLength: 100 })
        }),
        fc.record({
          type: fc.constant('execute_command' as const),
          command: fc.string({ minLength: 1, maxLength: 100 })
        })
      ),
      enabled: fc.boolean()
    });

    // Generator for steering configs
    const steeringConfigArb: fc.Arbitrary<SteeringConfig> = fc.oneof(
      fc.constant({ inclusion: 'always' as const }),
      fc.record({
        inclusion: fc.constant('fileMatch' as const),
        fileMatchPattern: fc.string({ minLength: 1, maxLength: 30 })
      }),
      fc.constant({ inclusion: 'manual' as const })
    );

    it('should load all specs at startup', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validSpecNameArb, { minLength: 0, maxLength: 5 })
            .filter(names => new Set(names).size === names.length), // unique names
          async (specNames) => {
            fs.clear();

            // Create specs
            for (const name of specNames) {
              await specManager.createSpec(name);
            }

            // Load all configurations at startup
            const result = await startupLoader.loadAll();

            // Verify all specs were loaded
            expect(result.specs.length).toBe(specNames.length);
            for (const name of specNames) {
              const found = result.specs.find(s => s.name === name);
              expect(found).toBeDefined();
            }
            expect(result.errors.filter(e => e.type === 'specs')).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should load all hooks at startup', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validHookIdArb, { minLength: 0, maxLength: 5 })
            .filter(ids => new Set(ids).size === ids.length) // unique IDs
            .chain(ids => fc.tuple(
              fc.constant(ids),
              fc.tuple(...ids.map(id => hookConfigArb(id)))
            )),
          async ([hookIds, hookConfigs]) => {
            fs.clear();

            // Register hooks
            for (const config of hookConfigs) {
              await hookManager.registerHook(config);
            }

            // Create a fresh startup loader to simulate startup
            const freshHookManager = new HookManager(fs, silentLogger);
            const freshLoader = new StartupLoader({
              hookManager: freshHookManager,
              logger: silentLogger
            });

            // Load all configurations at startup
            const result = await freshLoader.loadAll();

            // Verify all hooks were loaded
            expect(result.hooks.length).toBe(hookIds.length);
            for (const id of hookIds) {
              const found = result.hooks.find(h => h.id === id);
              expect(found).toBeDefined();
            }
            expect(result.errors.filter(e => e.type === 'hooks')).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should load all steering files at startup', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validSteeringNameArb, { minLength: 0, maxLength: 5 })
            .filter(names => new Set(names).size === names.length) // unique names
            .chain(names => fc.tuple(
              fc.constant(names),
              fc.tuple(...names.map(() => steeringConfigArb))
            )),
          async ([steeringNames, steeringConfigs]) => {
            fs.clear();

            // Create steering files
            for (let i = 0; i < steeringNames.length; i++) {
              await steeringManager.createSteeringFile(
                steeringNames[i],
                steeringConfigs[i],
                `# Steering content for ${steeringNames[i]}`
              );
            }

            // Load all configurations at startup
            const result = await startupLoader.loadAll();

            // Verify all steering files were loaded
            expect(result.steeringFiles.length).toBe(steeringNames.length);
            for (const name of steeringNames) {
              const found = result.steeringFiles.find(s => s.name === name);
              expect(found).toBeDefined();
            }
            expect(result.errors.filter(e => e.type === 'steering')).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });


    it('should load all configuration types together at startup', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate unique spec names
          fc.array(validSpecNameArb, { minLength: 0, maxLength: 3 })
            .filter(names => new Set(names).size === names.length),
          // Generate unique hook IDs
          fc.array(validHookIdArb, { minLength: 0, maxLength: 3 })
            .filter(ids => new Set(ids).size === ids.length),
          // Generate unique steering names
          fc.array(validSteeringNameArb, { minLength: 0, maxLength: 3 })
            .filter(names => new Set(names).size === names.length),
          async (specNames, hookIds, steeringNames) => {
            fs.clear();

            // Create specs
            for (const name of specNames) {
              await specManager.createSpec(name);
            }

            // Create hooks
            for (const id of hookIds) {
              await hookManager.registerHook({
                id,
                name: `Hook ${id}`,
                trigger: { type: 'manual' },
                action: { type: 'send_message', message: 'test' },
                enabled: true
              });
            }

            // Create steering files
            for (const name of steeringNames) {
              await steeringManager.createSteeringFile(
                name,
                { inclusion: 'always' },
                `# Content for ${name}`
              );
            }

            // Create fresh managers to simulate startup
            const freshHookManager = new HookManager(fs, silentLogger);
            const freshLoader = new StartupLoader({
              specManager,
              hookManager: freshHookManager,
              steeringManager,
              logger: silentLogger
            });

            // Load all configurations at startup
            const result = await freshLoader.loadAll();

            // Verify all configurations were loaded
            expect(result.specs.length).toBe(specNames.length);
            expect(result.hooks.length).toBe(hookIds.length);
            expect(result.steeringFiles.length).toBe(steeringNames.length);
            expect(result.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return empty arrays when no configurations exist', async () => {
      fs.clear();

      const result = await startupLoader.loadAll();

      expect(result.specs).toHaveLength(0);
      expect(result.hooks).toHaveLength(0);
      expect(result.steeringFiles).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should continue loading other configs when one type fails', async () => {
      fs.clear();

      // Create a valid spec
      await specManager.createSpec('valid-spec');

      // Create a valid steering file
      await steeringManager.createSteeringFile('valid-steering', { inclusion: 'always' }, '# Content');

      // Create an invalid hook file (malformed JSON)
      await fs.writeFile('.kiro/hooks/invalid-hook.json', 'not valid json');

      // Create fresh hook manager to simulate startup
      const freshHookManager = new HookManager(fs, silentLogger);
      const freshLoader = new StartupLoader({
        specManager,
        hookManager: freshHookManager,
        steeringManager,
        logger: silentLogger
      });

      const result = await freshLoader.loadAll();

      // Specs and steering should still be loaded
      expect(result.specs.length).toBe(1);
      expect(result.steeringFiles.length).toBe(1);
      // Hooks should be empty (the invalid one was skipped during loadHooks)
      // Note: HookManager.loadHooks() catches individual file errors
      expect(result.hooks.length).toBe(0);
    });
  });

  describe('Individual load methods', () => {
    it('should return empty array when manager is not provided', async () => {
      const loaderWithoutManagers = new StartupLoader({ logger: silentLogger });

      const specs = await loaderWithoutManagers.loadSpecs();
      const hooks = await loaderWithoutManagers.loadHooks();
      const steering = await loaderWithoutManagers.loadSteeringFiles();

      expect(specs).toHaveLength(0);
      expect(hooks).toHaveLength(0);
      expect(steering).toHaveLength(0);
    });

    it('should load specs independently', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');

      const specs = await startupLoader.loadSpecs();

      expect(specs.length).toBe(1);
      expect(specs[0].name).toBe('test-spec');
    });

    it('should load hooks independently', async () => {
      fs.clear();
      await hookManager.registerHook({
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      });

      // Create fresh hook manager to simulate startup
      const freshHookManager = new HookManager(fs, silentLogger);
      const freshLoader = new StartupLoader({
        hookManager: freshHookManager,
        logger: silentLogger
      });

      const hooks = await freshLoader.loadHooks();

      expect(hooks.length).toBe(1);
      expect(hooks[0].id).toBe('test-hook');
    });

    it('should load steering files independently', async () => {
      fs.clear();
      await steeringManager.createSteeringFile('test-steering', { inclusion: 'always' }, '# Test');

      const steeringFiles = await startupLoader.loadSteeringFiles();

      expect(steeringFiles.length).toBe(1);
      expect(steeringFiles[0].name).toBe('test-steering');
    });
  });
});
