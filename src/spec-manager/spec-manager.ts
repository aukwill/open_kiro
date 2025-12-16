import type { Spec, SpecSummary, DocType, TaskState, TaskStatus, Task } from '../types/index.js';
import type { IFileSystemAdapter } from '../filesystem/filesystem-adapter.js';

/**
 * Interface for managing specs lifecycle
 */
export interface ISpecManager {
  createSpec(name: string): Promise<Spec>;
  loadSpec(name: string): Promise<Spec>;
  listSpecs(): Promise<SpecSummary[]>;
  updateDocument(specName: string, docType: DocType, content: string): Promise<void>;
  getTaskStatus(specName: string): Promise<TaskStatus[]>;
  setTaskStatus(specName: string, taskId: string, status: TaskState): Promise<void>;
}

/**
 * Default content templates for spec files
 */
const REQUIREMENTS_TEMPLATE = `# Requirements Document

## Introduction

[Summary of the feature/system]

## Glossary

- **Term**: [Definition]

## Requirements

### Requirement 1

**User Story:** As a [role], I want [feature], so that [benefit]

#### Acceptance Criteria

1. WHEN [event], THE [System_Name] SHALL [response]
`;

const DESIGN_TEMPLATE = `# Design Document

## Overview

[High-level description of the design]

## Architecture

[Architecture description]

## Components and Interfaces

[Component descriptions]

## Data Models

[Data model definitions]

## Correctness Properties

[Properties to verify]

## Error Handling

[Error handling strategies]

## Testing Strategy

[Testing approach]
`;

const TASKS_TEMPLATE = `# Implementation Plan

- [ ] 1. First task
  - Task details
  - _Requirements: 1.1_
`;

/**
 * SpecManager implementation
 * Manages the lifecycle of specs including creation, updates, and state tracking
 */
export class SpecManager implements ISpecManager {
  private readonly specsBasePath = '.kiro/specs';
  
  constructor(private readonly fs: IFileSystemAdapter) {}

  /**
   * Validates that a spec name is valid (kebab-case, alphanumeric with hyphens)
   */
  private validateSpecName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Spec name cannot be empty');
    }
    
    // Allow alphanumeric characters and hyphens, must start with letter
    const validPattern = /^[a-z][a-z0-9-]*$/;
    if (!validPattern.test(name)) {
      throw new Error('Spec name must be kebab-case (lowercase letters, numbers, and hyphens, starting with a letter)');
    }
  }

  /**
   * Gets the path to a spec directory
   */
  private getSpecPath(name: string): string {
    return `${this.specsBasePath}/${name}`;
  }

  /**
   * Gets the path to a specific document within a spec
   */
  private getDocPath(specName: string, docType: DocType): string {
    return `${this.getSpecPath(specName)}/${docType}.md`;
  }

  /**
   * Create a new spec with the given name
   * Creates directory structure with requirements.md, design.md, and tasks.md
   */
  async createSpec(name: string): Promise<Spec> {
    this.validateSpecName(name);
    
    const specPath = this.getSpecPath(name);
    
    // Check if spec already exists
    if (await this.fs.exists(specPath)) {
      throw new Error(`Spec '${name}' already exists`);
    }

    // Create the spec directory
    await this.fs.mkdir(specPath);

    // Create the three required files
    await this.fs.writeFile(this.getDocPath(name, 'requirements'), REQUIREMENTS_TEMPLATE);
    await this.fs.writeFile(this.getDocPath(name, 'design'), DESIGN_TEMPLATE);
    await this.fs.writeFile(this.getDocPath(name, 'tasks'), TASKS_TEMPLATE);

    return {
      name,
      path: specPath,
      requirements: REQUIREMENTS_TEMPLATE,
      design: DESIGN_TEMPLATE,
      tasks: null // Will be parsed when loaded
    };
  }

  /**
   * Load an existing spec by name
   */
  async loadSpec(name: string): Promise<Spec> {
    const specPath = this.getSpecPath(name);
    
    if (!await this.fs.exists(specPath)) {
      throw new Error(`Spec '${name}' not found`);
    }

    const [requirements, design, tasksContent] = await Promise.all([
      this.safeReadFile(this.getDocPath(name, 'requirements')),
      this.safeReadFile(this.getDocPath(name, 'design')),
      this.safeReadFile(this.getDocPath(name, 'tasks'))
    ]);

    const tasks = tasksContent ? this.parseTasksMarkdown(tasksContent) : null;

    return {
      name,
      path: specPath,
      requirements,
      design,
      tasks
    };
  }

  /**
   * List all specs in the workspace
   */
  async listSpecs(): Promise<SpecSummary[]> {
    if (!await this.fs.exists(this.specsBasePath)) {
      return [];
    }

    const entries = await this.fs.readdir(this.specsBasePath);
    const summaries: SpecSummary[] = [];

    for (const entry of entries) {
      const specPath = `${this.specsBasePath}/${entry}`;
      
      const [hasRequirements, hasDesign, hasTasks] = await Promise.all([
        this.fs.exists(`${specPath}/requirements.md`),
        this.fs.exists(`${specPath}/design.md`),
        this.fs.exists(`${specPath}/tasks.md`)
      ]);

      // Only include if it has at least one spec file
      if (hasRequirements || hasDesign || hasTasks) {
        summaries.push({
          name: entry,
          path: specPath,
          hasRequirements,
          hasDesign,
          hasTasks
        });
      }
    }

    return summaries;
  }

  /**
   * Update a specific document within a spec
   */
  async updateDocument(specName: string, docType: DocType, content: string): Promise<void> {
    const specPath = this.getSpecPath(specName);
    
    if (!await this.fs.exists(specPath)) {
      throw new Error(`Spec '${specName}' not found`);
    }

    await this.fs.writeFile(this.getDocPath(specName, docType), content);
  }

  /**
   * Get task status for a spec
   */
  async getTaskStatus(specName: string): Promise<TaskStatus[]> {
    const spec = await this.loadSpec(specName);
    
    if (!spec.tasks) {
      return [];
    }

    return this.tasksToTaskStatus(spec.tasks);
  }

  /**
   * Update task status in the tasks.md file
   */
  async setTaskStatus(specName: string, taskId: string, status: TaskState): Promise<void> {
    const tasksPath = this.getDocPath(specName, 'tasks');
    
    if (!await this.fs.exists(tasksPath)) {
      throw new Error(`Tasks file not found for spec '${specName}'`);
    }

    const content = await this.fs.readFile(tasksPath);
    const updatedContent = this.updateTaskStatusInMarkdown(content, taskId, status);
    await this.fs.writeFile(tasksPath, updatedContent);
  }

  /**
   * Safely read a file, returning null if it doesn't exist
   */
  private async safeReadFile(path: string): Promise<string | null> {
    try {
      return await this.fs.readFile(path);
    } catch {
      return null;
    }
  }

  /**
   * Parse tasks.md content into structured Task objects
   */
  parseTasksMarkdown(content: string): Task[] {
    const lines = content.split('\n');
    const tasks: Task[] = [];
    let currentTask: Task | null = null;
    let currentSubTask: Task | null = null;

    for (const line of lines) {
      // Match top-level task: "- [ ] 1. Task description" or "- [x] 1. Task description"
      const topLevelMatch = line.match(/^- \[([ x-])\] (\d+\.?\s*.+)$/);
      if (topLevelMatch) {
        const status = this.parseCheckboxStatus(topLevelMatch[1]);
        const fullText = topLevelMatch[2].trim();
        const { id, description } = this.parseTaskIdAndDescription(fullText);
        
        currentTask = {
          id,
          description,
          status,
          subTasks: [],
          requirements: []
        };
        tasks.push(currentTask);
        currentSubTask = null;
        continue;
      }

      // Match sub-task: "  - [ ] 1.1 Sub-task description"
      const subTaskMatch = line.match(/^  - \[([ x-])\]\*? (\d+\.\d+\.?\s*.+)$/);
      if (subTaskMatch && currentTask) {
        const status = this.parseCheckboxStatus(subTaskMatch[1]);
        const fullText = subTaskMatch[2].trim();
        const { id, description } = this.parseTaskIdAndDescription(fullText);
        
        currentSubTask = {
          id,
          description,
          status,
          requirements: []
        };
        currentTask.subTasks = currentTask.subTasks || [];
        currentTask.subTasks.push(currentSubTask);
        continue;
      }

      // Match requirements reference: "_Requirements: 1.1, 1.2_"
      const reqMatch = line.match(/_Requirements?:\s*([^_]+)_/);
      if (reqMatch) {
        const reqs = reqMatch[1].split(',').map(r => r.trim());
        if (currentSubTask) {
          currentSubTask.requirements = reqs;
        } else if (currentTask) {
          currentTask.requirements = reqs;
        }
      }
    }

    return tasks;
  }

  /**
   * Parse checkbox status character to TaskState
   */
  private parseCheckboxStatus(char: string): TaskState {
    switch (char) {
      case 'x':
        return 'completed';
      case '-':
        return 'in_progress';
      default:
        return 'not_started';
    }
  }

  /**
   * Get checkbox character from TaskState
   */
  private getCheckboxChar(status: TaskState): string {
    switch (status) {
      case 'completed':
        return 'x';
      case 'in_progress':
        return '-';
      default:
        return ' ';
    }
  }

  /**
   * Parse task ID and description from task text
   */
  private parseTaskIdAndDescription(text: string): { id: string; description: string } {
    // Match patterns like "1. Description" or "1.1 Description" or "1.1. Description"
    const match = text.match(/^(\d+(?:\.\d+)?\.?)\s*(.*)$/);
    if (match) {
      return {
        id: match[1].replace(/\.$/, ''), // Remove trailing dot
        description: match[2]
      };
    }
    return { id: '', description: text };
  }

  /**
   * Update task status in markdown content
   */
  private updateTaskStatusInMarkdown(content: string, taskId: string, status: TaskState): string {
    const lines = content.split('\n');
    const checkboxChar = this.getCheckboxChar(status);
    
    // Normalize taskId (remove trailing dots)
    const normalizedTaskId = taskId.replace(/\.$/, '');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for top-level task
      const topLevelMatch = line.match(/^(- \[)([ x-])(\]\*? )(\d+\.?\s*.+)$/);
      if (topLevelMatch) {
        const { id } = this.parseTaskIdAndDescription(topLevelMatch[4].trim());
        if (id === normalizedTaskId) {
          lines[i] = `${topLevelMatch[1]}${checkboxChar}${topLevelMatch[3]}${topLevelMatch[4]}`;
          return lines.join('\n');
        }
      }
      
      // Check for sub-task
      const subTaskMatch = line.match(/^(  - \[)([ x-])(\]\*? )(\d+\.\d+\.?\s*.+)$/);
      if (subTaskMatch) {
        const { id } = this.parseTaskIdAndDescription(subTaskMatch[4].trim());
        if (id === normalizedTaskId) {
          lines[i] = `${subTaskMatch[1]}${checkboxChar}${subTaskMatch[3]}${subTaskMatch[4]}`;
          return lines.join('\n');
        }
      }
    }
    
    throw new Error(`Task '${taskId}' not found in tasks.md`);
  }

  /**
   * Convert Task array to TaskStatus array
   */
  private tasksToTaskStatus(tasks: Task[]): TaskStatus[] {
    return tasks.map(task => ({
      taskId: task.id,
      status: task.status,
      subTasks: task.subTasks ? this.tasksToTaskStatus(task.subTasks) : undefined
    }));
  }

  /**
   * Check if a parent task can be marked as completed
   * Returns false if any sub-task is not completed
   */
  canCompleteParentTask(task: Task): boolean {
    if (!task.subTasks || task.subTasks.length === 0) {
      return true;
    }
    return task.subTasks.every(subTask => subTask.status === 'completed');
  }

  /**
   * Set task status with sub-task ordering constraint validation
   * Throws error if trying to complete a parent task with incomplete sub-tasks
   */
  async setTaskStatusWithValidation(specName: string, taskId: string, status: TaskState): Promise<void> {
    if (status === 'completed') {
      const spec = await this.loadSpec(specName);
      if (spec.tasks) {
        const task = this.findTaskById(spec.tasks, taskId);
        if (task && !this.canCompleteParentTask(task)) {
          throw new Error(`Cannot complete task '${taskId}' because it has incomplete sub-tasks`);
        }
      }
    }
    
    await this.setTaskStatus(specName, taskId, status);
  }

  /**
   * Find a task by ID in the task tree
   */
  private findTaskById(tasks: Task[], taskId: string): Task | null {
    for (const task of tasks) {
      if (task.id === taskId) {
        return task;
      }
      if (task.subTasks) {
        const found = this.findTaskById(task.subTasks, taskId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }
}
