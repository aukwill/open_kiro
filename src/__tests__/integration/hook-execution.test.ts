import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookManager, type IMessageSender, type IHookLogger } from '../../hook-manager/hook-manager.js';
import { InMemoryFileSystemAdapter } from '../../filesystem/filesystem-adapter.js';
import type { HookConfig } from '../../types/index.js';

/**
 * Integration tests for hook execution
 * Tests trigger → action flow end-to-end
 * 
 * **Validates: Requirements 2.2, 2.3, 2.4**
 */
describe('Hook Execution Integration', () => {
  let fs: InMemoryFileSystemAdapter;
  let hookManager: HookManager;
  let mockLogger: IHookLogger;
  let sentMessages: string[];
  let mockMessageSender: IMessageSender;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    sentMessages = [];
    
    mockLogger = {
      error: vi.fn(),
      info: vi.fn()
    };
    
    mockMessageSender = {
      sendMessage: vi.fn(async (message: string) => {
        sentMessages.push(message);
      })
    };
    
    hookManager = new HookManager(fs, mockLogger);
    hookManager.setMessageSender(mockMessageSender);
  });

  describe('Hook Registration and Persistence', () => {
    /**
     * Tests that hooks are persisted to filesystem and can be loaded
     */
    it('should persist and load hooks', async () => {
      const hook: HookConfig = {
        id: 'test-hook',
        name: 'Test Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'Hello!' },
        enabled: true
      };
      
      // Register hook
      await hookManager.registerHook(hook);
      
      // Verify file was created
      expect(await fs.exists('.kiro/hooks/test-hook.json')).toBe(true);
      
      // Create new hook manager and load hooks
      const newHookManager = new HookManager(fs, mockLogger);
      await newHookManager.loadHooks();
      
      // Verify hook was loaded
      const hooks = await newHookManager.listHooks();
      expect(hooks.length).toBe(1);
      expect(hooks[0].id).toBe('test-hook');
      expect(hooks[0].name).toBe('Test Hook');
    });

    /**
     * Tests that multiple hooks can be registered and listed
     */
    it('should handle multiple hooks', async () => {
      const hooks: HookConfig[] = [
        {
          id: 'hook-1',
          name: 'Hook One',
          trigger: { type: 'file_save' },
          action: { type: 'send_message', message: 'File saved!' },
          enabled: true
        },
        {
          id: 'hook-2',
          name: 'Hook Two',
          trigger: { type: 'message_sent' },
          action: { type: 'send_message', message: 'Message sent!' },
          enabled: true
        },
        {
          id: 'hook-3',
          name: 'Hook Three',
          trigger: { type: 'manual' },
          action: { type: 'execute_command', command: 'echo test' },
          enabled: false
        }
      ];
      
      // Register all hooks
      for (const hook of hooks) {
        await hookManager.registerHook(hook);
      }
      
      // List hooks
      const listedHooks = await hookManager.listHooks();
      expect(listedHooks.length).toBe(3);
      
      // Verify each hook exists
      for (const hook of hooks) {
        const found = listedHooks.find(h => h.id === hook.id);
        expect(found).toBeDefined();
        expect(found?.name).toBe(hook.name);
      }
    });

    /**
     * Tests that hooks can be removed
     */
    it('should remove hooks', async () => {
      const hook: HookConfig = {
        id: 'removable-hook',
        name: 'Removable Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'Test' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      expect((await hookManager.listHooks()).length).toBe(1);
      
      await hookManager.removeHook('removable-hook');
      expect((await hookManager.listHooks()).length).toBe(0);
      expect(await fs.exists('.kiro/hooks/removable-hook.json')).toBe(false);
    });
  });

  describe('Hook Trigger Execution', () => {
    /**
     * Tests that manual trigger executes hook action
     * 
     * **Validates: Requirements 2.2**
     */
    it('should execute hook on manual trigger', async () => {
      const hook: HookConfig = {
        id: 'manual-hook',
        name: 'Manual Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'Manual trigger executed!' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      // Trigger the hook
      const result = await hookManager.triggerHook('manual-hook');
      
      expect(result.success).toBe(true);
      expect(sentMessages).toContain('Manual trigger executed!');
    });

    /**
     * Tests that file_save trigger executes matching hooks
     * 
     * **Validates: Requirements 2.2**
     */
    it('should execute hooks on file_save event', async () => {
      const hook: HookConfig = {
        id: 'file-save-hook',
        name: 'File Save Hook',
        trigger: { type: 'file_save', pattern: '**/*.ts' },
        action: { type: 'send_message', message: 'TypeScript file saved: {filePath}' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      // Emit file_save event
      await hookManager.emit('file_save', { filePath: 'src/test.ts' });
      
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toBe('TypeScript file saved: src/test.ts');
    });

    /**
     * Tests that file_save trigger respects pattern matching
     */
    it('should not execute hook when pattern does not match', async () => {
      const hook: HookConfig = {
        id: 'ts-only-hook',
        name: 'TypeScript Only Hook',
        trigger: { type: 'file_save', pattern: '**/*.ts' },
        action: { type: 'send_message', message: 'TS file saved' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      // Emit file_save event for non-matching file
      await hookManager.emit('file_save', { filePath: 'src/test.js' });
      
      expect(sentMessages.length).toBe(0);
    });

    /**
     * Tests that message_sent trigger executes hooks
     * 
     * **Validates: Requirements 2.2**
     */
    it('should execute hooks on message_sent event', async () => {
      const hook: HookConfig = {
        id: 'message-hook',
        name: 'Message Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'Message received: {message}' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      // Emit message_sent event
      await hookManager.emit('message_sent', { message: 'Hello world' });
      
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toBe('Message received: Hello world');
    });

    /**
     * Tests that session_created trigger executes hooks
     */
    it('should execute hooks on session_created event', async () => {
      const hook: HookConfig = {
        id: 'session-hook',
        name: 'Session Hook',
        trigger: { type: 'session_created' },
        action: { type: 'send_message', message: 'New session started!' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      // Emit session_created event
      await hookManager.emit('session_created', {});
      
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toBe('New session started!');
    });

    /**
     * Tests that agent_complete trigger executes hooks
     */
    it('should execute hooks on agent_complete event', async () => {
      const hook: HookConfig = {
        id: 'complete-hook',
        name: 'Complete Hook',
        trigger: { type: 'agent_complete' },
        action: { type: 'send_message', message: 'Agent completed task!' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      // Emit agent_complete event
      await hookManager.emit('agent_complete', { specName: 'test-spec', taskId: '1' });
      
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toBe('Agent completed task!');
    });
  });

  describe('Hook Action Types', () => {
    /**
     * Tests send_message action
     * 
     * **Validates: Requirements 2.3**
     */
    it('should execute send_message action', async () => {
      const hook: HookConfig = {
        id: 'send-msg-hook',
        name: 'Send Message Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'Test message content' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('send-msg-hook');
      
      expect(result.success).toBe(true);
      expect(result.output).toBe('Test message content');
      expect(mockMessageSender.sendMessage).toHaveBeenCalledWith('Test message content');
    });

    /**
     * Tests execute_command action
     * 
     * **Validates: Requirements 2.4**
     */
    it('should execute execute_command action', async () => {
      const hook: HookConfig = {
        id: 'cmd-hook',
        name: 'Command Hook',
        trigger: { type: 'manual' },
        action: { type: 'execute_command', command: 'echo "Hello from command"' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('cmd-hook');
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello from command');
    });

    /**
     * Tests message interpolation with context variables
     */
    it('should interpolate context variables in messages', async () => {
      const hook: HookConfig = {
        id: 'interpolate-hook',
        name: 'Interpolate Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'File: {filePath}, Event: {event}' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('interpolate-hook', {
        filePath: 'src/index.ts',
        event: 'save'
      });
      
      expect(result.success).toBe(true);
      expect(result.output).toBe('File: src/index.ts, Event: save');
    });
  });

  describe('Hook Enable/Disable', () => {
    /**
     * Tests that disabled hooks are not executed
     */
    it('should not execute disabled hooks', async () => {
      const hook: HookConfig = {
        id: 'disabled-hook',
        name: 'Disabled Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'Should not appear' },
        enabled: false
      };
      
      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('disabled-hook');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
      expect(sentMessages.length).toBe(0);
    });

    /**
     * Tests that hooks can be enabled/disabled dynamically
     */
    it('should enable and disable hooks dynamically', async () => {
      const hook: HookConfig = {
        id: 'toggle-hook',
        name: 'Toggle Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'Toggled!' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      
      // Should work when enabled
      let result = await hookManager.triggerHook('toggle-hook');
      expect(result.success).toBe(true);
      
      // Disable the hook
      await hookManager.setHookEnabled('toggle-hook', false);
      
      // Should fail when disabled
      result = await hookManager.triggerHook('toggle-hook');
      expect(result.success).toBe(false);
      
      // Re-enable the hook
      await hookManager.setHookEnabled('toggle-hook', true);
      
      // Should work again
      result = await hookManager.triggerHook('toggle-hook');
      expect(result.success).toBe(true);
    });

    /**
     * Tests that disabled hooks are not triggered by events
     */
    it('should not trigger disabled hooks on events', async () => {
      const hook: HookConfig = {
        id: 'event-disabled-hook',
        name: 'Event Disabled Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'Should not appear' },
        enabled: false
      };
      
      await hookManager.registerHook(hook);
      
      // Emit event
      await hookManager.emit('message_sent', { message: 'test' });
      
      expect(sentMessages.length).toBe(0);
    });
  });

  describe('Hook Failure Isolation', () => {
    /**
     * Tests that hook failures are logged but don't propagate
     */
    it('should isolate hook failures and continue operation', async () => {
      // Create a hook that will fail (no message sender configured)
      const newHookManager = new HookManager(fs, mockLogger);
      // Don't set message sender - this will cause send_message to fail
      
      const hook: HookConfig = {
        id: 'failing-hook',
        name: 'Failing Hook',
        trigger: { type: 'manual' },
        action: { type: 'send_message', message: 'Will fail' },
        enabled: true
      };
      
      await newHookManager.registerHook(hook);
      
      // Trigger should not throw
      const result = await newHookManager.triggerHook('failing-hook');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    /**
     * Tests that one failing hook doesn't prevent other hooks from executing
     */
    it('should execute other hooks when one fails', async () => {
      // Create hook manager without message sender (will fail send_message)
      const isolatedHookManager = new HookManager(fs, mockLogger);
      
      const failingHook: HookConfig = {
        id: 'failing',
        name: 'Failing Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'send_message', message: 'Will fail' },
        enabled: true
      };
      
      const commandHook: HookConfig = {
        id: 'command',
        name: 'Command Hook',
        trigger: { type: 'message_sent' },
        action: { type: 'execute_command', command: 'echo success' },
        enabled: true
      };
      
      await isolatedHookManager.registerHook(failingHook);
      await isolatedHookManager.registerHook(commandHook);
      
      // Emit event - should not throw even though one hook fails
      await isolatedHookManager.emit('message_sent', { message: 'test' });
      
      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalled();
    });

    /**
     * Tests that command execution failures are handled gracefully
     */
    it('should handle command execution failures gracefully', async () => {
      const hook: HookConfig = {
        id: 'bad-cmd-hook',
        name: 'Bad Command Hook',
        trigger: { type: 'manual' },
        action: { type: 'execute_command', command: 'nonexistent-command-xyz' },
        enabled: true
      };
      
      await hookManager.registerHook(hook);
      const result = await hookManager.triggerHook('bad-cmd-hook');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Event Listeners', () => {
    /**
     * Tests that event listeners are notified on events
     */
    it('should notify event listeners', async () => {
      const receivedEvents: string[] = [];
      
      hookManager.on('file_save', (context) => {
        receivedEvents.push(`file_save: ${(context as { filePath?: string }).filePath}`);
      });
      
      await hookManager.emit('file_save', { filePath: 'test.ts' });
      
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0]).toBe('file_save: test.ts');
    });

    /**
     * Tests that event listeners can be disposed
     */
    it('should allow disposing event listeners', async () => {
      const receivedEvents: string[] = [];
      
      const disposable = hookManager.on('message_sent', () => {
        receivedEvents.push('received');
      });
      
      await hookManager.emit('message_sent', {});
      expect(receivedEvents.length).toBe(1);
      
      // Dispose the listener
      disposable.dispose();
      
      await hookManager.emit('message_sent', {});
      expect(receivedEvents.length).toBe(1); // Should not increase
    });
  });
});
