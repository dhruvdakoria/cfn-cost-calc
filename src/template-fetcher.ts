/**
 * Template Fetcher
 * Fetches CloudFormation templates from AWS and local CDK output
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  CloudFormationClient,
  GetTemplateCommand,
  ListStacksCommand,
  DescribeStacksCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { CloudFormationTemplate } from './types';
import { TemplateParser } from './template-parser';

export interface StackInfo {
  stackName: string;
  stackId: string;
  status: string;
  createdTime?: Date;
  lastUpdatedTime?: Date;
}

export interface FetchedTemplate {
  stackName: string;
  template: CloudFormationTemplate;
  source: 'deployed' | 'synthesized' | 'local';
  templatePath?: string;
}

export class TemplateFetcher {
  private cfnClient: CloudFormationClient;
  
  constructor(region: string = 'us-east-1', profile?: string) {
    const config: { region: string; profile?: string } = { region };
    if (profile) {
      config.profile = profile;
    }
    this.cfnClient = new CloudFormationClient(config);
  }
  
  /**
   * Fetch a deployed stack template from AWS CloudFormation
   */
  async fetchDeployedTemplate(stackName: string): Promise<FetchedTemplate> {
    try {
      const command = new GetTemplateCommand({
        StackName: stackName,
        TemplateStage: 'Processed', // Get the processed template with resolved macros
      });
      
      const response = await this.cfnClient.send(command);
      
      if (!response.TemplateBody) {
        throw new Error(`No template body returned for stack: ${stackName}`);
      }
      
      const template = TemplateParser.parseContent(response.TemplateBody, stackName);
      
      return {
        stackName,
        template,
        source: 'deployed',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch deployed template for ${stackName}: ${errorMessage}`);
    }
  }
  
  /**
   * List all deployed stacks in the account/region
   */
  async listDeployedStacks(): Promise<StackInfo[]> {
    const stacks: StackInfo[] = [];
    let nextToken: string | undefined;
    
    // Stack statuses that indicate a stack exists and has resources
    const activeStatuses: StackStatus[] = [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE',
      'UPDATE_ROLLBACK_COMPLETE',
      'IMPORT_COMPLETE',
      'IMPORT_ROLLBACK_COMPLETE',
    ];
    
    do {
      const command = new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: activeStatuses,
      });
      
      const response = await this.cfnClient.send(command);
      
      if (response.StackSummaries) {
        for (const summary of response.StackSummaries) {
          if (summary.StackName && summary.StackId && summary.StackStatus) {
            stacks.push({
              stackName: summary.StackName,
              stackId: summary.StackId,
              status: summary.StackStatus,
              createdTime: summary.CreationTime,
              lastUpdatedTime: summary.LastUpdatedTime,
            });
          }
        }
      }
      
      nextToken = response.NextToken;
    } while (nextToken);
    
    return stacks;
  }
  
  /**
   * Check if a stack exists and is in a stable state
   */
  async stackExists(stackName: string): Promise<boolean> {
    try {
      const command = new DescribeStacksCommand({
        StackName: stackName,
      });
      
      const response = await this.cfnClient.send(command);
      
      if (!response.Stacks || response.Stacks.length === 0) {
        return false;
      }
      
      const stack = response.Stacks[0];
      const activeStatuses = [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
        'IMPORT_COMPLETE',
        'IMPORT_ROLLBACK_COMPLETE',
      ];
      
      return activeStatuses.includes(stack.StackStatus || '');
    } catch {
      return false;
    }
  }
  
  /**
   * Fetch a synthesized template from CDK output directory
   */
  static fetchSynthesizedTemplate(
    cdkOutDir: string,
    stackName: string
  ): FetchedTemplate {
    const templatePath = path.join(cdkOutDir, `${stackName}.template.json`);
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Synthesized template not found: ${templatePath}`);
    }
    
    const template = TemplateParser.parseFile(templatePath);
    
    return {
      stackName,
      template,
      source: 'synthesized',
      templatePath,
    };
  }
  
  /**
   * Fetch a template from a local file path
   */
  static fetchLocalTemplate(filePath: string, stackName?: string): FetchedTemplate {
    const absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Template file not found: ${absolutePath}`);
    }
    
    const template = TemplateParser.parseFile(absolutePath);
    const inferredStackName = stackName || path.basename(filePath, path.extname(filePath));
    
    return {
      stackName: inferredStackName,
      template,
      source: 'local',
      templatePath: absolutePath,
    };
  }
  
  /**
   * Discover all stacks from CDK output directory
   */
  static async discoverCdkStacks(cdkOutDir: string): Promise<string[]> {
    const absoluteDir = path.resolve(cdkOutDir);
    
    if (!fs.existsSync(absoluteDir)) {
      throw new Error(`CDK output directory not found: ${absoluteDir}`);
    }
    
    // Look for manifest.json to get stack names
    const manifestPath = path.join(absoluteDir, 'manifest.json');
    
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const stackNames: string[] = [];
        
        if (manifest.artifacts) {
          for (const [name, artifact] of Object.entries(manifest.artifacts)) {
            const artifactObj = artifact as Record<string, unknown>;
            if (artifactObj.type === 'aws:cloudformation:stack') {
              stackNames.push(name);
            }
          }
        }
        
        if (stackNames.length > 0) {
          return stackNames;
        }
      } catch {
        // Fall back to glob pattern
      }
    }
    
    // Fall back to finding .template.json files
    const templateFiles = await glob('*.template.json', { cwd: absoluteDir });
    return templateFiles.map(file => file.replace('.template.json', ''));
  }
  
  /**
   * Fetch all templates from CDK output directory
   */
  static async fetchAllSynthesizedTemplates(cdkOutDir: string): Promise<FetchedTemplate[]> {
    const stackNames = await this.discoverCdkStacks(cdkOutDir);
    const templates: FetchedTemplate[] = [];
    
    for (const stackName of stackNames) {
      try {
        const template = this.fetchSynthesizedTemplate(cdkOutDir, stackName);
        templates.push(template);
      } catch (error) {
        console.warn(`Warning: Could not fetch template for stack ${stackName}: ${error}`);
      }
    }
    
    return templates;
  }
  
  /**
   * Fetch templates from both deployed and synthesized sources for comparison
   */
  async fetchForComparison(
    cdkOutDir: string,
    stackName: string
  ): Promise<{
    deployed: FetchedTemplate | null;
    synthesized: FetchedTemplate;
  }> {
    // Fetch synthesized template
    const synthesized = TemplateFetcher.fetchSynthesizedTemplate(cdkOutDir, stackName);
    
    // Try to fetch deployed template
    let deployed: FetchedTemplate | null = null;
    
    if (await this.stackExists(stackName)) {
      try {
        deployed = await this.fetchDeployedTemplate(stackName);
      } catch (error) {
        console.warn(`Warning: Could not fetch deployed template for ${stackName}: ${error}`);
      }
    }
    
    return { deployed, synthesized };
  }
  
  /**
   * Fetch all templates from CDK output and their deployed counterparts
   */
  async fetchAllForComparison(cdkOutDir: string): Promise<
    Array<{
      stackName: string;
      deployed: FetchedTemplate | null;
      synthesized: FetchedTemplate;
    }>
  > {
    const stackNames = await TemplateFetcher.discoverCdkStacks(cdkOutDir);
    const results: Array<{
      stackName: string;
      deployed: FetchedTemplate | null;
      synthesized: FetchedTemplate;
    }> = [];
    
    for (const stackName of stackNames) {
      try {
        const comparison = await this.fetchForComparison(cdkOutDir, stackName);
        results.push({
          stackName,
          ...comparison,
        });
      } catch (error) {
        console.warn(`Warning: Could not process stack ${stackName}: ${error}`);
      }
    }
    
    return results;
  }
}

