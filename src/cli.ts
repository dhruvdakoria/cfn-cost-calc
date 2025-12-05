#!/usr/bin/env node

/**
 * CloudFormation Cost Estimate CLI
 * Compare deployed vs synthesized CDK stack costs
 */

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { TemplateFetcher } from './template-fetcher';
import { CostCalculator } from './cost-calculator';
import { DiffCalculator } from './diff-calculator';
import { OutputFormatter, OutputFormat } from './output-formatter';
import { CostComparison, StackCostEstimate } from './types';

const DEFAULT_CDK_OUT_DIR = 'cdk.out';
const DEFAULT_REGION = 'us-east-1';

program
  .name('cfn-cost')
  .description('CloudFormation/CDK cost estimation tool - compare deployed vs synthesized stack costs')
  .version('1.0.0');

// Compare command - main functionality
program
  .command('compare')
  .description('Compare deployed stack costs with synthesized CDK templates')
  .option('-d, --cdk-out <dir>', 'CDK output directory', DEFAULT_CDK_OUT_DIR)
  .option('-s, --stacks <stacks...>', 'Specific stack names to compare (default: all)')
  .option('-r, --region <region>', 'AWS region', DEFAULT_REGION)
  .option('-p, --profile <profile>', 'AWS profile to use')
  .option('-f, --format <format>', 'Output format: table, json, markdown, github', 'table')
  .option('-o, --output <file>', 'Write output to file')
  .option('--no-deployed', 'Skip comparing with deployed stacks (estimate new templates only)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      await runCompare(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Estimate command - estimate a single template
program
  .command('estimate')
  .description('Estimate costs for a CloudFormation template file')
  .argument('<template>', 'Path to CloudFormation template file (JSON or YAML)')
  .option('-n, --stack-name <name>', 'Stack name for the estimate')
  .option('-r, --region <region>', 'AWS region', DEFAULT_REGION)
  .option('-f, --format <format>', 'Output format: table, json, markdown', 'table')
  .option('-o, --output <file>', 'Write output to file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (templatePath, options) => {
    try {
      await runEstimate(templatePath, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Diff command - compare two template files
program
  .command('diff')
  .description('Compare costs between two CloudFormation template files')
  .argument('<before>', 'Path to the before template file')
  .argument('<after>', 'Path to the after template file')
  .option('-n, --stack-name <name>', 'Stack name for the comparison')
  .option('-r, --region <region>', 'AWS region', DEFAULT_REGION)
  .option('-f, --format <format>', 'Output format: table, json, markdown, github', 'table')
  .option('-o, --output <file>', 'Write output to file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (beforePath, afterPath, options) => {
    try {
      await runDiff(beforePath, afterPath, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// List stacks command
program
  .command('list-stacks')
  .description('List available stacks from CDK output or AWS')
  .option('-d, --cdk-out <dir>', 'CDK output directory', DEFAULT_CDK_OUT_DIR)
  .option('-r, --region <region>', 'AWS region', DEFAULT_REGION)
  .option('-p, --profile <profile>', 'AWS profile to use')
  .option('--deployed', 'List deployed stacks from AWS')
  .action(async (options) => {
    try {
      await runListStacks(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// GitHub comment command - generate a formatted PR comment
program
  .command('github-comment')
  .description('Generate a GitHub PR comment with cost comparison')
  .option('-d, --cdk-out <dir>', 'CDK output directory', DEFAULT_CDK_OUT_DIR)
  .option('-s, --stacks <stacks...>', 'Specific stack names to compare')
  .option('-r, --region <region>', 'AWS region', DEFAULT_REGION)
  .option('-p, --profile <profile>', 'AWS profile to use')
  .option('-o, --output <file>', 'Write comment to file (default: stdout)')
  .action(async (options) => {
    try {
      await runGitHubComment(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Run the compare command
 */
async function runCompare(options: {
  cdkOut: string;
  stacks?: string[];
  region: string;
  profile?: string;
  format: string;
  output?: string;
  deployed: boolean;
  verbose?: boolean;
}) {
  const { cdkOut, stacks, region, profile, format, output, deployed, verbose } = options;
  
  if (verbose) {
    console.log(chalk.gray(`CDK output directory: ${cdkOut}`));
    console.log(chalk.gray(`Region: ${region}`));
    console.log(chalk.gray(`Compare with deployed: ${deployed}`));
  }
  
  // Verify CDK output directory exists
  if (!fs.existsSync(cdkOut)) {
    throw new Error(`CDK output directory not found: ${cdkOut}. Run 'cdk synth' first.`);
  }
  
  const fetcher = new TemplateFetcher(region, profile);
  const formatter = new OutputFormatter(region);
  
  // Discover stacks
  let stackNames = stacks;
  if (!stackNames || stackNames.length === 0) {
    stackNames = await TemplateFetcher.discoverCdkStacks(cdkOut);
    if (verbose) {
      console.log(chalk.gray(`Discovered stacks: ${stackNames.join(', ')}`));
    }
  }
  
  if (stackNames.length === 0) {
    throw new Error('No stacks found in CDK output directory');
  }
  
  const comparisons: CostComparison[] = [];
  const estimates: StackCostEstimate[] = [];
  
  for (const stackName of stackNames) {
    if (verbose) {
      console.log(chalk.gray(`Processing stack: ${stackName}`));
    }
    
    try {
      if (deployed) {
        // Compare with deployed stack
        const { deployed: deployedTemplate, synthesized } = await fetcher.fetchForComparison(cdkOut, stackName);
        
        const diffCalculator = new DiffCalculator(region);
        const comparison = diffCalculator.compareTemplates(
          stackName,
          deployedTemplate?.template || null,
          synthesized.template,
          'deployed',
          'synthesized'
        );
        comparisons.push(comparison);
      } else {
        // Just estimate the synthesized template
        const synthesized = TemplateFetcher.fetchSynthesizedTemplate(cdkOut, stackName);
        const calculator = new CostCalculator(region);
        const estimate = calculator.calculateStackCost(stackName, synthesized.template, 'synthesized');
        estimates.push(estimate);
      }
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Failed to process stack ${stackName}: ${error}`));
    }
  }
  
  // Format and output results
  let result: string;
  
  if (deployed && comparisons.length > 0) {
    result = formatter.formatMultipleComparisons(comparisons, format as OutputFormat);
  } else if (estimates.length > 0) {
    result = estimates.map(e => formatter.formatEstimate(e, format as OutputFormat)).join('\n\n');
  } else {
    throw new Error('No results to display');
  }
  
  if (output) {
    fs.writeFileSync(output, result);
    console.log(chalk.green(`Output written to ${output}`));
  } else {
    console.log(result);
  }
}

/**
 * Run the estimate command
 */
async function runEstimate(templatePath: string, options: {
  stackName?: string;
  region: string;
  format: string;
  output?: string;
  verbose?: boolean;
}) {
  const { stackName, region, format, output, verbose } = options;
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }
  
  const template = TemplateFetcher.fetchLocalTemplate(templatePath, stackName);
  const calculator = new CostCalculator(region);
  const estimate = calculator.calculateStackCost(template.stackName, template.template, 'local');
  
  const formatter = new OutputFormatter(region);
  const result = formatter.formatEstimate(estimate, format as OutputFormat);
  
  if (output) {
    fs.writeFileSync(output, result);
    console.log(chalk.green(`Output written to ${output}`));
  } else {
    console.log(result);
  }
}

/**
 * Run the diff command
 */
async function runDiff(beforePath: string, afterPath: string, options: {
  stackName?: string;
  region: string;
  format: string;
  output?: string;
  verbose?: boolean;
}) {
  const { stackName, region, format, output, verbose } = options;
  
  if (!fs.existsSync(beforePath)) {
    throw new Error(`Before template file not found: ${beforePath}`);
  }
  if (!fs.existsSync(afterPath)) {
    throw new Error(`After template file not found: ${afterPath}`);
  }
  
  const beforeTemplate = TemplateFetcher.fetchLocalTemplate(beforePath, stackName);
  const afterTemplate = TemplateFetcher.fetchLocalTemplate(afterPath, stackName);
  
  const diffCalculator = new DiffCalculator(region);
  const comparison = diffCalculator.compareTemplates(
    afterTemplate.stackName,
    beforeTemplate.template,
    afterTemplate.template,
    'local',
    'local'
  );
  
  const formatter = new OutputFormatter(region);
  const result = formatter.formatComparison(comparison, format as OutputFormat);
  
  if (output) {
    fs.writeFileSync(output, result);
    console.log(chalk.green(`Output written to ${output}`));
  } else {
    console.log(result);
  }
}

/**
 * Run the list-stacks command
 */
async function runListStacks(options: {
  cdkOut: string;
  region: string;
  profile?: string;
  deployed?: boolean;
}) {
  const { cdkOut, region, profile, deployed } = options;
  
  if (deployed) {
    const fetcher = new TemplateFetcher(region, profile);
    const stacks = await fetcher.listDeployedStacks();
    
    console.log(chalk.bold('\nDeployed Stacks:\n'));
    
    if (stacks.length === 0) {
      console.log(chalk.gray('  No deployed stacks found'));
    } else {
      for (const stack of stacks) {
        console.log(`  ${chalk.cyan(stack.stackName)}`);
        console.log(`    Status: ${stack.status}`);
        if (stack.lastUpdatedTime) {
          console.log(`    Last Updated: ${stack.lastUpdatedTime.toISOString()}`);
        }
      }
    }
  } else {
    if (!fs.existsSync(cdkOut)) {
      throw new Error(`CDK output directory not found: ${cdkOut}`);
    }
    
    const stacks = await TemplateFetcher.discoverCdkStacks(cdkOut);
    
    console.log(chalk.bold('\nSynthesized Stacks:\n'));
    
    if (stacks.length === 0) {
      console.log(chalk.gray('  No stacks found'));
    } else {
      for (const stackName of stacks) {
        const templatePath = path.join(cdkOut, `${stackName}.template.json`);
        const stats = fs.statSync(templatePath);
        console.log(`  ${chalk.cyan(stackName)}`);
        console.log(`    Template: ${templatePath}`);
        console.log(`    Size: ${(stats.size / 1024).toFixed(1)} KB`);
      }
    }
  }
  
  console.log('');
}

/**
 * Run the github-comment command
 */
async function runGitHubComment(options: {
  cdkOut: string;
  stacks?: string[];
  region: string;
  profile?: string;
  output?: string;
}) {
  const { cdkOut, stacks, region, profile, output } = options;
  
  if (!fs.existsSync(cdkOut)) {
    throw new Error(`CDK output directory not found: ${cdkOut}`);
  }
  
  const fetcher = new TemplateFetcher(region, profile);
  const formatter = new OutputFormatter(region);
  
  // Discover stacks
  let stackNames = stacks;
  if (!stackNames || stackNames.length === 0) {
    stackNames = await TemplateFetcher.discoverCdkStacks(cdkOut);
  }
  
  if (stackNames.length === 0) {
    throw new Error('No stacks found');
  }
  
  const comparisons: CostComparison[] = [];
  
  for (const stackName of stackNames) {
    try {
      const { deployed: deployedTemplate, synthesized } = await fetcher.fetchForComparison(cdkOut, stackName);
      
      const diffCalculator = new DiffCalculator(region);
      const comparison = diffCalculator.compareTemplates(
        stackName,
        deployedTemplate?.template || null,
        synthesized.template,
        'deployed',
        'synthesized'
      );
      comparisons.push(comparison);
    } catch (error) {
      console.warn(`Warning: Failed to process stack ${stackName}: ${error}`);
    }
  }
  
  if (comparisons.length === 0) {
    throw new Error('No comparisons generated');
  }
  
  const comment = formatter.generateGitHubComment(comparisons);
  
  if (output) {
    fs.writeFileSync(output, comment);
    console.log(`GitHub comment written to ${output}`);
  } else {
    console.log(comment);
  }
}

// Parse arguments and run
program.parse();

