// Core type definitions for Open-Kiro

// ============================================
// Agent Controller Types
// ============================================

export interface UserMessage {
  content: string;
  attachments?: FileReference[];
  context?: ContextOverride;
}

export interface FileReference {
  path: string;
  type: 'file' | 'folder';
}

export interface ContextOverride {
  spec?: string;
  taskId?: string;
  manualSteering?: string[];
}

export interface AgentResponse {
  content: string;
  codeChanges?: CodeChange[];
  status: 'success' | 'error' | 'pending_approval';
}

export interface CodeChange {
  path: string;
  content: string;
  operation: 'create' | 'update' | 'delete';
}

export type AgentEvent = 'message_sent' | 'response_received' | 'task_started' | 'task_completed';
export type EventHandler = (data: unknown) => void;

// ============================================
// Spec Manager Types
// ============================================

export type DocType = 'requirements' | 'design' | 'tasks';
export type TaskState = 'not_started' | 'in_progress' | 'completed';

export interface Spec {
  name: string;
  path: string;
  requirements: string | null;
  design: string | null;
  tasks: Task[] | null;
}

export interface SpecSummary {
  name: string;
  path: string;
  hasRequirements: boolean;
  hasDesign: boolean;
  hasTasks: boolean;
}


export interface Task {
  id: string;
  description: string;
  status: TaskState;
  subTasks?: Task[];
  requirements?: string[];
}

export interface TaskStatus {
  taskId: string;
  status: TaskState;
  subTasks?: TaskStatus[];
}

// ============================================
// Hook Manager Types
// ============================================

export interface HookConfig {
  id: string;
  name: string;
  description?: string;
  trigger: HookTrigger;
  action: HookAction;
  enabled: boolean;
  conditions?: HookCondition[];
}

export type HookTrigger =
  | { type: 'file_save'; pattern?: string }
  | { type: 'message_sent' }
  | { type: 'session_created' }
  | { type: 'agent_complete' }
  | { type: 'manual' };

export type HookAction =
  | { type: 'send_message'; message: string }
  | { type: 'execute_command'; command: string; cwd?: string };

export interface HookCondition {
  type: string;
  value: string;
}

export interface HookResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface HookContext {
  event?: string;
  filePath?: string;
  message?: string;
  specName?: string;
  taskId?: string;
}

// ============================================
// Steering Manager Types
// ============================================

export interface SteeringFile {
  name: string;
  path: string;
  content: string;
  config: SteeringConfig;
}

export interface SteeringConfig {
  inclusion: 'always' | 'fileMatch' | 'manual';
  fileMatchPattern?: string;
  description?: string;
}

export interface SteeringContext {
  activeFiles: string[];
  manualInclusions: string[];
}

// ============================================
// Context Manager Types
// ============================================

export interface ContextRequest {
  message: string;
  spec?: string;
  taskId?: string;
  explicitFiles?: string[];
  explicitFolders?: string[];
  manualSteering?: string[];
}

export interface AgentContext {
  systemPrompt: string;
  steeringContent: string;
  specContext?: SpecContext;
  fileContents: FileContent[];
  conversationHistory: Message[];
}

export interface SpecContext {
  name: string;
  requirements: string | null;
  design: string | null;
  currentTask?: Task;
}

export interface FileContent {
  path: string;
  content: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ============================================
// File System Types
// ============================================

export interface Disposable {
  dispose(): void;
}

export type WatchCallback = (event: WatchEvent) => void;

export interface WatchEvent {
  type: 'create' | 'change' | 'delete';
  path: string;
}

// ============================================
// Plugin System Types
// ============================================

export interface Plugin {
  id: string;
  name: string;
  version: string;
  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;
  hookTriggers?: CustomHookTrigger[];
  steeringModes?: CustomSteeringMode[];
  commands?: Command[];
}

export interface PluginContext {
  workspacePath: string;
  registerHookTrigger(trigger: CustomHookTrigger): void;
  registerSteeringMode(mode: CustomSteeringMode): void;
  registerCommand(command: Command): void;
}

export interface CustomHookTrigger {
  type: string;
  description: string;
  handler: (callback: () => void) => Disposable;
}

export interface CustomSteeringMode {
  name: string;
  description: string;
  shouldInclude: (context: SteeringContext) => boolean;
}

export interface Command {
  id: string;
  name: string;
  handler: () => Promise<void>;
}
