#!/usr/bin/env node
import { Command } from 'commander';
import { SpecManager } from '../spec-manager/spec-manager.js';
import { HookManager } from '../hook-manager/hook-manager.js';
import { SteeringManager } from '../steering-manager/steering-manager.js';
import { NodeFileSystemAdapter } from '../filesystem/filesystem-adapter.js';

/**
 * Open-Kiro CLI
 * Command-line interface for managing specs, hooks, and steering files
 */

const program = new Command();

// Create shared file system adapter
const fs = new NodeFileSystemAdapter();

// Initialize managers
const specManager = new SpecManager(fs);
const hookManager = new HookManager(fs);
const steeringManager = new SteeringManager(fs);

program
  .name('open-kiro')
  .description('AI-assisted development tool with specs, hooks, and steering')
  .version('0.1.0');

// ============================================
// Init Command
// ============================================
program
  .command('init')
  .description('Initialize Open-Kiro in the current workspace')
  .action(async () => {
    try {
      // Create .kiro directory structure
      await fs.mkdir('.kiro/specs');
      await fs.mkdir('.kiro/hooks');
      await fs.mkdir('.kiro/steering');
      console.log('✓ Initialized Open-Kiro workspace');
      console.log('  Created .kiro/specs/');
      console.log('  Created .kiro/hooks/');
      console.log('  Created .kiro/steering/');
    } catch (error) {
      console.error('Error initializing workspace:', (error as Error).message);
      process.exit(1);
    }
  });


// ============================================
// Spec Commands
// ============================================
const specCmd = program
  .command('spec')
  .description('Manage specs');

specCmd
  .command('create <name>')
  .description('Create a new spec with the given name')
  .action(async (name: string) => {
    try {
      const spec = await specManager.createSpec(name);
      console.log(`✓ Created spec '${name}'`);
      console.log(`  ${spec.path}/requirements.md`);
      console.log(`  ${spec.path}/design.md`);
      console.log(`  ${spec.path}/tasks.md`);
    } catch (error) {
      console.error('Error creating spec:', (error as Error).message);
      process.exit(1);
    }
  });

specCmd
  .command('list')
  .description('List all specs in the workspace')
  .action(async () => {
    try {
      const specs = await specManager.listSpecs();
      if (specs.length === 0) {
        console.log('No specs found in workspace');
        return;
      }
      console.log('Specs:');
      for (const spec of specs) {
        const status = [
          spec.hasRequirements ? 'R' : '-',
          spec.hasDesign ? 'D' : '-',
          spec.hasTasks ? 'T' : '-'
        ].join('');
        console.log(`  [${status}] ${spec.name}`);
      }
      console.log('\nLegend: R=requirements, D=design, T=tasks');
    } catch (error) {
      console.error('Error listing specs:', (error as Error).message);
      process.exit(1);
    }
  });

specCmd
  .command('run <name> <task>')
  .description('Execute a task from a spec')
  .action(async (name: string, taskId: string) => {
    try {
      // Load the spec to verify it exists
      const spec = await specManager.loadSpec(name);
      
      // Find the task
      const task = spec.tasks?.find(t => 
        t.id === taskId || t.subTasks?.some(st => st.id === taskId)
      );
      
      if (!task) {
        console.error(`Task '${taskId}' not found in spec '${name}'`);
        process.exit(1);
      }

      // Update task status to in_progress
      await specManager.setTaskStatus(name, taskId, 'in_progress');
      console.log(`✓ Started task ${taskId} in spec '${name}'`);
      console.log(`  Status: in_progress`);
      console.log(`\nNote: Task execution requires an agent. Use the IDE integration for full functionality.`);
    } catch (error) {
      console.error('Error running task:', (error as Error).message);
      process.exit(1);
    }
  });


// ============================================
// Hook Commands
// ============================================
const hookCmd = program
  .command('hook')
  .description('Manage hooks');

hookCmd
  .command('create')
  .description('Create a new hook interactively')
  .option('-n, --name <name>', 'Hook name')
  .option('-i, --id <id>', 'Hook ID')
  .option('-t, --trigger <type>', 'Trigger type (file_save, message_sent, session_created, agent_complete, manual)')
  .option('-a, --action <type>', 'Action type (send_message, execute_command)')
  .option('-m, --message <message>', 'Message for send_message action')
  .option('-c, --command <command>', 'Command for execute_command action')
  .action(async (options) => {
    try {
      // Validate required options
      if (!options.name || !options.id || !options.trigger || !options.action) {
        console.log('Usage: open-kiro hook create --id <id> --name <name> --trigger <type> --action <type> [--message <msg>] [--command <cmd>]');
        console.log('\nTrigger types: file_save, message_sent, session_created, agent_complete, manual');
        console.log('Action types: send_message, execute_command');
        process.exit(1);
      }

      const hook = {
        id: options.id,
        name: options.name,
        trigger: { type: options.trigger as 'file_save' | 'message_sent' | 'session_created' | 'agent_complete' | 'manual' },
        action: options.action === 'send_message' 
          ? { type: 'send_message' as const, message: options.message || '' }
          : { type: 'execute_command' as const, command: options.command || '' },
        enabled: true
      };

      await hookManager.registerHook(hook);
      console.log(`✓ Created hook '${options.name}' (${options.id})`);
      console.log(`  Trigger: ${options.trigger}`);
      console.log(`  Action: ${options.action}`);
    } catch (error) {
      console.error('Error creating hook:', (error as Error).message);
      process.exit(1);
    }
  });

hookCmd
  .command('list')
  .description('List all hooks')
  .action(async () => {
    try {
      await hookManager.loadHooks();
      const hooks = await hookManager.listHooks();
      if (hooks.length === 0) {
        console.log('No hooks found in workspace');
        return;
      }
      console.log('Hooks:');
      for (const hook of hooks) {
        const status = hook.enabled ? '✓' : '✗';
        console.log(`  [${status}] ${hook.id}: ${hook.name}`);
        console.log(`      Trigger: ${hook.trigger.type}`);
        console.log(`      Action: ${hook.action.type}`);
      }
    } catch (error) {
      console.error('Error listing hooks:', (error as Error).message);
      process.exit(1);
    }
  });

hookCmd
  .command('trigger <id>')
  .description('Manually trigger a hook')
  .action(async (id: string) => {
    try {
      await hookManager.loadHooks();
      const result = await hookManager.triggerHook(id);
      if (result.success) {
        console.log(`✓ Hook '${id}' triggered successfully`);
        if (result.output) {
          console.log('Output:', result.output);
        }
      } else {
        console.error(`✗ Hook '${id}' failed:`, result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error('Error triggering hook:', (error as Error).message);
      process.exit(1);
    }
  });


// ============================================
// Steering Commands
// ============================================
const steeringCmd = program
  .command('steering')
  .description('Manage steering files');

steeringCmd
  .command('create <name>')
  .description('Create a new steering file')
  .option('-i, --inclusion <mode>', 'Inclusion mode (always, fileMatch, manual)', 'always')
  .option('-p, --pattern <pattern>', 'File match pattern (for fileMatch mode)')
  .option('-d, --description <desc>', 'Description of the steering file')
  .action(async (name: string, options) => {
    try {
      const config = {
        inclusion: options.inclusion as 'always' | 'fileMatch' | 'manual',
        ...(options.pattern && { fileMatchPattern: options.pattern }),
        ...(options.description && { description: options.description })
      };

      const defaultContent = `# ${name}\n\n[Add your steering instructions here]`;
      await steeringManager.createSteeringFile(name, config, defaultContent);
      console.log(`✓ Created steering file '${name}'`);
      console.log(`  Path: .kiro/steering/${name}.md`);
      console.log(`  Inclusion: ${config.inclusion}`);
      if (config.fileMatchPattern) {
        console.log(`  Pattern: ${config.fileMatchPattern}`);
      }
    } catch (error) {
      console.error('Error creating steering file:', (error as Error).message);
      process.exit(1);
    }
  });

steeringCmd
  .command('list')
  .description('List all steering files')
  .action(async () => {
    try {
      const files = await steeringManager.loadSteeringFiles();
      if (files.length === 0) {
        console.log('No steering files found in workspace');
        return;
      }
      console.log('Steering files:');
      for (const file of files) {
        console.log(`  ${file.name}`);
        console.log(`    Inclusion: ${file.config.inclusion}`);
        if (file.config.fileMatchPattern) {
          console.log(`    Pattern: ${file.config.fileMatchPattern}`);
        }
        if (file.config.description) {
          console.log(`    Description: ${file.config.description}`);
        }
      }
    } catch (error) {
      console.error('Error listing steering files:', (error as Error).message);
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
