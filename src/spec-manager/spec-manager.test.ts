import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { SpecManager } from './spec-manager.js';
import { InMemoryFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import type { TaskState } from '../types/index.js';

describe('SpecManager', () => {
  let fs: InMemoryFileSystemAdapter;
  let specManager: SpecManager;

  beforeEach(() => {
    fs = new InMemoryFileSystemAdapter();
    specManager = new SpecManager(fs);
  });

  /**
   * **Feature: open-kiro, Property 1: Spec Directory Creation**
   * **Validates: Requirements 1.1**
   * 
   * *For any* valid feature name, when a spec is created, the system should create
   * a directory at `.kiro/specs/{feature_name}/` containing exactly three files:
   * `requirements.md`, `design.md`, and `tasks.md`.
   */
  describe('Property 1: Spec Directory Creation', () => {
    // Generator for valid spec names (kebab-case: lowercase letters, numbers, hyphens, starting with letter)
    const validSpecNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 50 }
    ).filter(s => 
      /^[a-z][a-z0-9-]*$/.test(s) && // Must start with letter, only lowercase, numbers, hyphens
      !s.includes('--') // No consecutive hyphens
    );

    it('should create spec directory with exactly three required files', async () => {
      await fc.assert(
        fc.asyncProperty(
          validSpecNameArb,
          async (specName) => {
            // Clear filesystem for each iteration
            fs.clear();

            // Create the spec
            const spec = await specManager.createSpec(specName);

            // Verify the spec object
            expect(spec.name).toBe(specName);
            expect(spec.path).toBe(`.kiro/specs/${specName}`);

            // Verify all three files exist
            const requirementsExists = await fs.exists(`.kiro/specs/${specName}/requirements.md`);
            const designExists = await fs.exists(`.kiro/specs/${specName}/design.md`);
            const tasksExists = await fs.exists(`.kiro/specs/${specName}/tasks.md`);

            expect(requirementsExists).toBe(true);
            expect(designExists).toBe(true);
            expect(tasksExists).toBe(true);

            // Verify directory contains exactly these three files
            const files = await fs.readdir(`.kiro/specs/${specName}`);
            expect(files.sort()).toEqual(['design.md', 'requirements.md', 'tasks.md'].sort());
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should create files with valid markdown content', async () => {
      await fc.assert(
        fc.asyncProperty(
          validSpecNameArb,
          async (specName) => {
            fs.clear();

            await specManager.createSpec(specName);

            // Read and verify each file has content
            const requirements = await fs.readFile(`.kiro/specs/${specName}/requirements.md`);
            const design = await fs.readFile(`.kiro/specs/${specName}/design.md`);
            const tasks = await fs.readFile(`.kiro/specs/${specName}/tasks.md`);

            // Each file should have non-empty content
            expect(requirements.length).toBeGreaterThan(0);
            expect(design.length).toBeGreaterThan(0);
            expect(tasks.length).toBeGreaterThan(0);

            // Each file should start with a markdown header
            expect(requirements.startsWith('#')).toBe(true);
            expect(design.startsWith('#')).toBe(true);
            expect(tasks.startsWith('#')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject invalid spec names', async () => {
      // Test various invalid spec names
      const invalidNames = [
        '', // empty
        '123-test', // starts with number
        'Test-Name', // uppercase
        'test_name', // underscore
        'test name', // space
        '-test', // starts with hyphen
      ];

      for (const name of invalidNames) {
        await expect(specManager.createSpec(name)).rejects.toThrow();
      }
    });

    it('should reject duplicate spec creation', async () => {
      await fc.assert(
        fc.asyncProperty(
          validSpecNameArb,
          async (specName) => {
            fs.clear();

            // Create spec first time - should succeed
            await specManager.createSpec(specName);

            // Create same spec again - should fail
            await expect(specManager.createSpec(specName)).rejects.toThrow(`Spec '${specName}' already exists`);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Spec Loading and Listing', () => {
    const validSpecNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 30 }
    ).filter((s: string) => /^[a-z][a-z0-9-]*$/.test(s) && !s.includes('--'));

    it('should load a created spec with all documents', async () => {
      await fc.assert(
        fc.asyncProperty(
          validSpecNameArb,
          async (specName) => {
            fs.clear();

            // Create spec
            await specManager.createSpec(specName);

            // Load spec
            const loadedSpec = await specManager.loadSpec(specName);

            expect(loadedSpec.name).toBe(specName);
            expect(loadedSpec.path).toBe(`.kiro/specs/${specName}`);
            expect(loadedSpec.requirements).not.toBeNull();
            expect(loadedSpec.design).not.toBeNull();
            // tasks is parsed into Task[] or null
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should throw when loading non-existent spec', async () => {
      await expect(specManager.loadSpec('nonexistent-spec')).rejects.toThrow("Spec 'nonexistent-spec' not found");
    });

    it('should list all created specs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validSpecNameArb, { minLength: 1, maxLength: 5 })
            .filter(names => new Set(names).size === names.length), // unique names
          async (specNames) => {
            fs.clear();

            // Create multiple specs
            for (const name of specNames) {
              await specManager.createSpec(name);
            }

            // List specs
            const specs = await specManager.listSpecs();

            expect(specs.length).toBe(specNames.length);
            
            for (const name of specNames) {
              const found = specs.find(s => s.name === name);
              expect(found).toBeDefined();
              expect(found?.hasRequirements).toBe(true);
              expect(found?.hasDesign).toBe(true);
              expect(found?.hasTasks).toBe(true);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should return empty list when no specs exist', async () => {
      fs.clear();
      const specs = await specManager.listSpecs();
      expect(specs).toEqual([]);
    });

    it('should parse tasks.md into structured Task objects', async () => {
      fs.clear();

      // Create a spec with custom tasks content
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. First task
  - Task details
  - _Requirements: 1.1_

- [-] 2. Second task in progress
  - [ ] 2.1 Sub-task one
    - _Requirements: 2.1_
  - [x] 2.2 Sub-task two completed
    - _Requirements: 2.2_

- [x] 3. Completed task
  - _Requirements: 3.1_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      const spec = await specManager.loadSpec('test-spec');

      expect(spec.tasks).not.toBeNull();
      expect(spec.tasks?.length).toBe(3);

      // First task
      expect(spec.tasks?.[0].id).toBe('1');
      expect(spec.tasks?.[0].description).toBe('First task');
      expect(spec.tasks?.[0].status).toBe('not_started');

      // Second task (in progress with sub-tasks)
      expect(spec.tasks?.[1].id).toBe('2');
      expect(spec.tasks?.[1].status).toBe('in_progress');
      expect(spec.tasks?.[1].subTasks?.length).toBe(2);
      expect(spec.tasks?.[1].subTasks?.[0].id).toBe('2.1');
      expect(spec.tasks?.[1].subTasks?.[0].status).toBe('not_started');
      expect(spec.tasks?.[1].subTasks?.[1].id).toBe('2.2');
      expect(spec.tasks?.[1].subTasks?.[1].status).toBe('completed');

      // Third task (completed)
      expect(spec.tasks?.[2].id).toBe('3');
      expect(spec.tasks?.[2].status).toBe('completed');
    });
  });

  /**
   * **Feature: open-kiro, Property 13: Task Status Updates**
   * **Validates: Requirements 4.2, 4.3**
   * 
   * *For any* task, starting execution should set status to "in_progress",
   * and completing execution should set status to "completed".
   * The tasks.md file should reflect these changes.
   */
  describe('Property 13: Task Status Updates', () => {
    it('should update task status from not_started to in_progress', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. First task
  - _Requirements: 1.1_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Update status to in_progress
      await specManager.setTaskStatus('test-spec', '1', 'in_progress');

      // Verify the file was updated
      const updatedContent = await fs.readFile('.kiro/specs/test-spec/tasks.md');
      expect(updatedContent).toContain('- [-] 1. First task');

      // Verify loading reflects the change
      const spec = await specManager.loadSpec('test-spec');
      expect(spec.tasks?.[0].status).toBe('in_progress');
    });

    it('should update task status from in_progress to completed', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [-] 1. First task
  - _Requirements: 1.1_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Update status to completed
      await specManager.setTaskStatus('test-spec', '1', 'completed');

      // Verify the file was updated
      const updatedContent = await fs.readFile('.kiro/specs/test-spec/tasks.md');
      expect(updatedContent).toContain('- [x] 1. First task');

      // Verify loading reflects the change
      const spec = await specManager.loadSpec('test-spec');
      expect(spec.tasks?.[0].status).toBe('completed');
    });

    it('should update sub-task status independently', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. Parent task
  - [ ] 1.1 Sub-task one
    - _Requirements: 1.1_
  - [ ] 1.2 Sub-task two
    - _Requirements: 1.2_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Update sub-task 1.1 to in_progress
      await specManager.setTaskStatus('test-spec', '1.1', 'in_progress');

      // Verify only sub-task 1.1 was updated
      const spec = await specManager.loadSpec('test-spec');
      expect(spec.tasks?.[0].status).toBe('not_started');
      expect(spec.tasks?.[0].subTasks?.[0].status).toBe('in_progress');
      expect(spec.tasks?.[0].subTasks?.[1].status).toBe('not_started');
    });

    it('should preserve task status through round-trip', async () => {
      const statuses: TaskState[] = ['not_started', 'in_progress', 'completed'];
      
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...statuses),
          async (targetStatus) => {
            fs.clear();
            await specManager.createSpec('test-spec');
            
            const tasksContent = `# Implementation Plan

- [ ] 1. Test task
  - _Requirements: 1.1_
`;
            await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

            // Set status
            await specManager.setTaskStatus('test-spec', '1', targetStatus);

            // Load and verify
            const spec = await specManager.loadSpec('test-spec');
            expect(spec.tasks?.[0].status).toBe(targetStatus);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should throw when updating non-existent task', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');

      await expect(
        specManager.setTaskStatus('test-spec', '999', 'completed')
      ).rejects.toThrow("Task '999' not found");
    });

    it('should get task status for all tasks', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. First task
  - _Requirements: 1.1_

- [-] 2. Second task
  - [x] 2.1 Completed sub-task
    - _Requirements: 2.1_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      const statuses = await specManager.getTaskStatus('test-spec');

      expect(statuses.length).toBe(2);
      expect(statuses[0].taskId).toBe('1');
      expect(statuses[0].status).toBe('not_started');
      expect(statuses[1].taskId).toBe('2');
      expect(statuses[1].status).toBe('in_progress');
      expect(statuses[1].subTasks?.[0].taskId).toBe('2.1');
      expect(statuses[1].subTasks?.[0].status).toBe('completed');
    });
  });

  /**
   * **Feature: open-kiro, Property 14: Sub-Task Ordering Constraint**
   * **Validates: Requirements 4.4**
   * 
   * *For any* task with sub-tasks, the parent task status should not be "completed"
   * while any sub-task status is not "completed".
   */
  describe('Property 14: Sub-Task Ordering Constraint', () => {
    it('should prevent completing parent task with incomplete sub-tasks', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. Parent task
  - [ ] 1.1 Sub-task one
    - _Requirements: 1.1_
  - [ ] 1.2 Sub-task two
    - _Requirements: 1.2_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Try to complete parent task - should fail
      await expect(
        specManager.setTaskStatusWithValidation('test-spec', '1', 'completed')
      ).rejects.toThrow("Cannot complete task '1' because it has incomplete sub-tasks");
    });

    it('should allow completing parent task when all sub-tasks are completed', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. Parent task
  - [x] 1.1 Sub-task one
    - _Requirements: 1.1_
  - [x] 1.2 Sub-task two
    - _Requirements: 1.2_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Complete parent task - should succeed
      await specManager.setTaskStatusWithValidation('test-spec', '1', 'completed');

      const spec = await specManager.loadSpec('test-spec');
      expect(spec.tasks?.[0].status).toBe('completed');
    });

    it('should allow setting parent task to in_progress regardless of sub-task status', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. Parent task
  - [ ] 1.1 Sub-task one
    - _Requirements: 1.1_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Set parent to in_progress - should succeed
      await specManager.setTaskStatusWithValidation('test-spec', '1', 'in_progress');

      const spec = await specManager.loadSpec('test-spec');
      expect(spec.tasks?.[0].status).toBe('in_progress');
    });

    it('should allow completing task without sub-tasks', async () => {
      fs.clear();
      await specManager.createSpec('test-spec');
      
      const tasksContent = `# Implementation Plan

- [ ] 1. Task without sub-tasks
  - _Requirements: 1.1_
`;
      await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

      // Complete task - should succeed
      await specManager.setTaskStatusWithValidation('test-spec', '1', 'completed');

      const spec = await specManager.loadSpec('test-spec');
      expect(spec.tasks?.[0].status).toBe('completed');
    });

    it('should validate sub-task ordering for any combination of incomplete sub-tasks', async () => {
      // Property test: for any parent task with at least one incomplete sub-task,
      // completing the parent should fail
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
          async (subTaskCompletions) => {
            // Skip if all sub-tasks are completed (that's a valid completion case)
            if (subTaskCompletions.every(c => c)) {
              return;
            }

            fs.clear();
            await specManager.createSpec('test-spec');
            
            // Build tasks content with sub-tasks
            let tasksContent = `# Implementation Plan

- [ ] 1. Parent task
`;
            subTaskCompletions.forEach((completed, index) => {
              const checkbox = completed ? 'x' : ' ';
              tasksContent += `  - [${checkbox}] 1.${index + 1} Sub-task ${index + 1}
    - _Requirements: 1.${index + 1}_
`;
            });

            await fs.writeFile('.kiro/specs/test-spec/tasks.md', tasksContent);

            // Try to complete parent - should fail because at least one sub-task is incomplete
            await expect(
              specManager.setTaskStatusWithValidation('test-spec', '1', 'completed')
            ).rejects.toThrow("Cannot complete task '1' because it has incomplete sub-tasks");
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});