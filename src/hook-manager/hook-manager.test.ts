import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { HookManager, type IHookLogger } from './hook-manager.js';
import { InMemoryFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import type { HookConfig, HookTrigger, HookAction } from '../types/index.js';

describe('HookManager', () => {
  let fs: InMemoryFileSystemAdapter;
  let hookManager: HookManager;
  let mockLogger: IHookLogger;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    mockLogger = {
      error: vi.fn(),
      info: vi.fn()
    };
    hookManager = new HookManager(fs, mockLogger);
  });

  // Generators for property-based testing
  const hookIdArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 30 }
  ).filter(s => /^[a-z][a-z0-9-]*$/.test(s));

  const hookNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0); // Must have non-whitespace content

  const triggerArb: fc.Arbitrary<HookTrigger> = fc.oneof(
    fc.record({ type: fc.constant('file_save' as const), pattern: fc.option(fc.string(), { nil: undefined }) }),
    fc.record({ type: fc.constant('message_sent' as const) }),
    fc.record({ type: fc.constant('session_created' as const) }),
    fc.record({ type: fc.constant('agent_complete' as const) }),
    fc.record({ type: fc.constant('manual' as const) })
  );

  const actionArb: fc.Arbitrary<HookAction> = fc.oneof(
    fc.record({ type: fc.constant('send_message' as const), message: fc.string({ minLength: 1 }) }),
    fc.record({ 
      type: fc.constant('execute_command' as const), 
      command: fc.string({ minLength: 1 }),
      cwd: fc.option(fc.string(), { nil: undefined })
    })
  );

  const hookConfigArb: fc.Arbitrary<HookConfig> = fc.record({
    id: hookIdArb,
    name: hookNameArb,
    description: fc.option(fc.string(), { nil: undefined }),
    trigger: triggerArb,
    action: actionArb,
    enabled: fc.boolean(),
    conditions: fc.option(
      fc.array(fc.record({ type: fc.string(), value: fc.string() }), { maxLength: 3 }),
      { nil: undefined }
    )
  });


  /**
   * **Feature: open-kiro, Property 3: Hook Persistence Round-Trip**
   * **Validates: Requirements 2.1**
   * 
   * *For any* valid hook configuration, saving the hook and then loading it
   * should produce an equivalent configuration object.
   */
  describe('Property 3: Hook Persistence Round-Trip', () => {
    it('should persist and load hook configuration with equivalent values', async () => {
      await fc.assert(
        fc.asyncProperty(
          hookConfigArb,
          async (hookConfig) => {
            fs.clear();

            // Register the hook (saves to file)
            await hookManager.registerHook(hookConfig);

            // Create a new HookManager instance to simulate fresh load
            const newHookManager = new HookManager(fs, mockLogger);
            await newHookManager.loadHooks();

            // Get the loaded hook
            const loadedHook = newHookManager.getHook(hookConfig.id);

            // Verify the hook was loaded
            expect(loadedHook).toBeDefined();

            // Verify all properties match
            expect(loadedHook?.id).toBe(hookConfig.id);
            expect(loadedHook?.name).toBe(hookConfig.name);
            expect(loadedHook?.description).toBe(hookConfig.description);
            expect(loadedHook?.enabled).toBe(hookConfig.enabled);
            expect(loadedHook?.trigger.type).toBe(hookConfig.trigger.type);
            expect(loadedHook?.action.type).toBe(hookConfig.action.type);

            // Deep equality check
            expect(loadedHook).toEqual(hookConfig);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should store hooks as valid JSON files', async () => {
      await fc.assert(
        fc.asyncProperty(
          hookConfigArb,
          async (hookConfig) => {
            fs.clear();

            await hookManager.registerHook(hookConfig);

            // Verify the file exists and is valid JSON
            const hookPath = `.kiro/hooks/${hookConfig.id}.json`;
            const exists = await fs.exists(hookPath);
            expect(exists).toBe(true);

            const content = await fs.readFile(hookPath);
            const parsed = JSON.parse(content);
            expect(parsed).toEqual(hookConfig);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should load multiple hooks correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(hookConfigArb, { minLength: 1, maxLength: 5 })
            .filter(hooks => new Set(hooks.map(h => h.id)).size === hooks.length), // unique IDs
          async (hookConfigs) => {
            fs.clear();

            // Register all hooks
            for (const hook of hookConfigs) {
              await hookManager.registerHook(hook);
            }

            // Create new manager and load
            const newHookManager = new HookManager(fs, mockLogger);
            await newHookManager.loadHooks();

            // Verify all hooks were loaded
            const loadedHooks = await newHookManager.listHooks();
            expect(loadedHooks.length).toBe(hookConfigs.length);

            for (const originalHook of hookConfigs) {
              const loaded = newHookManager.getHook(originalHook.id);
              expect(loaded).toEqual(originalHook);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Hook Registration', () => {
    it('should register a valid hook', async () => {
      const hook: HookConfig = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'file_save', pattern: '**/*.ts' },
        action: { type: 'send_message', message: 'File saved!' },
        enabled: true
      };

      await hookManager.registerHook(hook);

      const hooks = await hookManager.listHooks();
      expect(hooks.length).toBe(1);
      expect(hooks[0]).toEqual(hook);
    });

    it('should reject hook with empty ID', async () => {
      const hook: HookConfig = {
        id: '',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      };

      await expect(hookManager.registerHook(hook)).rejects.toThrow('Hook ID cannot be empty');
    });

    it('should reject hook with empty name', async () => {
      const hook: HookConfig = {
        id: 'test-hook',
        name: '',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      };

      await expect(hookManager.registerHook(hook)).rejects.toThrow('Hook name cannot be empty');
    });

    it('should reject send_message action without message', async () => {
      const hook = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message' },
        enabled: true
      } as HookConfig;

      await expect(hookManager.registerHook(hook)).rejects.toThrow('send_message action requires a message');
    });

    it('should reject execute_command action without command', async () => {
      const hook = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'execute_command' },
        enabled: true
      } as HookConfig;

      await expect(hookManager.registerHook(hook)).rejects.toThrow('execute_command action requires a command');
    });
  });

  describe('Hook Removal', () => {
    it('should remove a registered hook', async () => {
      const hook: HookConfig = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      };

      await hookManager.registerHook(hook);
      expect((await hookManager.listHooks()).length).toBe(1);

      await hookManager.removeHook('test-hook');
      expect((await hookManager.listHooks()).length).toBe(0);

      // Verify file was deleted
      const exists = await fs.exists('.kiro/hooks/test-hook.json');
      expect(exists).toBe(false);
    });

    it('should handle removing non-existent hook gracefully', async () => {
      // Should not throw
      await hookManager.removeHook('non-existent');
    });
  });

  describe('Hook Enable/Disable', () => {
    it('should enable and disable a hook', async () => {
      const hook: HookConfig = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      };

      await hookManager.registerHook(hook);

      // Disable
      await hookManager.setHookEnabled('test-hook', false);
      expect(hookManager.getHook('test-hook')?.enabled).toBe(false);

      // Enable
      await hookManager.setHookEnabled('test-hook', true);
      expect(hookManager.getHook('test-hook')?.enabled).toBe(true);
    });

    it('should throw when enabling non-existent hook', async () => {
      await expect(hookManager.setHookEnabled('non-existent', true))
        .rejects.toThrow("Hook 'non-existent' not found");
    });

    it('should persist enabled state to file', async () => {
      const hook: HookConfig = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      };

      await hookManager.registerHook(hook);
      await hookManager.setHookEnabled('test-hook', false);

      // Load in new manager
      const newManager = new HookManager(fs, mockLogger);
      await newManager.loadHooks();

      expect(newManager.getHook('test-hook')?.enabled).toBe(false);
    });
  });

  /**
   * **Feature: open-kiro, Property 4: Hook Trigger Execution**
   * **Validates: Requirements 2.2**
   * 
   * *For any* enabled hook with a matching trigger event, when that event occurs,
   * the hook's action should be executed exactly once.
   */
  describe('Property 4: Hook Trigger Execution', () => {
    it('should execute enabled hooks when matching trigger event occurs', async () => {
      const triggerTypes: Array<'file_save' | 'message_sent' | 'session_created' | 'agent_complete' | 'manual'> = 
        ['file_save', 'message_sent', 'session_created', 'agent_complete', 'manual'];

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...triggerTypes),
          fc.boolean(),
          async (triggerType, enabled) => {
            fs.clear();
            const newManager = new HookManager(fs, mockLogger);

            // Track execution
            let executionCount = 0;
            const mockSender = {
              sendMessage: async () => { executionCount++; }
            };
            newManager.setMessageSender(mockSender);

            const hook: HookConfig = {
              id: 'test-hook',
              name: 'Test Hook',
              trigger: triggerType === 'file_save' 
                ? { type: 'file_save', pattern: '**/*.ts' }
                : { type: triggerType },
              action: { type: 'send_message', message: 'triggered' },
              enabled
            };

            await newManager.registerHook(hook);

            // Emit the matching event
            const context = triggerType === 'file_save' 
              ? { filePath: 'src/test.ts' }
              : {};
            await newManager.emit(triggerType, context);

            // Verify execution based on enabled state
            if (enabled) {
              expect(executionCount).toBe(1);
            } else {
              expect(executionCount).toBe(0);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should not execute hooks when trigger type does not match', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<'message_sent' | 'session_created' | 'agent_complete' | 'manual'>(
            'message_sent', 'session_created', 'agent_complete', 'manual'
          ),
          fc.constantFrom<'message_sent' | 'session_created' | 'agent_complete' | 'manual'>(
            'message_sent', 'session_created', 'agent_complete', 'manual'
          ),
          async (hookTrigger, emittedEvent) => {
            // Skip if they match - that's tested above
            if (hookTrigger === emittedEvent) return;

            fs.clear();
            const newManager = new HookManager(fs, mockLogger);

            let executionCount = 0;
            const mockSender = {
              sendMessage: async () => { executionCount++; }
            };
            newManager.setMessageSender(mockSender);

            const hook: HookConfig = {
              id: 'test-hook',
              name: 'Test Hook',
              trigger: { type: hookTrigger },
              action: { type: 'send_message', message: 'triggered' },
              enabled: true
            };

            await newManager.registerHook(hook);
            await newManager.emit(emittedEvent, {});

            // Should not execute because trigger doesn't match
            expect(executionCount).toBe(0);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should execute hook exactly once per matching event', async () => {
      fs.clear();
      let executionCount = 0;
      const mockSender = {
        sendMessage: async () => { executionCount++; }
      };
      hookManager.setMessageSender(mockSender);

      const hook: HookConfig = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'triggered' },
        enabled: true
      };

      await hookManager.registerHook(hook);

      // Emit event multiple times
      await hookManager.emit('message_sent', {});
      expect(executionCount).toBe(1);

      await hookManager.emit('message_sent', {});
      expect(executionCount).toBe(2);

      await hookManager.emit('message_sent', {});
      expect(executionCount).toBe(3);
    });

    it('should respect file_save pattern matching', async () => {
      fs.clear();
      let executionCount = 0;
      const mockSender = {
        sendMessage: async () => { executionCount++; }
      };
      hookManager.setMessageSender(mockSender);

      const hook: HookConfig = {
        id: 'ts-hook',
        name: 'TypeScript Hook',
        trigger: { type: 'file_save', pattern: '**/*.ts' },
        action: { type: 'send_message', message: 'TS file saved' },
        enabled: true
      };

      await hookManager.registerHook(hook);

      // Should trigger for .ts files
      await hookManager.emit('file_save', { filePath: 'src/index.ts' });
      expect(executionCount).toBe(1);

      // Should not trigger for .js files
      await hookManager.emit('file_save', { filePath: 'src/index.js' });
      expect(executionCount).toBe(1); // Still 1

      // Should trigger for nested .ts files
      await hookManager.emit('file_save', { filePath: 'src/deep/nested/file.ts' });
      expect(executionCount).toBe(2);
    });

    it('should execute multiple matching hooks for same event', async () => {
      fs.clear();
      const executions: string[] = [];
      const mockSender = {
        sendMessage: async (msg: string) => { executions.push(msg); }
      };
      hookManager.setMessageSender(mockSender);

      const hook1: HookConfig = {
        id: 'hook-1',
        name: 'Hook 1',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'hook1' },
        enabled: true
      };

      const hook2: HookConfig = {
        id: 'hook-2',
        name: 'Hook 2',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'hook2' },
        enabled: true
      };

      await hookManager.registerHook(hook1);
      await hookManager.registerHook(hook2);

      await hookManager.emit('message_sent', {});

      expect(executions.length).toBe(2);
      expect(executions).toContain('hook1');
      expect(executions).toContain('hook2');
    });
  });

  /**
   * **Feature: open-kiro, Property 5: Hook Action Types**
   * **Validates: Requirements 2.3, 2.4**
   * 
   * *For any* hook with action type "send_message", execution should result in
   * the message being sent to the agent. *For any* hook with action type
   * "execute_command", execution should result in the command being run.
   */
  describe('Property 5: Hook Action Types', () => {
    it('should execute send_message action and send message to agent', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          async (message) => {
            fs.clear();
            const newManager = new HookManager(fs, mockLogger);

            let sentMessage: string | null = null;
            const mockSender = {
              sendMessage: async (msg: string) => { sentMessage = msg; }
            };
            newManager.setMessageSender(mockSender);

            const hook: HookConfig = {
              id: 'msg-hook',
              name: 'Message Hook',
              trigger: { type: 'manual' },
              action: { type: 'send_message', message },
              enabled: true
            };

            await newManager.registerHook(hook);
            const result = await newManager.triggerHook('msg-hook');

            expect(result.success).toBe(true);
            expect(sentMessage).toBe(message);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should execute execute_command action and run the command', async () => {
      fs.clear();

      const hook: HookConfig = {
        id: 'cmd-hook',
        name: 'Command Hook',
        trigger: { type: 'manual' },
        action: { type: 'execute_command', command: 'echo hello' },
        enabled: true
      };

      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('cmd-hook');

      expect(result.success).toBe(true);
      expect(result.output?.trim()).toBe('hello');
    });

    it('should return error when send_message has no message sender configured', async () => {
      fs.clear();
      // Don't set message sender

      const hook: HookConfig = {
        id: 'msg-hook',
        name: 'Message Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      };

      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('msg-hook');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No message sender configured');
    });

    it('should return error when execute_command fails', async () => {
      fs.clear();

      const hook: HookConfig = {
        id: 'cmd-hook',
        name: 'Command Hook',
        trigger: { type: 'manual' },
        action: { type: 'execute_command', command: 'nonexistent-command-xyz' },
        enabled: true
      };

      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('cmd-hook');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should interpolate context variables in send_message', async () => {
      fs.clear();
      let sentMessage: string | null = null;
      const mockSender = {
        sendMessage: async (msg: string) => { sentMessage = msg; }
      };
      hookManager.setMessageSender(mockSender);

      const hook: HookConfig = {
        id: 'msg-hook',
        name: 'Message Hook',
        trigger: { type: 'file_save' },
        action: { type: 'send_message', message: 'File {filePath} was saved' },
        enabled: true
      };

      await hookManager.registerHook(hook);
      await hookManager.emit('file_save', { filePath: 'src/index.ts' });

      expect(sentMessage).toBe('File src/index.ts was saved');
    });

    it('should return error for disabled hook', async () => {
      fs.clear();

      const hook: HookConfig = {
        id: 'disabled-hook',
        name: 'Disabled Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'test' },
        enabled: false
      };

      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('disabled-hook');

      expect(result.success).toBe(false);
      expect(result.error).toBe("Hook 'disabled-hook' is disabled");
    });

    it('should return error for non-existent hook', async () => {
      const result = await hookManager.triggerHook('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe("Hook 'non-existent' not found");
    });
  });

  /**
   * **Feature: open-kiro, Property 6: Hook Failure Isolation**
   * **Validates: Requirements 2.5**
   * 
   * *For any* hook that fails during execution, the failure should be logged
   * and should not propagate exceptions to the caller or block other operations.
   */
  describe('Property 6: Hook Failure Isolation', () => {
    it('should not propagate exceptions when hook action fails during emit', async () => {
      fs.clear();
      const testLogger = {
        error: vi.fn(),
        info: vi.fn()
      };
      const newManager = new HookManager(fs, testLogger);

      // Set up a message sender that throws
      const failingSender = {
        sendMessage: async () => { throw new Error('Sender failed'); }
      };
      newManager.setMessageSender(failingSender);

      const hook: HookConfig = {
        id: 'failing-hook',
        name: 'Failing Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'test' },
        enabled: true
      };

      await newManager.registerHook(hook);

      // Should not throw - failure is isolated
      await expect(newManager.emit('message_sent', {})).resolves.not.toThrow();

      // Error should be logged
      expect(testLogger.error).toHaveBeenCalled();
    });

    it('should continue executing other hooks when one fails', async () => {
      fs.clear();
      const testLogger = {
        error: vi.fn(),
        info: vi.fn()
      };
      const newManager = new HookManager(fs, testLogger);

      let successfulExecutions = 0;
      const testSender = {
        sendMessage: async (msg: string) => {
          if (msg === 'fail') {
            throw new Error('Intentional failure');
          }
          successfulExecutions++;
        }
      };
      newManager.setMessageSender(testSender);

      // Register a hook that will fail
      const failingHook: HookConfig = {
        id: 'failing-hook',
        name: 'Failing Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'fail' },
        enabled: true
      };

      // Register a hook that will succeed
      const successHook: HookConfig = {
        id: 'success-hook',
        name: 'Success Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'success' },
        enabled: true
      };

      await newManager.registerHook(failingHook);
      await newManager.registerHook(successHook);

      // Emit event - should not throw
      await newManager.emit('message_sent', {});

      // The successful hook should have executed
      expect(successfulExecutions).toBe(1);
      // Error should be logged for the failing hook
      expect(testLogger.error).toHaveBeenCalled();
    });

    it('should log errors when command execution fails during emit', async () => {
      fs.clear();
      const newManager = new HookManager(fs, mockLogger);

      const hook: HookConfig = {
        id: 'bad-cmd-hook',
        name: 'Bad Command Hook',
        trigger: { type: 'manual' },
        action: { type: 'execute_command', command: 'nonexistent-command-xyz-123' },
        enabled: true
      };

      await newManager.registerHook(hook);

      // triggerHook returns result, doesn't throw
      const result = await newManager.triggerHook('bad-cmd-hook');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should isolate failures for any hook configuration', async () => {
      await fc.assert(
        fc.asyncProperty(
          hookIdArb,
          hookNameArb,
          async (hookId, hookName) => {
            fs.clear();
            const newManager = new HookManager(fs, mockLogger);

            // Always-failing sender
            const failingSender = {
              sendMessage: async () => { throw new Error('Always fails'); }
            };
            newManager.setMessageSender(failingSender);

            const hook: HookConfig = {
              id: hookId,
              name: hookName,
              trigger: { type: 'message_sent' },
              action: { type: 'send_message', message: 'test' },
              enabled: true
            };

            await newManager.registerHook(hook);

            // Should never throw regardless of hook configuration
            await expect(newManager.emit('message_sent', {})).resolves.not.toThrow();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should isolate event listener failures', async () => {
      fs.clear();

      let successfulListenerCalls = 0;

      // Register a failing listener
      hookManager.on('message_sent', () => {
        throw new Error('Listener failed');
      });

      // Register a successful listener
      hookManager.on('message_sent', () => {
        successfulListenerCalls++;
      });

      // Should not throw
      await expect(hookManager.emit('message_sent', {})).resolves.not.toThrow();

      // Successful listener should have been called
      expect(successfulListenerCalls).toBe(1);
    });
  });
});
