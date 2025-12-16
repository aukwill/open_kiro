import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { AgentController, type SpecPhase } from './agent-controller.js';
import type { IContextManager } from '../context-manager/context-manager.js';
import type { ISpecManager } from '../spec-manager/spec-manager.js';
import type { IHookManager } from '../hook-manager/hook-manager.js';
import type { CodeChange, AgentContext, HookResult } from '../types/index.js';

// Mock implementations
const createMockContextManager = (): IContextManager => ({
  buildContext: vi.fn().mockResolvedValue({
    systemPrompt: 'Test prompt',
    steeringContent: '',
    fileContents: [],
    conversationHistory: []
  } as AgentContext),
  addFile: vi.fn().mockResolvedValue(undefined),
  addFolder: vi.fn().mockResolvedValue(undefined),
  clearContext: vi.fn()
});

const createMockSpecManager = (): ISpecManager => ({
  createSpec: vi.fn(),
  loadSpec: vi.fn(),
  listSpecs: vi.fn(),
  updateDocument: vi.fn(),
  getTaskStatus: vi.fn(),
  setTaskStatus: vi.fn().mockResolvedValue(undefined)
});

const createMockHookManager = (): IHookManager => ({
  registerHook: vi.fn(),
  removeHook: vi.fn(),
  listHooks: vi.fn(),
  triggerHook: vi.fn().mockResolvedValue({ success: true } as HookResult),
  setHookEnabled: vi.fn(),
  loadHooks: vi.fn(),
  triggerByEvent: vi.fn().mockResolvedValue(undefined)
});

describe('AgentController', () => {
  let contextManager: IContextManager;
  let specManager: ISpecManager;
  let hookManager: IHookManager;
  let controller: AgentController;


  beforeEach(() => {
    contextManager = createMockContextManager();
    specManager = createMockSpecManager();
    hookManager = createMockHookManager();
    controller = new AgentController(contextManager, specManager, hookManager);
  });

  describe('Core Functionality (Task 10.1)', () => {
    it('should create a session on initialization', () => {
      const session = controller.getSession();
      expect(session).toBeDefined();
      expect(session.id).toMatch(/^session-/);
      expect(session.startTime).toBeInstanceOf(Date);
      expect(session.specWorkflows).toBeInstanceOf(Map);
      expect(session.pendingChanges).toEqual([]);
    });

    it('should process a message and return a response', async () => {
      const response = await controller.processMessage({ content: 'Hello' });
      
      expect(response).toBeDefined();
      expect(response.status).toBe('success');
      expect(response.content).toBeDefined();
    });

    it('should trigger message_sent hook when processing message', async () => {
      await controller.processMessage({ content: 'Test message' });
      
      expect(hookManager.triggerByEvent).toHaveBeenCalledWith('message_sent', { message: 'Test message' });
    });

    it('should build context with spec and task when provided', async () => {
      await controller.processMessage({
        content: 'Execute task',
        context: { spec: 'test-spec', taskId: '1.1' }
      });

      expect(contextManager.buildContext).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: 'test-spec',
          taskId: '1.1'
        })
      );
    });

    it('should emit events to registered handlers', async () => {
      const handler = vi.fn();
      controller.on('message_sent', handler);

      await controller.processMessage({ content: 'Test' });

      expect(handler).toHaveBeenCalled();
    });

    it('should allow unregistering event handlers', async () => {
      const handler = vi.fn();
      controller.on('message_sent', handler);
      controller.off('message_sent', handler);

      await controller.processMessage({ content: 'Test' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should execute a task and update status', async () => {
      const result = await controller.executeTask('test-spec', '1.1');

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('1.1');
      expect(specManager.setTaskStatus).toHaveBeenCalledWith('test-spec', '1.1', 'in_progress');
      expect(specManager.setTaskStatus).toHaveBeenCalledWith('test-spec', '1.1', 'completed');
    });

    it('should trigger agent_complete hook after task execution', async () => {
      await controller.executeTask('test-spec', '1.1');

      expect(hookManager.triggerByEvent).toHaveBeenCalledWith('agent_complete', {
        specName: 'test-spec',
        taskId: '1.1'
      });
    });
  });


  describe('Code Change Approval Gate (Task 10.2)', () => {
    it('should queue code changes for approval', () => {
      const changes: CodeChange[] = [
        { path: 'test.ts', content: 'test', operation: 'create' }
      ];

      const changeId = controller.queueCodeChanges(changes);

      expect(changeId).toMatch(/^change-/);
      const pending = controller.getPendingChanges();
      expect(pending).toHaveLength(1);
      expect(pending[0].changes).toEqual(changes);
      expect(pending[0].approved).toBe(false);
    });

    it('should approve a pending change', async () => {
      const changes: CodeChange[] = [
        { path: 'test.ts', content: 'test', operation: 'create' }
      ];
      const changeId = controller.queueCodeChanges(changes);

      const result = await controller.approveChange(changeId);

      expect(result).toBe(true);
      const pending = controller.getPendingChanges();
      expect(pending).toHaveLength(0); // Approved changes are filtered out
    });

    it('should return false when approving non-existent change', async () => {
      const result = await controller.approveChange('non-existent');
      expect(result).toBe(false);
    });

    it('should reject a pending change', () => {
      const changes: CodeChange[] = [
        { path: 'test.ts', content: 'test', operation: 'create' }
      ];
      const changeId = controller.queueCodeChanges(changes);

      const result = controller.rejectChange(changeId);

      expect(result).toBe(true);
      expect(controller.getPendingChanges()).toHaveLength(0);
    });

    it('should return false when rejecting non-existent change', () => {
      const result = controller.rejectChange('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('Spec Workflow State Machine (Task 10.4)', () => {
    it('should initialize workflow state in requirements phase', () => {
      const state = controller.getOrCreateWorkflowState('test-spec');

      expect(state.specName).toBe('test-spec');
      expect(state.currentPhase).toBe('requirements');
      expect(state.requirementsApproved).toBe(false);
      expect(state.designApproved).toBe(false);
      expect(state.tasksApproved).toBe(false);
    });

    it('should return existing workflow state', () => {
      const state1 = controller.getOrCreateWorkflowState('test-spec');
      state1.requirementsApproved = true;
      
      const state2 = controller.getOrCreateWorkflowState('test-spec');
      
      expect(state2.requirementsApproved).toBe(true);
    });

    it('should not allow transition to design without requirements approval', () => {
      expect(controller.canTransitionToPhase('test-spec', 'design')).toBe(false);
    });

    it('should allow transition to design after requirements approval', () => {
      controller.approveCurrentPhase('test-spec'); // Approve requirements
      
      expect(controller.canTransitionToPhase('test-spec', 'design')).toBe(true);
    });

    it('should not allow transition to tasks without design approval', () => {
      controller.approveCurrentPhase('test-spec'); // Approve requirements
      
      expect(controller.canTransitionToPhase('test-spec', 'tasks')).toBe(false);
    });

    it('should allow transition to tasks after design approval', () => {
      controller.approveCurrentPhase('test-spec'); // Approve requirements -> design
      controller.approveCurrentPhase('test-spec'); // Approve design -> tasks
      
      expect(controller.canTransitionToPhase('test-spec', 'tasks')).toBe(true);
    });

    it('should advance phase when approving current phase', () => {
      expect(controller.getWorkflowPhase('test-spec')).toBe('requirements');
      
      controller.approveCurrentPhase('test-spec');
      expect(controller.getWorkflowPhase('test-spec')).toBe('design');
      
      controller.approveCurrentPhase('test-spec');
      expect(controller.getWorkflowPhase('test-spec')).toBe('tasks');
      
      controller.approveCurrentPhase('test-spec');
      expect(controller.getWorkflowPhase('test-spec')).toBe('implementation');
    });

    it('should reset approvals when resetting requirements phase', () => {
      controller.approveCurrentPhase('test-spec'); // requirements -> design
      controller.approveCurrentPhase('test-spec'); // design -> tasks
      
      controller.resetPhaseApproval('test-spec', 'requirements');
      
      const state = controller.getOrCreateWorkflowState('test-spec');
      expect(state.currentPhase).toBe('requirements');
      expect(state.requirementsApproved).toBe(false);
      expect(state.designApproved).toBe(false);
      expect(state.tasksApproved).toBe(false);
    });

    it('should reset design and tasks approvals when resetting design phase', () => {
      controller.approveCurrentPhase('test-spec'); // requirements -> design
      controller.approveCurrentPhase('test-spec'); // design -> tasks
      controller.approveCurrentPhase('test-spec'); // tasks -> implementation
      
      controller.resetPhaseApproval('test-spec', 'design');
      
      const state = controller.getOrCreateWorkflowState('test-spec');
      expect(state.currentPhase).toBe('design');
      expect(state.requirementsApproved).toBe(true);
      expect(state.designApproved).toBe(false);
      expect(state.tasksApproved).toBe(false);
    });

    it('should check if phase is approved', () => {
      expect(controller.isPhaseApproved('test-spec', 'requirements')).toBe(false);
      
      controller.approveCurrentPhase('test-spec');
      
      expect(controller.isPhaseApproved('test-spec', 'requirements')).toBe(true);
      expect(controller.isPhaseApproved('test-spec', 'design')).toBe(false);
    });
  });


  /**
   * **Feature: open-kiro, Property 19: Code Change Approval Gate**
   * **Validates: Requirements 6.4, 6.5**
   * 
   * *For any* code changes generated by the agent, the changes should not be 
   * applied to the filesystem until the user explicitly approves them.
   */
  describe('Property 19: Code Change Approval Gate', () => {
    // Generator for valid code changes
    const codeChangeArb = fc.record({
      path: fc.stringMatching(/^[a-z][a-z0-9/._-]{0,50}$/),
      content: fc.string({ minLength: 0, maxLength: 1000 }),
      operation: fc.constantFrom('create', 'update', 'delete') as fc.Arbitrary<'create' | 'update' | 'delete'>
    });

    const codeChangesArb = fc.array(codeChangeArb, { minLength: 1, maxLength: 5 });

    it('should not apply changes until approved', () => {
      fc.assert(
        fc.property(codeChangesArb, (changes) => {
          // Reset controller for each test
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Queue changes
          const changeId = ctrl.queueCodeChanges(changes);

          // Verify changes are pending and not approved
          const pending = ctrl.getPendingChanges();
          expect(pending.length).toBeGreaterThan(0);
          
          const pendingChange = pending.find(p => p.id === changeId);
          expect(pendingChange).toBeDefined();
          expect(pendingChange!.approved).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should mark changes as approved only after explicit approval', async () => {
      await fc.assert(
        fc.asyncProperty(codeChangesArb, async (changes) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Queue changes
          const changeId = ctrl.queueCodeChanges(changes);

          // Before approval - should be in pending
          let pending = ctrl.getPendingChanges();
          expect(pending.some(p => p.id === changeId)).toBe(true);

          // Approve the change
          const approved = await ctrl.approveChange(changeId);
          expect(approved).toBe(true);

          // After approval - should not be in pending (filtered out)
          pending = ctrl.getPendingChanges();
          expect(pending.some(p => p.id === changeId)).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should only apply approved changes to filesystem', async () => {
      await fc.assert(
        fc.asyncProperty(codeChangesArb, codeChangesArb, async (approvedChanges, unapprovedChanges) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Create mock filesystem
          const writtenFiles: string[] = [];
          const deletedFiles: string[] = [];
          const mockFs = {
            readFile: vi.fn(),
            writeFile: vi.fn().mockImplementation((path: string) => {
              writtenFiles.push(path);
              return Promise.resolve();
            }),
            exists: vi.fn(),
            mkdir: vi.fn(),
            readdir: vi.fn(),
            watch: vi.fn(),
            delete: vi.fn().mockImplementation((path: string) => {
              deletedFiles.push(path);
              return Promise.resolve();
            })
          };

          // Queue both sets of changes
          const approvedId = ctrl.queueCodeChanges(approvedChanges);
          ctrl.queueCodeChanges(unapprovedChanges);

          // Only approve the first set
          await ctrl.approveChange(approvedId);

          // Apply approved changes
          const applied = await ctrl.applyApprovedChanges(mockFs);

          // Verify only approved changes were applied
          expect(applied.length).toBe(approvedChanges.length);
          
          // Verify each approved change was applied
          for (const change of approvedChanges) {
            if (change.operation === 'delete') {
              expect(deletedFiles).toContain(change.path);
            } else {
              expect(writtenFiles).toContain(change.path);
            }
          }

          // Verify unapproved changes were NOT applied
          for (const change of unapprovedChanges) {
            if (change.operation === 'delete') {
              // Only check if not in approved changes
              if (!approvedChanges.some(a => a.path === change.path && a.operation === 'delete')) {
                expect(deletedFiles).not.toContain(change.path);
              }
            }
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: open-kiro, Property 2: Spec Workflow State Transitions**
   * **Validates: Requirements 1.3, 1.4, 1.5**
   * 
   * *For any* spec in the "requirements" phase, the system should not advance to 
   * the "design" phase until explicit user approval is received. Similarly, 
   * *for any* spec in the "design" phase, the system should not advance to the 
   * "tasks" phase until explicit approval is received.
   */
  describe('Property 2: Spec Workflow State Transitions', () => {
    // Generator for valid spec names
    const specNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/);

    // Generator for phases
    const phaseArb = fc.constantFrom('requirements', 'design', 'tasks', 'implementation') as fc.Arbitrary<SpecPhase>;

    it('should not allow transition to design without requirements approval', () => {
      fc.assert(
        fc.property(specNameArb, (specName) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Fresh spec should be in requirements phase
          const phase = ctrl.getWorkflowPhase(specName);
          expect(phase).toBe('requirements');

          // Should not be able to transition to design
          const canTransition = ctrl.canTransitionToPhase(specName, 'design');
          expect(canTransition).toBe(false);

          // Attempting transition should fail
          const transitioned = ctrl.transitionToPhase(specName, 'design');
          expect(transitioned).toBe(false);

          // Phase should still be requirements
          expect(ctrl.getWorkflowPhase(specName)).toBe('requirements');

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should allow transition to design only after requirements approval', () => {
      fc.assert(
        fc.property(specNameArb, (specName) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Approve requirements
          ctrl.approveCurrentPhase(specName);

          // Now should be able to transition to design
          const canTransition = ctrl.canTransitionToPhase(specName, 'design');
          expect(canTransition).toBe(true);

          // Phase should now be design
          expect(ctrl.getWorkflowPhase(specName)).toBe('design');

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should not allow transition to tasks without design approval', () => {
      fc.assert(
        fc.property(specNameArb, (specName) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Approve requirements to get to design phase
          ctrl.approveCurrentPhase(specName);
          expect(ctrl.getWorkflowPhase(specName)).toBe('design');

          // Should not be able to transition to tasks
          const canTransition = ctrl.canTransitionToPhase(specName, 'tasks');
          expect(canTransition).toBe(false);

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should allow transition to tasks only after design approval', () => {
      fc.assert(
        fc.property(specNameArb, (specName) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Approve requirements -> design
          ctrl.approveCurrentPhase(specName);
          // Approve design -> tasks
          ctrl.approveCurrentPhase(specName);

          // Now should be able to transition to tasks
          const canTransition = ctrl.canTransitionToPhase(specName, 'tasks');
          expect(canTransition).toBe(true);

          // Phase should now be tasks
          expect(ctrl.getWorkflowPhase(specName)).toBe('tasks');

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should enforce sequential phase progression', () => {
      fc.assert(
        fc.property(specNameArb, phaseArb, (specName, targetPhase) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Fresh spec - only requirements should be accessible
          const state = ctrl.getOrCreateWorkflowState(specName);
          
          // Can always go to requirements
          expect(ctrl.canTransitionToPhase(specName, 'requirements')).toBe(true);

          // Cannot skip to later phases without approvals
          if (targetPhase === 'design') {
            expect(ctrl.canTransitionToPhase(specName, 'design')).toBe(state.requirementsApproved);
          }
          if (targetPhase === 'tasks') {
            expect(ctrl.canTransitionToPhase(specName, 'tasks')).toBe(state.designApproved);
          }
          if (targetPhase === 'implementation') {
            expect(ctrl.canTransitionToPhase(specName, 'implementation')).toBe(state.tasksApproved);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should reset downstream approvals when resetting a phase', () => {
      fc.assert(
        fc.property(specNameArb, (specName) => {
          const ctrl = new AgentController(
            createMockContextManager(),
            createMockSpecManager(),
            createMockHookManager()
          );

          // Progress through all phases
          ctrl.approveCurrentPhase(specName); // requirements -> design
          ctrl.approveCurrentPhase(specName); // design -> tasks
          ctrl.approveCurrentPhase(specName); // tasks -> implementation

          // Verify all approvals are set
          expect(ctrl.isPhaseApproved(specName, 'requirements')).toBe(true);
          expect(ctrl.isPhaseApproved(specName, 'design')).toBe(true);
          expect(ctrl.isPhaseApproved(specName, 'tasks')).toBe(true);

          // Reset requirements - should reset all downstream
          ctrl.resetPhaseApproval(specName, 'requirements');

          expect(ctrl.isPhaseApproved(specName, 'requirements')).toBe(false);
          expect(ctrl.isPhaseApproved(specName, 'design')).toBe(false);
          expect(ctrl.isPhaseApproved(specName, 'tasks')).toBe(false);
          expect(ctrl.getWorkflowPhase(specName)).toBe('requirements');

          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});
