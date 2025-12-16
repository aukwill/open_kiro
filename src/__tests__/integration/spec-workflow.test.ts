import { describe, it, expect, beforeEach } from 'vitest';
import { SpecManager } from '../../spec-manager/spec-manager.js';
import { SteeringManager } from '../../steering-manager/steering-manager.js';
import { ContextManager } from '../../context-manager/context-manager.js';
import { AgentController } from '../../agent-controller/agent-controller.js';
import { HookManager } from '../../hook-manager/hook-manager.js';
import { InMemoryFileSystemAdapter } from '../../filesystem/filesystem-adapter.js';

/**
 * Integration tests for spec workflow
 * Tests complete create → requirements → design → tasks flow
 * 
 * **Validates: Requirements 1.1, 1.3, 1.4, 1.5**
 */
describe('Spec Workflow Integration', () => {
  let fs: InMemoryFileSystemAdapter;
  let specManager: SpecManager;
  let steeringManager: SteeringManager;
  let contextManager: ContextManager;
  let hookManager: HookManager;
  let agentController: AgentController;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    specManager = new SpecManager(fs);
    steeringManager = new SteeringManager(fs);
    contextManager = new ContextManager(fs, specManager, steeringManager);
    hookManager = new HookManager(fs);
    agentController = new AgentController(contextManager, specManager, hookManager);
  });

  describe('Complete Spec Creation Flow', () => {
    /**
     * Tests that creating a spec generates the correct directory structure
     * with all three required files (requirements.md, design.md, tasks.md)
     * 
     * **Validates: Requirements 1.1**
     */
    it('should create spec with complete directory structure', async () => {
      const specName = 'test-feature';
      
      // Create the spec
      const spec = await specManager.createSpec(specName);
      
      // Verify spec object
      expect(spec.name).toBe(specName);
      expect(spec.path).toBe(`.kiro/specs/${specName}`);
      
      // Verify all three files exist
      expect(await fs.exists(`.kiro/specs/${specName}/requirements.md`)).toBe(true);
      expect(await fs.exists(`.kiro/specs/${specName}/design.md`)).toBe(true);
      expect(await fs.exists(`.kiro/specs/${specName}/tasks.md`)).toBe(true);
      
      // Verify files have content
      const requirements = await fs.readFile(`.kiro/specs/${specName}/requirements.md`);
      const design = await fs.readFile(`.kiro/specs/${specName}/design.md`);
      const tasks = await fs.readFile(`.kiro/specs/${specName}/tasks.md`);
      
      expect(requirements).toContain('# Requirements Document');
      expect(design).toContain('# Design Document');
      expect(tasks).toContain('# Implementation Plan');
    });

    /**
     * Tests that specs can be loaded after creation with all documents
     */
    it('should load created spec with all documents', async () => {
      const specName = 'loadable-feature';
      
      // Create and then load
      await specManager.createSpec(specName);
      const loadedSpec = await specManager.loadSpec(specName);
      
      expect(loadedSpec.name).toBe(specName);
      expect(loadedSpec.requirements).not.toBeNull();
      expect(loadedSpec.design).not.toBeNull();
    });

    /**
     * Tests that multiple specs can be created and listed
     */
    it('should list all created specs', async () => {
      const specNames = ['feature-one', 'feature-two', 'feature-three'];
      
      // Create multiple specs
      for (const name of specNames) {
        await specManager.createSpec(name);
      }
      
      // List all specs
      const specs = await specManager.listSpecs();
      
      expect(specs.length).toBe(3);
      for (const name of specNames) {
        const found = specs.find(s => s.name === name);
        expect(found).toBeDefined();
        expect(found?.hasRequirements).toBe(true);
        expect(found?.hasDesign).toBe(true);
        expect(found?.hasTasks).toBe(true);
      }
    });
  });

  describe('Spec Workflow State Machine', () => {
    /**
     * Tests that workflow starts in requirements phase
     * 
     * **Validates: Requirements 1.3**
     */
    it('should start workflow in requirements phase', () => {
      const specName = 'workflow-test';
      
      const phase = agentController.getWorkflowPhase(specName);
      
      expect(phase).toBe('requirements');
    });

    /**
     * Tests that design phase requires requirements approval
     * 
     * **Validates: Requirements 1.3**
     */
    it('should not allow transition to design without requirements approval', () => {
      const specName = 'approval-test';
      
      // Try to transition to design without approval
      const canTransition = agentController.canTransitionToPhase(specName, 'design');
      
      expect(canTransition).toBe(false);
    });

    /**
     * Tests that approving requirements allows transition to design
     * 
     * **Validates: Requirements 1.3**
     */
    it('should allow transition to design after requirements approval', () => {
      const specName = 'approval-flow';
      
      // Approve requirements
      agentController.approveCurrentPhase(specName);
      
      // Now should be able to transition to design
      const phase = agentController.getWorkflowPhase(specName);
      expect(phase).toBe('design');
      
      // Verify requirements are marked as approved
      expect(agentController.isPhaseApproved(specName, 'requirements')).toBe(true);
    });

    /**
     * Tests that tasks phase requires design approval
     * 
     * **Validates: Requirements 1.4**
     */
    it('should not allow transition to tasks without design approval', () => {
      const specName = 'design-approval-test';
      
      // Approve requirements to get to design phase
      agentController.approveCurrentPhase(specName);
      
      // Try to transition to tasks without design approval
      const canTransition = agentController.canTransitionToPhase(specName, 'tasks');
      
      expect(canTransition).toBe(false);
    });

    /**
     * Tests that approving design allows transition to tasks
     * 
     * **Validates: Requirements 1.4**
     */
    it('should allow transition to tasks after design approval', () => {
      const specName = 'design-flow';
      
      // Approve requirements
      agentController.approveCurrentPhase(specName);
      expect(agentController.getWorkflowPhase(specName)).toBe('design');
      
      // Approve design
      agentController.approveCurrentPhase(specName);
      expect(agentController.getWorkflowPhase(specName)).toBe('tasks');
      
      // Verify design is marked as approved
      expect(agentController.isPhaseApproved(specName, 'design')).toBe(true);
    });

    /**
     * Tests complete workflow: requirements → design → tasks → implementation
     * 
     * **Validates: Requirements 1.3, 1.4, 1.5**
     */
    it('should complete full workflow with all approvals', () => {
      const specName = 'full-workflow';
      
      // Start in requirements
      expect(agentController.getWorkflowPhase(specName)).toBe('requirements');
      
      // Approve requirements → move to design
      agentController.approveCurrentPhase(specName);
      expect(agentController.getWorkflowPhase(specName)).toBe('design');
      expect(agentController.isPhaseApproved(specName, 'requirements')).toBe(true);
      
      // Approve design → move to tasks
      agentController.approveCurrentPhase(specName);
      expect(agentController.getWorkflowPhase(specName)).toBe('tasks');
      expect(agentController.isPhaseApproved(specName, 'design')).toBe(true);
      
      // Approve tasks → move to implementation
      agentController.approveCurrentPhase(specName);
      expect(agentController.getWorkflowPhase(specName)).toBe('implementation');
      expect(agentController.isPhaseApproved(specName, 'tasks')).toBe(true);
    });

    /**
     * Tests that requesting changes resets approval and returns to earlier phase
     * 
     * **Validates: Requirements 1.5**
     */
    it('should reset approval when changes are requested', () => {
      const specName = 'reset-test';
      
      // Progress to design phase
      agentController.approveCurrentPhase(specName);
      expect(agentController.getWorkflowPhase(specName)).toBe('design');
      
      // Request changes to requirements
      agentController.resetPhaseApproval(specName, 'requirements');
      
      // Should be back in requirements phase with approval reset
      expect(agentController.getWorkflowPhase(specName)).toBe('requirements');
      expect(agentController.isPhaseApproved(specName, 'requirements')).toBe(false);
    });

    /**
     * Tests that resetting design approval also resets tasks approval
     * 
     * **Validates: Requirements 1.5**
     */
    it('should cascade reset when earlier phase is reset', () => {
      const specName = 'cascade-reset';
      
      // Progress to tasks phase
      agentController.approveCurrentPhase(specName); // requirements → design
      agentController.approveCurrentPhase(specName); // design → tasks
      expect(agentController.getWorkflowPhase(specName)).toBe('tasks');
      
      // Reset design approval
      agentController.resetPhaseApproval(specName, 'design');
      
      // Should be in design phase, tasks approval should also be reset
      expect(agentController.getWorkflowPhase(specName)).toBe('design');
      expect(agentController.isPhaseApproved(specName, 'design')).toBe(false);
      expect(agentController.isPhaseApproved(specName, 'tasks')).toBe(false);
    });
  });

  describe('Document Updates and Re-approval', () => {
    /**
     * Tests that documents can be updated within a spec
     * 
     * **Validates: Requirements 1.5**
     */
    it('should update spec documents', async () => {
      const specName = 'update-test';
      
      // Create spec
      await specManager.createSpec(specName);
      
      // Update requirements
      const newRequirements = '# Updated Requirements\n\nNew content here.';
      await specManager.updateDocument(specName, 'requirements', newRequirements);
      
      // Verify update
      const spec = await specManager.loadSpec(specName);
      expect(spec.requirements).toBe(newRequirements);
    });

    /**
     * Tests that updating a document doesn't affect other documents
     */
    it('should not affect other documents when updating one', async () => {
      const specName = 'isolated-update';
      
      // Create spec
      await specManager.createSpec(specName);
      
      // Get original design content
      const originalSpec = await specManager.loadSpec(specName);
      const originalDesign = originalSpec.design;
      
      // Update requirements
      await specManager.updateDocument(specName, 'requirements', '# New Requirements');
      
      // Verify design is unchanged
      const updatedSpec = await specManager.loadSpec(specName);
      expect(updatedSpec.design).toBe(originalDesign);
    });
  });

  describe('Context Building with Spec', () => {
    /**
     * Tests that context includes spec documents when spec is specified
     * 
     * **Validates: Requirements 4.1**
     */
    it('should include spec context when building context', async () => {
      const specName = 'context-test';
      
      // Create spec with custom content
      await specManager.createSpec(specName);
      await specManager.updateDocument(specName, 'requirements', '# Test Requirements\n\nTest content.');
      await specManager.updateDocument(specName, 'design', '# Test Design\n\nDesign content.');
      
      // Build context with spec
      const context = await contextManager.buildContext({
        message: 'Test message',
        spec: specName
      });
      
      // Verify spec context is included
      expect(context.specContext).toBeDefined();
      expect(context.specContext?.name).toBe(specName);
      expect(context.specContext?.requirements).toContain('Test Requirements');
      expect(context.specContext?.design).toContain('Test Design');
    });

    /**
     * Tests that context includes current task when task ID is specified
     */
    it('should include current task in context when task ID specified', async () => {
      const specName = 'task-context-test';
      
      // Create spec with tasks
      await specManager.createSpec(specName);
      const tasksContent = `# Implementation Plan

- [ ] 1. First task
  - Task details
  - _Requirements: 1.1_

- [ ] 2. Second task
  - More details
  - _Requirements: 2.1_
`;
      await specManager.updateDocument(specName, 'tasks', tasksContent);
      
      // Build context with spec and task
      const context = await contextManager.buildContext({
        message: 'Execute task',
        spec: specName,
        taskId: '1'
      });
      
      // Verify current task is included
      expect(context.specContext?.currentTask).toBeDefined();
      expect(context.specContext?.currentTask?.id).toBe('1');
      expect(context.specContext?.currentTask?.description).toBe('First task');
    });
  });

  describe('Task Execution Flow', () => {
    /**
     * Tests that task status updates correctly during execution
     */
    it('should update task status during execution', async () => {
      const specName = 'task-execution';
      
      // Create spec with tasks
      await specManager.createSpec(specName);
      const tasksContent = `# Implementation Plan

- [ ] 1. Test task
  - _Requirements: 1.1_
`;
      await specManager.updateDocument(specName, 'tasks', tasksContent);
      
      // Execute task
      const result = await agentController.executeTask(specName, '1');
      
      // Verify execution succeeded
      expect(result.success).toBe(true);
      expect(result.taskId).toBe('1');
      
      // Verify task status was updated to completed
      const spec = await specManager.loadSpec(specName);
      expect(spec.tasks?.[0].status).toBe('completed');
    });

    /**
     * Tests that sub-tasks must be completed before parent task
     */
    it('should enforce sub-task completion before parent', async () => {
      const specName = 'subtask-order';
      
      // Create spec with parent and sub-tasks
      await specManager.createSpec(specName);
      const tasksContent = `# Implementation Plan

- [ ] 1. Parent task
  - [ ] 1.1 Sub-task one
    - _Requirements: 1.1_
  - [ ] 1.2 Sub-task two
    - _Requirements: 1.2_
`;
      await specManager.updateDocument(specName, 'tasks', tasksContent);
      
      // Try to complete parent task - should fail
      await expect(
        specManager.setTaskStatusWithValidation(specName, '1', 'completed')
      ).rejects.toThrow('incomplete sub-tasks');
      
      // Complete sub-tasks first
      await specManager.setTaskStatus(specName, '1.1', 'completed');
      await specManager.setTaskStatus(specName, '1.2', 'completed');
      
      // Now parent can be completed
      await specManager.setTaskStatusWithValidation(specName, '1', 'completed');
      
      const spec = await specManager.loadSpec(specName);
      expect(spec.tasks?.[0].status).toBe('completed');
    });
  });
});
