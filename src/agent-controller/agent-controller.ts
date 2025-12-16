import type { IContextManager } from '../context-manager/context-manager.js';
import type { ISpecManager } from '../spec-manager/spec-manager.js';
import type { IHookManager } from '../hook-manager/hook-manager.js';
import type {
  UserMessage,
  AgentResponse,
  CodeChange,
  AgentEvent,
  EventHandler,
  Task
} from '../types/index.js';

/**
 * Spec workflow phases
 */
export type SpecPhase = 'requirements' | 'design' | 'tasks' | 'implementation';

/**
 * Spec workflow state
 */
export interface SpecWorkflowState {
  specName: string;
  currentPhase: SpecPhase;
  requirementsApproved: boolean;
  designApproved: boolean;
  tasksApproved: boolean;
}

/**
 * Pending code change with approval status
 */
export interface PendingCodeChange {
  id: string;
  changes: CodeChange[];
  approved: boolean;
  timestamp: Date;
}

/**
 * LLM Provider interface for generating responses
 */
export interface ILLMProvider {
  generateResponse(context: string, message: string): Promise<string>;
}

/**
 * Interface for the Agent Controller
 */
export interface IAgentController {
  processMessage(message: UserMessage): Promise<AgentResponse>;
  executeTask(specName: string, taskId: string): Promise<TaskResult>;
  getSession(): Session;
  on(event: AgentEvent, handler: EventHandler): void;
  off(event: AgentEvent, handler: EventHandler): void;
}


/**
 * Task execution result
 */
export interface TaskResult {
  success: boolean;
  taskId: string;
  output?: string;
  error?: string;
  codeChanges?: CodeChange[];
}

/**
 * Session state
 */
export interface Session {
  id: string;
  startTime: Date;
  specWorkflows: Map<string, SpecWorkflowState>;
  pendingChanges: PendingCodeChange[];
}

/**
 * AgentController implementation
 * Central orchestrator that processes user messages and coordinates responses
 */
export class AgentController implements IAgentController {
  private contextManager: IContextManager;
  private specManager: ISpecManager;
  private hookManager: IHookManager;
  private llmProvider?: ILLMProvider;
  
  private session: Session;
  private eventHandlers: Map<AgentEvent, Set<EventHandler>> = new Map();
  private changeIdCounter = 0;

  constructor(
    contextManager: IContextManager,
    specManager: ISpecManager,
    hookManager: IHookManager,
    llmProvider?: ILLMProvider
  ) {
    this.contextManager = contextManager;
    this.specManager = specManager;
    this.hookManager = hookManager;
    this.llmProvider = llmProvider;
    
    this.session = {
      id: this.generateSessionId(),
      startTime: new Date(),
      specWorkflows: new Map(),
      pendingChanges: []
    };
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate a unique change ID
   */
  private generateChangeId(): string {
    return `change-${++this.changeIdCounter}`;
  }

  /**
   * Process a user message and generate a response
   */
  async processMessage(message: UserMessage): Promise<AgentResponse> {
    // Emit message_sent event
    this.emit('message_sent', { message });

    // Trigger message_sent hooks
    await this.hookManager.triggerByEvent('message_sent', { message: message.content });

    try {
      // Build context for the request
      const context = await this.contextManager.buildContext({
        message: message.content,
        spec: message.context?.spec,
        taskId: message.context?.taskId,
        explicitFiles: message.attachments?.filter(a => a.type === 'file').map(a => a.path),
        explicitFolders: message.attachments?.filter(a => a.type === 'folder').map(a => a.path),
        manualSteering: message.context?.manualSteering
      });

      // Generate response using LLM if available
      let responseContent = 'Message processed successfully.';
      if (this.llmProvider) {
        const contextString = this.buildContextString(context);
        responseContent = await this.llmProvider.generateResponse(contextString, message.content);
      }

      // Parse code changes from response (simplified - in real implementation would parse LLM output)
      const codeChanges = this.parseCodeChanges(responseContent);

      // If there are code changes, queue them for approval
      if (codeChanges.length > 0) {
        const pendingChange: PendingCodeChange = {
          id: this.generateChangeId(),
          changes: codeChanges,
          approved: false,
          timestamp: new Date()
        };
        this.session.pendingChanges.push(pendingChange);

        // Emit response_received event
        this.emit('response_received', { response: responseContent, pendingChangeId: pendingChange.id });

        return {
          content: responseContent,
          codeChanges,
          status: 'pending_approval'
        };
      }

      // Emit response_received event
      this.emit('response_received', { response: responseContent });

      return {
        content: responseContent,
        status: 'success'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: `Error processing message: ${errorMessage}`,
        status: 'error'
      };
    }
  }


  /**
   * Execute a specific task from a spec
   */
  async executeTask(specName: string, taskId: string): Promise<TaskResult> {
    // Emit task_started event
    this.emit('task_started', { specName, taskId });

    try {
      // Update task status to in_progress
      await this.specManager.setTaskStatus(specName, taskId, 'in_progress');

      // Build context with spec and task
      const context = await this.contextManager.buildContext({
        message: `Execute task ${taskId}`,
        spec: specName,
        taskId
      });

      // Generate task implementation using LLM if available
      let output = `Task ${taskId} executed successfully.`;
      let codeChanges: CodeChange[] = [];

      if (this.llmProvider) {
        const contextString = this.buildContextString(context);
        const taskPrompt = this.buildTaskPrompt(context.specContext?.currentTask);
        output = await this.llmProvider.generateResponse(contextString, taskPrompt);
        codeChanges = this.parseCodeChanges(output);
      }

      // If there are code changes, queue them for approval
      if (codeChanges.length > 0) {
        const pendingChange: PendingCodeChange = {
          id: this.generateChangeId(),
          changes: codeChanges,
          approved: false,
          timestamp: new Date()
        };
        this.session.pendingChanges.push(pendingChange);

        return {
          success: true,
          taskId,
          output,
          codeChanges
        };
      }

      // Update task status to completed
      await this.specManager.setTaskStatus(specName, taskId, 'completed');

      // Emit task_completed event
      this.emit('task_completed', { specName, taskId });

      // Trigger agent_complete hooks
      await this.hookManager.triggerByEvent('agent_complete', { specName, taskId });

      return {
        success: true,
        taskId,
        output
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        taskId,
        error: errorMessage
      };
    }
  }

  /**
   * Get current session state
   */
  getSession(): Session {
    return this.session;
  }

  /**
   * Register an event handler
   */
  on(event: AgentEvent, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister an event handler
   */
  off(event: AgentEvent, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit an event to all registered handlers
   */
  private emit(event: AgentEvent, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  /**
   * Build a context string from AgentContext for LLM
   */
  private buildContextString(context: import('../types/index.js').AgentContext): string {
    const parts: string[] = [];

    parts.push(context.systemPrompt);

    if (context.steeringContent) {
      parts.push('\n--- Steering ---\n' + context.steeringContent);
    }

    if (context.specContext) {
      parts.push('\n--- Spec Context ---');
      if (context.specContext.requirements) {
        parts.push('Requirements:\n' + context.specContext.requirements);
      }
      if (context.specContext.design) {
        parts.push('Design:\n' + context.specContext.design);
      }
      if (context.specContext.currentTask) {
        parts.push('Current Task:\n' + JSON.stringify(context.specContext.currentTask, null, 2));
      }
    }

    if (context.fileContents.length > 0) {
      parts.push('\n--- File Contents ---');
      for (const file of context.fileContents) {
        parts.push(`File: ${file.path}\n${file.content}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Build a task execution prompt
   */
  private buildTaskPrompt(task?: Task): string {
    if (!task) {
      return 'Execute the current task.';
    }
    return `Execute task ${task.id}: ${task.description}\nRequirements: ${task.requirements?.join(', ') || 'None specified'}`;
  }

  /**
   * Parse code changes from LLM response (simplified implementation)
   */
  private parseCodeChanges(_response: string): CodeChange[] {
    // In a real implementation, this would parse code blocks and file paths from the LLM response
    // For now, return empty array - code changes would be extracted from structured LLM output
    return [];
  }


  // ============================================
  // Code Change Approval Gate (Task 10.2)
  // ============================================

  /**
   * Get all pending code changes awaiting approval
   */
  getPendingChanges(): PendingCodeChange[] {
    return this.session.pendingChanges.filter(c => !c.approved);
  }

  /**
   * Approve a pending code change by ID
   * Returns true if the change was found and approved
   */
  async approveChange(changeId: string): Promise<boolean> {
    const change = this.session.pendingChanges.find(c => c.id === changeId);
    if (!change) {
      return false;
    }

    change.approved = true;
    return true;
  }

  /**
   * Apply approved changes to the filesystem
   * Only applies changes that have been approved
   */
  async applyApprovedChanges(fs: import('../filesystem/filesystem-adapter.js').IFileSystemAdapter): Promise<CodeChange[]> {
    const appliedChanges: CodeChange[] = [];

    for (const pending of this.session.pendingChanges) {
      if (!pending.approved) {
        continue;
      }

      for (const change of pending.changes) {
        try {
          switch (change.operation) {
            case 'create':
            case 'update':
              await fs.writeFile(change.path, change.content);
              appliedChanges.push(change);
              break;
            case 'delete':
              await fs.delete(change.path);
              appliedChanges.push(change);
              break;
          }
        } catch {
          // Log error but continue with other changes
        }
      }
    }

    // Remove applied changes from pending
    this.session.pendingChanges = this.session.pendingChanges.filter(c => !c.approved);

    return appliedChanges;
  }

  /**
   * Reject a pending code change by ID
   * Returns true if the change was found and rejected
   */
  rejectChange(changeId: string): boolean {
    const index = this.session.pendingChanges.findIndex(c => c.id === changeId);
    if (index === -1) {
      return false;
    }

    this.session.pendingChanges.splice(index, 1);
    return true;
  }

  /**
   * Queue code changes for approval (used by external callers)
   */
  queueCodeChanges(changes: CodeChange[]): string {
    const pendingChange: PendingCodeChange = {
      id: this.generateChangeId(),
      changes,
      approved: false,
      timestamp: new Date()
    };
    this.session.pendingChanges.push(pendingChange);
    return pendingChange.id;
  }

  // ============================================
  // Spec Workflow State Machine (Task 10.4)
  // ============================================

  /**
   * Initialize or get workflow state for a spec
   */
  getOrCreateWorkflowState(specName: string): SpecWorkflowState {
    let state = this.session.specWorkflows.get(specName);
    if (!state) {
      state = {
        specName,
        currentPhase: 'requirements',
        requirementsApproved: false,
        designApproved: false,
        tasksApproved: false
      };
      this.session.specWorkflows.set(specName, state);
    }
    return state;
  }

  /**
   * Get the current phase of a spec workflow
   */
  getWorkflowPhase(specName: string): SpecPhase {
    return this.getOrCreateWorkflowState(specName).currentPhase;
  }

  /**
   * Check if a phase transition is allowed
   * Enforces approval gates between phases
   */
  canTransitionToPhase(specName: string, targetPhase: SpecPhase): boolean {
    const state = this.getOrCreateWorkflowState(specName);

    switch (targetPhase) {
      case 'requirements':
        // Can always go back to requirements
        return true;
      case 'design':
        // Can only go to design if requirements are approved
        return state.requirementsApproved;
      case 'tasks':
        // Can only go to tasks if design is approved
        return state.designApproved;
      case 'implementation':
        // Can only go to implementation if tasks are approved
        return state.tasksApproved;
      default:
        return false;
    }
  }

  /**
   * Attempt to transition to a new phase
   * Returns true if transition was successful
   */
  transitionToPhase(specName: string, targetPhase: SpecPhase): boolean {
    if (!this.canTransitionToPhase(specName, targetPhase)) {
      return false;
    }

    const state = this.getOrCreateWorkflowState(specName);
    state.currentPhase = targetPhase;
    return true;
  }

  /**
   * Approve the current phase and advance to the next
   */
  approveCurrentPhase(specName: string): boolean {
    const state = this.getOrCreateWorkflowState(specName);

    switch (state.currentPhase) {
      case 'requirements':
        state.requirementsApproved = true;
        state.currentPhase = 'design';
        return true;
      case 'design':
        state.designApproved = true;
        state.currentPhase = 'tasks';
        return true;
      case 'tasks':
        state.tasksApproved = true;
        state.currentPhase = 'implementation';
        return true;
      case 'implementation':
        // Already at final phase
        return true;
      default:
        return false;
    }
  }

  /**
   * Reset approval for a phase (when changes are requested)
   */
  resetPhaseApproval(specName: string, phase: SpecPhase): void {
    const state = this.getOrCreateWorkflowState(specName);

    switch (phase) {
      case 'requirements':
        state.requirementsApproved = false;
        state.designApproved = false;
        state.tasksApproved = false;
        state.currentPhase = 'requirements';
        break;
      case 'design':
        state.designApproved = false;
        state.tasksApproved = false;
        if (state.currentPhase !== 'requirements') {
          state.currentPhase = 'design';
        }
        break;
      case 'tasks':
        state.tasksApproved = false;
        if (state.currentPhase === 'implementation') {
          state.currentPhase = 'tasks';
        }
        break;
    }
  }

  /**
   * Check if a specific phase has been approved
   */
  isPhaseApproved(specName: string, phase: SpecPhase): boolean {
    const state = this.getOrCreateWorkflowState(specName);

    switch (phase) {
      case 'requirements':
        return state.requirementsApproved;
      case 'design':
        return state.designApproved;
      case 'tasks':
        return state.tasksApproved;
      case 'implementation':
        return state.tasksApproved; // Implementation is available once tasks are approved
      default:
        return false;
    }
  }
}
