/**
 * CloudFormation Cost Estimate
 * A tool to estimate and compare AWS CloudFormation/CDK stack costs
 */

// Export types
export * from './types';

// Export main classes
export { TemplateParser } from './template-parser';
export { TemplateFetcher, type FetchedTemplate, type StackInfo } from './template-fetcher';
export { CostCalculator } from './cost-calculator';
export { DiffCalculator } from './diff-calculator';
export { OutputFormatter, type OutputFormat } from './output-formatter';

// Export pricing utilities
export { 
  getRegionalPricing, 
  HOURS_PER_MONTH, 
  DEFAULT_REGION,
  FREE_RESOURCES,
  USAGE_BASED_RESOURCES,
} from './pricing-data';

// Convenience function for programmatic usage
import { TemplateFetcher } from './template-fetcher';
import { DiffCalculator } from './diff-calculator';
import { OutputFormatter } from './output-formatter';
import { CostComparison } from './types';

export interface CompareOptions {
  cdkOutDir: string;
  stackNames?: string[];
  region?: string;
  profile?: string;
}

/**
 * Compare CDK stacks with their deployed versions
 * Returns cost comparisons for all stacks
 */
export async function compareCdkStacks(options: CompareOptions): Promise<CostComparison[]> {
  const { cdkOutDir, stackNames, region = 'us-east-1', profile } = options;
  
  const fetcher = new TemplateFetcher(region, profile);
  const diffCalculator = new DiffCalculator(region);
  
  // Get stack names if not provided
  let stacks = stackNames;
  if (!stacks || stacks.length === 0) {
    stacks = await TemplateFetcher.discoverCdkStacks(cdkOutDir);
  }
  
  const comparisons: CostComparison[] = [];
  
  for (const stackName of stacks) {
    try {
      const { deployed, synthesized } = await fetcher.fetchForComparison(cdkOutDir, stackName);
      
      const comparison = diffCalculator.compareTemplates(
        stackName,
        deployed?.template || null,
        synthesized.template,
        'deployed',
        'synthesized'
      );
      
      comparisons.push(comparison);
    } catch (error) {
      console.warn(`Warning: Failed to process stack ${stackName}: ${error}`);
    }
  }
  
  return comparisons;
}

/**
 * Generate a GitHub PR comment from cost comparisons
 */
export function generateGitHubComment(
  comparisons: CostComparison[],
  region: string = 'us-east-1'
): string {
  const formatter = new OutputFormatter(region);
  return formatter.generateGitHubComment(comparisons);
}

