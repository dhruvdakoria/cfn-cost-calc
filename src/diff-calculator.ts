/**
 * Diff Calculator
 * Compares two stack cost estimates and calculates the difference
 */

import { StackCostEstimate, CostComparison, ResourceChange, CloudFormationTemplate } from './types';
import { TemplateParser } from './template-parser';
import { CostCalculator } from './cost-calculator';

export class DiffCalculator {
  private costCalculator: CostCalculator;
  
  constructor(region: string = 'us-east-1') {
    this.costCalculator = new CostCalculator(region);
  }
  
  /**
   * Compare two stack cost estimates
   */
  compareEstimates(
    before: StackCostEstimate,
    after: StackCostEstimate
  ): CostComparison {
    const resourceChanges: ResourceChange[] = [];
    
    // Create maps for quick lookup
    const beforeResources = new Map(
      before.resources.map(r => [r.resourceId, r])
    );
    const afterResources = new Map(
      after.resources.map(r => [r.resourceId, r])
    );
    
    // Find added and modified resources
    for (const [resourceId, afterResource] of afterResources) {
      const beforeResource = beforeResources.get(resourceId);
      
      if (!beforeResource) {
        // Added resource
        resourceChanges.push({
          resourceId,
          resourceType: afterResource.resourceType,
          changeType: 'added',
          beforeCost: 0,
          afterCost: afterResource.monthlyCost,
          costDifference: afterResource.monthlyCost,
        });
      } else if (Math.abs(beforeResource.monthlyCost - afterResource.monthlyCost) > 0.01) {
        // Modified resource with cost change
        resourceChanges.push({
          resourceId,
          resourceType: afterResource.resourceType,
          changeType: 'modified',
          beforeCost: beforeResource.monthlyCost,
          afterCost: afterResource.monthlyCost,
          costDifference: afterResource.monthlyCost - beforeResource.monthlyCost,
        });
      } else {
        // Unchanged resource
        resourceChanges.push({
          resourceId,
          resourceType: afterResource.resourceType,
          changeType: 'unchanged',
          beforeCost: beforeResource.monthlyCost,
          afterCost: afterResource.monthlyCost,
          costDifference: 0,
        });
      }
    }
    
    // Find removed resources
    for (const [resourceId, beforeResource] of beforeResources) {
      if (!afterResources.has(resourceId)) {
        resourceChanges.push({
          resourceId,
          resourceType: beforeResource.resourceType,
          changeType: 'removed',
          beforeCost: beforeResource.monthlyCost,
          afterCost: 0,
          costDifference: -beforeResource.monthlyCost,
        });
      }
    }
    
    // Sort by absolute cost difference (highest first)
    resourceChanges.sort((a, b) => Math.abs(b.costDifference) - Math.abs(a.costDifference));
    
    const costDifference = after.totalMonthlyCost - before.totalMonthlyCost;
    const percentageChange = before.totalMonthlyCost > 0
      ? (costDifference / before.totalMonthlyCost) * 100
      : (costDifference > 0 ? 100 : 0);
    
    return {
      stackName: after.stackName,
      before,
      after,
      costDifference,
      percentageChange,
      resourceChanges,
    };
  }
  
  /**
   * Compare two CloudFormation templates and calculate cost difference
   */
  compareTemplates(
    stackName: string,
    beforeTemplate: CloudFormationTemplate | null,
    afterTemplate: CloudFormationTemplate,
    beforeSource: 'deployed' | 'synthesized' | 'local' = 'deployed',
    afterSource: 'deployed' | 'synthesized' | 'local' = 'synthesized'
  ): CostComparison {
    // Calculate cost for before template (or create empty estimate if null)
    const before: StackCostEstimate = beforeTemplate
      ? this.costCalculator.calculateStackCost(stackName, beforeTemplate, beforeSource)
      : {
          stackName,
          templateSource: beforeSource,
          totalMonthlyCost: 0,
          totalHourlyCost: 0,
          resources: [],
          unsupportedResources: [],
          timestamp: new Date().toISOString(),
        };
    
    // Calculate cost for after template
    const after = this.costCalculator.calculateStackCost(stackName, afterTemplate, afterSource);
    
    return this.compareEstimates(before, after);
  }
  
  /**
   * Get summary statistics for a comparison
   */
  getSummaryStats(comparison: CostComparison): {
    totalAdded: number;
    totalRemoved: number;
    totalModified: number;
    totalUnchanged: number;
    addedCost: number;
    removedCost: number;
    modifiedCostChange: number;
  } {
    let totalAdded = 0;
    let totalRemoved = 0;
    let totalModified = 0;
    let totalUnchanged = 0;
    let addedCost = 0;
    let removedCost = 0;
    let modifiedCostChange = 0;
    
    for (const change of comparison.resourceChanges) {
      switch (change.changeType) {
        case 'added':
          totalAdded++;
          addedCost += change.costDifference;
          break;
        case 'removed':
          totalRemoved++;
          removedCost += Math.abs(change.costDifference);
          break;
        case 'modified':
          totalModified++;
          modifiedCostChange += change.costDifference;
          break;
        case 'unchanged':
          totalUnchanged++;
          break;
      }
    }
    
    return {
      totalAdded,
      totalRemoved,
      totalModified,
      totalUnchanged,
      addedCost,
      removedCost,
      modifiedCostChange,
    };
  }
  
  /**
   * Filter resource changes by change type
   */
  filterChanges(
    comparison: CostComparison,
    changeTypes: Array<'added' | 'removed' | 'modified' | 'unchanged'>
  ): ResourceChange[] {
    return comparison.resourceChanges.filter(change => 
      changeTypes.includes(change.changeType)
    );
  }
  
  /**
   * Get only significant changes (non-zero cost difference)
   */
  getSignificantChanges(comparison: CostComparison): ResourceChange[] {
    return comparison.resourceChanges.filter(change => 
      change.changeType !== 'unchanged' && Math.abs(change.costDifference) > 0.01
    );
  }
}

