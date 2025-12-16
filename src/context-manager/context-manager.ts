import type { IFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import type { ISpecManager } from '../spec-manager/spec-manager.js';
import type { ISteeringManager } from '../steering-manager/steering-manager.js';
import type {
  ContextRequest,
  AgentContext,
  SpecContext,
  FileContent,
  Message,
  SteeringContext,
  Task
} from '../types/index.js';

/**
 * Interface for managing agent context
 */
export interface IContextManager {
  buildContext(request: ContextRequest): Promise<AgentContext>;
  addFile(path: string): Promise<void>;
  addFolder(path: string, depth?: number): Promise<void>;
  clearContext(): void;
}

/**
 * Default system prompt for the agent
 */
const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant helping with software development.
Follow the project's requirements and design documents when implementing features.
Write clean, maintainable code that follows best practices.`;

/**
 * ContextManager implementation
 * Builds and manages the context provided to the LLM
 */
export class ContextManager implements IContextManager {
  private fs: IFileSystemAdapter;
  private specManager: ISpecManager;
  private steeringManager: ISteeringManager;
  private explicitFiles: Set<string> = new Set();
  private explicitFolders: Set<string> = new Set();
  private conversationHistory: Message[] = [];

  constructor(
    fs: IFileSystemAdapter,
    specManager: ISpecManager,
    steeringManager: ISteeringManager
  ) {
    this.fs = fs;
    this.specManager = specManager;
    this.steeringManager = steeringManager;
  }


  /**
   * Build full context for an agent request
   * Combines spec context, steering content, and file references
   */
  async buildContext(request: ContextRequest): Promise<AgentContext> {
    // Build spec context if a spec is specified
    let specContext: SpecContext | undefined;
    if (request.spec) {
      specContext = await this.buildSpecContext(request.spec, request.taskId);
    }

    // Collect all active files for steering context
    const activeFiles = this.collectActiveFiles(request, specContext);

    // Get steering content based on active files and manual inclusions
    const steeringContext: SteeringContext = {
      activeFiles,
      manualInclusions: request.manualSteering || []
    };
    const steeringContent = await this.steeringManager.getActiveSteeringContent(steeringContext);

    // Load file contents from explicit references
    const fileContents = await this.loadFileContents(request);

    return {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      steeringContent,
      specContext,
      fileContents,
      conversationHistory: [...this.conversationHistory]
    };
  }

  /**
   * Build spec context from spec name and optional task ID
   * Loads requirements and design documents for context
   */
  private async buildSpecContext(specName: string, taskId?: string): Promise<SpecContext> {
    const spec = await this.specManager.loadSpec(specName);

    let currentTask: Task | undefined;
    if (taskId && spec.tasks) {
      currentTask = this.findTaskById(spec.tasks, taskId);
    }

    return {
      name: spec.name,
      requirements: spec.requirements,
      design: spec.design,
      currentTask
    };
  }

  /**
   * Find a task by ID in the task tree
   */
  private findTaskById(tasks: Task[], taskId: string): Task | undefined {
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
    return undefined;
  }

  /**
   * Collect all active files for steering context determination
   */
  private collectActiveFiles(request: ContextRequest, specContext?: SpecContext): string[] {
    const files: string[] = [];

    // Add explicit files from request
    if (request.explicitFiles) {
      files.push(...request.explicitFiles);
    }

    // Add files from explicit context
    files.push(...this.explicitFiles);

    // Add spec files if spec context exists
    if (specContext) {
      files.push(`.kiro/specs/${specContext.name}/requirements.md`);
      files.push(`.kiro/specs/${specContext.name}/design.md`);
      files.push(`.kiro/specs/${specContext.name}/tasks.md`);
    }

    return [...new Set(files)]; // Remove duplicates
  }

  /**
   * Load file contents from explicit file and folder references
   */
  private async loadFileContents(request: ContextRequest): Promise<FileContent[]> {
    const contents: FileContent[] = [];
    const processedPaths = new Set<string>();

    // Load explicit files from request
    if (request.explicitFiles) {
      for (const filePath of request.explicitFiles) {
        if (!processedPaths.has(filePath)) {
          const content = await this.safeReadFile(filePath);
          if (content !== null) {
            contents.push({ path: filePath, content });
            processedPaths.add(filePath);
          }
        }
      }
    }

    // Load files from explicit context
    for (const filePath of this.explicitFiles) {
      if (!processedPaths.has(filePath)) {
        const content = await this.safeReadFile(filePath);
        if (content !== null) {
          contents.push({ path: filePath, content });
          processedPaths.add(filePath);
        }
      }
    }

    // Load folder contents from request
    if (request.explicitFolders) {
      for (const folderPath of request.explicitFolders) {
        const folderContents = await this.loadFolderContents(folderPath, processedPaths);
        contents.push(...folderContents);
      }
    }

    // Load folder contents from explicit context
    for (const folderPath of this.explicitFolders) {
      const folderContents = await this.loadFolderContents(folderPath, processedPaths);
      contents.push(...folderContents);
    }

    return contents;
  }

  /**
   * Load all files from a folder recursively
   */
  private async loadFolderContents(
    folderPath: string,
    processedPaths: Set<string>,
    depth: number = 3
  ): Promise<FileContent[]> {
    const contents: FileContent[] = [];

    if (depth <= 0) {
      return contents;
    }

    try {
      const entries = await this.fs.readdir(folderPath);

      for (const entry of entries) {
        const entryPath = `${folderPath}/${entry}`;

        if (processedPaths.has(entryPath)) {
          continue;
        }

        // Try to read as file first
        const content = await this.safeReadFile(entryPath);
        if (content !== null) {
          contents.push({ path: entryPath, content });
          processedPaths.add(entryPath);
        } else {
          // If not a file, try as directory
          const subContents = await this.loadFolderContents(entryPath, processedPaths, depth - 1);
          contents.push(...subContents);
        }
      }
    } catch {
      // Folder doesn't exist or can't be read
    }

    return contents;
  }

  /**
   * Safely read a file, returning null if it doesn't exist or can't be read
   */
  private async safeReadFile(path: string): Promise<string | null> {
    try {
      return await this.fs.readFile(path);
    } catch {
      return null;
    }
  }

  /**
   * Add a file to the explicit context
   */
  async addFile(path: string): Promise<void> {
    // Verify file exists before adding
    if (await this.fs.exists(path)) {
      this.explicitFiles.add(path);
    } else {
      throw new Error(`File not found: ${path}`);
    }
  }

  /**
   * Add a folder to the explicit context
   */
  async addFolder(path: string, _depth?: number): Promise<void> {
    // Verify folder exists before adding
    if (await this.fs.exists(path)) {
      this.explicitFolders.add(path);
    } else {
      throw new Error(`Folder not found: ${path}`);
    }
  }

  /**
   * Clear the current context (files, folders, and conversation history)
   */
  clearContext(): void {
    this.explicitFiles.clear();
    this.explicitFolders.clear();
    this.conversationHistory = [];
  }

  /**
   * Add a message to conversation history
   */
  addMessage(message: Message): void {
    this.conversationHistory.push(message);
  }

  /**
   * Get current conversation history
   */
  getConversationHistory(): Message[] {
    return [...this.conversationHistory];
  }
}
