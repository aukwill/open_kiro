import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { minimatch } from 'minimatch';
import type { IFileSystemAdapter } from '../filesystem/filesystem-adapter.js';
import type { SteeringFile, SteeringConfig, SteeringContext } from '../types/index.js';

/**
 * Interface for managing steering files
 */
export interface ISteeringManager {
  loadSteeringFiles(): Promise<SteeringFile[]>;
  getActiveSteeringContent(context: SteeringContext): Promise<string>;
  createSteeringFile(name: string, config: SteeringConfig, content?: string): Promise<void>;
  updateSteeringFile(name: string, content: string): Promise<void>;
  resolveReferences(content: string): Promise<string>;
}

const STEERING_DIR = '.kiro/steering';
const FILE_REFERENCE_PATTERN = /#\[\[file:([^\]]+)\]\]/g;

/**
 * Default steering config when no front-matter is present
 */
const DEFAULT_CONFIG: SteeringConfig = {
  inclusion: 'always'
};

/**
 * Parses YAML front-matter from markdown content
 * Returns the config and the remaining content
 */
export function parseFrontMatter(content: string): { config: SteeringConfig; body: string } {
  const trimmed = content.trim();
  
  // Check if content starts with front-matter delimiter
  if (!trimmed.startsWith('---')) {
    return { config: { ...DEFAULT_CONFIG }, body: content };
  }

  // Find the closing delimiter
  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { config: { ...DEFAULT_CONFIG }, body: content };
  }

  const frontMatterContent = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  try {
    const parsed = parseYaml(frontMatterContent) as Partial<SteeringConfig> | null;
    
    if (!parsed || typeof parsed !== 'object') {
      return { config: { ...DEFAULT_CONFIG }, body };
    }

    const config: SteeringConfig = {
      inclusion: isValidInclusionMode(parsed.inclusion) ? parsed.inclusion : 'always',
      ...(parsed.fileMatchPattern && { fileMatchPattern: String(parsed.fileMatchPattern) }),
      ...(parsed.description && { description: String(parsed.description) })
    };

    return { config, body };
  } catch {
    return { config: { ...DEFAULT_CONFIG }, body };
  }
}


/**
 * Serializes steering config and body back to markdown with front-matter
 */
export function serializeFrontMatter(config: SteeringConfig, body: string): string {
  // Only include non-default values in front-matter
  const frontMatterObj: Record<string, unknown> = {};
  
  if (config.inclusion !== 'always') {
    frontMatterObj.inclusion = config.inclusion;
  }
  if (config.fileMatchPattern) {
    frontMatterObj.fileMatchPattern = config.fileMatchPattern;
  }
  if (config.description) {
    frontMatterObj.description = config.description;
  }

  // If no custom config, just return the body
  if (Object.keys(frontMatterObj).length === 0) {
    return body;
  }

  const yamlContent = stringifyYaml(frontMatterObj).trim();
  return `---\n${yamlContent}\n---\n\n${body}`;
}

/**
 * Validates if a string is a valid inclusion mode
 */
function isValidInclusionMode(value: unknown): value is SteeringConfig['inclusion'] {
  return value === 'always' || value === 'fileMatch' || value === 'manual';
}

/**
 * Checks if a file path matches a glob pattern
 */
export function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  
  return minimatch(normalizedPath, normalizedPattern, { 
    matchBase: true,
    dot: true 
  });
}

/**
 * SteeringManager implementation
 * Manages steering files and determines which content to include in agent context
 */
export class SteeringManager implements ISteeringManager {
  private fs: IFileSystemAdapter;
  private steeringDir: string;

  constructor(fs: IFileSystemAdapter, steeringDir: string = STEERING_DIR) {
    this.fs = fs;
    this.steeringDir = steeringDir;
  }

  /**
   * Load all steering files from the workspace
   */
  async loadSteeringFiles(): Promise<SteeringFile[]> {
    const exists = await this.fs.exists(this.steeringDir);
    if (!exists) {
      return [];
    }

    const entries = await this.fs.readdir(this.steeringDir);
    const steeringFiles: SteeringFile[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.md')) {
        continue;
      }

      const filePath = `${this.steeringDir}/${entry}`;
      try {
        const content = await this.fs.readFile(filePath);
        const { config, body } = parseFrontMatter(content);
        
        steeringFiles.push({
          name: entry.replace(/\.md$/, ''),
          path: filePath,
          content: body,
          config
        });
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return steeringFiles;
  }


  /**
   * Get steering content for the current context
   * Filters steering files based on their inclusion mode and the active context
   */
  async getActiveSteeringContent(context: SteeringContext): Promise<string> {
    const steeringFiles = await this.loadSteeringFiles();
    const activeContent: string[] = [];

    for (const file of steeringFiles) {
      const shouldInclude = this.shouldIncludeFile(file, context);
      
      if (shouldInclude) {
        // Resolve file references before including
        const resolvedContent = await this.resolveReferences(file.content);
        activeContent.push(resolvedContent);
      }
    }

    return activeContent.join('\n\n');
  }

  /**
   * Determines if a steering file should be included based on its config and context
   */
  private shouldIncludeFile(file: SteeringFile, context: SteeringContext): boolean {
    switch (file.config.inclusion) {
      case 'always':
        return true;

      case 'fileMatch':
        if (!file.config.fileMatchPattern) {
          return false;
        }
        return context.activeFiles.some(activeFile => 
          matchesPattern(activeFile, file.config.fileMatchPattern!)
        );

      case 'manual':
        return context.manualInclusions.includes(file.name);

      default:
        return false;
    }
  }

  /**
   * Create a new steering file
   */
  async createSteeringFile(name: string, config: SteeringConfig, content: string = ''): Promise<void> {
    // Validate name (alphanumeric with hyphens, no extension)
    if (!/^[a-z][a-z0-9-]*$/i.test(name)) {
      throw new Error(`Invalid steering file name: '${name}'. Use alphanumeric characters and hyphens.`);
    }

    const filePath = `${this.steeringDir}/${name}.md`;
    
    // Check if file already exists
    if (await this.fs.exists(filePath)) {
      throw new Error(`Steering file '${name}' already exists`);
    }

    const fileContent = serializeFrontMatter(config, content);
    await this.fs.writeFile(filePath, fileContent);
  }

  /**
   * Update steering file content (preserves front-matter config)
   */
  async updateSteeringFile(name: string, content: string): Promise<void> {
    const filePath = `${this.steeringDir}/${name}.md`;
    
    // Check if file exists
    if (!await this.fs.exists(filePath)) {
      throw new Error(`Steering file '${name}' not found`);
    }

    // Read existing file to preserve config
    const existingContent = await this.fs.readFile(filePath);
    const { config } = parseFrontMatter(existingContent);

    const fileContent = serializeFrontMatter(config, content);
    await this.fs.writeFile(filePath, fileContent);
  }

  /**
   * Resolve file references in steering content
   * Replaces #[[file:<path>]] with actual file content
   */
  async resolveReferences(content: string): Promise<string> {
    const references = this.extractFileReferences(content);
    
    if (references.length === 0) {
      return content;
    }

    let resolvedContent = content;

    for (const ref of references) {
      try {
        const fileContent = await this.fs.readFile(ref.path);
        // Escape $ characters to prevent special replacement patterns
        const escapedContent = fileContent.replace(/\$/g, '$$$$');
        resolvedContent = resolvedContent.replace(ref.fullMatch, escapedContent);
      } catch {
        // If file can't be read, leave the reference as-is or replace with error message
        resolvedContent = resolvedContent.replace(
          ref.fullMatch, 
          `[File not found: ${ref.path}]`
        );
      }
    }

    return resolvedContent;
  }

  /**
   * Extract file references from content
   */
  private extractFileReferences(content: string): Array<{ fullMatch: string; path: string }> {
    const references: Array<{ fullMatch: string; path: string }> = [];
    const regex = new RegExp(FILE_REFERENCE_PATTERN.source, 'g');
    
    let match;
    while ((match = regex.exec(content)) !== null) {
      references.push({
        fullMatch: match[0],
        path: match[1].trim()
      });
    }

    return references;
  }
}
