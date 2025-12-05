/**
 * Output Formatter
 * Formats cost estimates and comparisons for various output formats
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { StackCostEstimate, CostComparison, ResourceChange, ResourceCost, CostDetail } from './types';
import { DiffCalculator } from './diff-calculator';
import { USAGE_BASED_RESOURCES } from './pricing-data';

export type OutputFormat = 'table' | 'json' | 'markdown' | 'github';

export class OutputFormatter {
  private diffCalculator: DiffCalculator;
  
  constructor(region: string = 'us-east-1') {
    this.diffCalculator = new DiffCalculator(region);
  }
  
  /**
   * Format a cost estimate for display
   */
  formatEstimate(estimate: StackCostEstimate, format: OutputFormat = 'table'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(estimate, null, 2);
      case 'markdown':
        return this.formatEstimateMarkdown(estimate);
      case 'github':
        return this.formatEstimateGitHub(estimate);
      case 'table':
      default:
        return this.formatEstimateTable(estimate);
    }
  }
  
  /**
   * Format a cost comparison for display
   */
  formatComparison(comparison: CostComparison, format: OutputFormat = 'table'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(comparison, null, 2);
      case 'markdown':
        return this.formatComparisonMarkdown(comparison);
      case 'github':
        return this.formatComparisonGitHub(comparison);
      case 'table':
      default:
        return this.formatComparisonTable(comparison);
    }
  }
  
  /**
   * Format multiple comparisons
   */
  formatMultipleComparisons(comparisons: CostComparison[], format: OutputFormat = 'table'): string {
    if (format === 'json') {
      return JSON.stringify(comparisons, null, 2);
    }
    
    const outputs: string[] = [];
    let totalBefore = 0;
    let totalAfter = 0;
    
    for (const comparison of comparisons) {
      outputs.push(this.formatComparison(comparison, format));
      totalBefore += comparison.before.totalMonthlyCost;
      totalAfter += comparison.after.totalMonthlyCost;
    }
    
    // Add summary
    const totalDiff = totalAfter - totalBefore;
    const totalPercent = totalBefore > 0 ? (totalDiff / totalBefore) * 100 : 0;
    
    if (format === 'github' || format === 'markdown') {
      outputs.push('\n---\n');
      outputs.push('## 📊 Total Summary\n');
      outputs.push(`| Metric | Value |`);
      outputs.push(`|--------|-------|`);
      outputs.push(`| Total Before | ${this.formatCurrency(totalBefore)}/month |`);
      outputs.push(`| Total After | ${this.formatCurrency(totalAfter)}/month |`);
      outputs.push(`| **Total Difference** | ${this.formatDifference(totalDiff)} (${totalPercent >= 0 ? '+' : ''}${totalPercent.toFixed(1)}%) |`);
    } else {
      const summaryTable = new Table({
        head: [chalk.bold.white('Total Summary'), chalk.bold.white('Value')],
        style: { head: [], border: [] },
      });
      
      summaryTable.push(
        ['Total Before', this.formatCurrency(totalBefore) + '/month'],
        ['Total After', this.formatCurrency(totalAfter) + '/month'],
        ['Total Difference', this.colorDifference(totalDiff) + ` (${totalPercent >= 0 ? '+' : ''}${totalPercent.toFixed(1)}%)`]
      );
      
      outputs.push('\n' + summaryTable.toString());
    }
    
    return outputs.join('\n');
  }
  
  /**
   * Format cost details into a short summary string
   */
  private formatCostDetails(details?: CostDetail[]): string | null {
    if (!details || details.length === 0) return null;
    
    // Find the most significant cost component
    const mainDetail = details.reduce((prev, current) => 
      (current.monthlyCost > prev.monthlyCost) ? current : prev
    , details[0]);
    
    if (mainDetail.quantity === 0 && mainDetail.monthlyCost === 0) return null;

    // Format: "est. 100 GB", "est. 1M requests"
    // Extract unit without "month" suffix for cleaner display
    const unit = mainDetail.unit.replace('/month', '').replace('/mo', '');
    
    // Format quantity: 1000 -> 1k, 1000000 -> 1M
    let quantityStr = mainDetail.quantity.toString();
    if (mainDetail.quantity >= 1000000) {
      quantityStr = `${(mainDetail.quantity / 1000000).toFixed(1)}M`;
    } else if (mainDetail.quantity >= 1000) {
      quantityStr = `${(mainDetail.quantity / 1000).toFixed(1)}k`;
    } else {
        quantityStr = mainDetail.quantity.toFixed(0);
    }

    return `est. ${quantityStr} ${unit}`;
  }

  /**
   * Format estimate as CLI table with detailed breakdown
   */
  private formatEstimateTable(estimate: StackCostEstimate): string {
    const output: string[] = [];
    
    output.push(chalk.bold.cyan(`\n📦 Stack: ${estimate.stackName}`));
    output.push(chalk.gray(`   Source: ${estimate.templateSource}`));
    output.push('');
    
    if (estimate.resources.length > 0) {
      const table = new Table({
        head: [
          chalk.bold.white('Resource'),
          chalk.bold.white('Monthly Qty'),
          chalk.bold.white('Unit'),
          chalk.bold.white('Monthly Cost'),
        ],
        style: { head: [], border: [] },
        colWidths: [50, 15, 15, 15],
        wordWrap: true
      });
      
      for (const resource of estimate.resources.sort((a, b) => b.monthlyCost - a.monthlyCost)) {
        // Main resource row
        table.push([
          { content: chalk.bold(this.truncate(resource.resourceId, 48)), colSpan: 3 },
          chalk.bold(this.formatCurrency(resource.monthlyCost))
        ]);

        // Detail rows
        if (resource.details && resource.details.length > 0) {
          for (const [index, detail] of resource.details.entries()) {
            const isLast = index === resource.details.length - 1;
            const treeSymbol = isLast ? '└─' : '├─';
            
            // Format quantity
            let quantityStr = detail.quantity.toString();
            if (detail.quantity >= 1000000) {
              quantityStr = `${(detail.quantity / 1000000).toFixed(1)}M`;
            } else if (detail.quantity >= 1000) {
              quantityStr = `${(detail.quantity / 1000).toFixed(1)}k`;
            } else if (detail.quantity % 1 !== 0) {
                quantityStr = detail.quantity.toFixed(2);
            }

            table.push([
              chalk.gray(`  ${treeSymbol} ${detail.component}`),
              chalk.gray(quantityStr),
              chalk.gray(detail.unit),
              chalk.gray(this.formatCurrency(detail.monthlyCost))
            ]);
          }
        } else {
            // No details available (shouldn't happen often with the new calculator)
             table.push([
              chalk.gray(`  └─ ${this.simplifyType(resource.resourceType)}`),
              chalk.gray('1'),
              chalk.gray(resource.unit),
              chalk.gray(this.formatCurrency(resource.monthlyCost))
            ]);
        }
      }
      
      output.push(table.toString());
    }
    
    // Summary
    output.push('');
    output.push(chalk.bold(`   💰 Total Monthly Cost: ${chalk.green(this.formatCurrency(estimate.totalMonthlyCost))}`));
    output.push(chalk.gray(`   📅 Estimated Annual: ${this.formatCurrency(estimate.totalMonthlyCost * 12)}`));
    
    if (estimate.unsupportedResources.length > 0) {
      output.push('');
      output.push(chalk.yellow(`   ⚠️  ${estimate.unsupportedResources.length} resources not priced (may have costs)`));
    }
    
    return output.join('\n');
  }
  
  /**
   * Format comparison as CLI table
   */
  private formatComparisonTable(comparison: CostComparison): string {
    const output: string[] = [];
    const stats = this.diffCalculator.getSummaryStats(comparison);
    const significantChanges = this.diffCalculator.getSignificantChanges(comparison);
    
    // Header
    output.push(chalk.bold.cyan(`\n📦 Stack: ${comparison.stackName}`));
    output.push(this.formatComparisonHeader(comparison));
    output.push('');
    
    // Resource changes table
    if (significantChanges.length > 0) {
      const table = new Table({
        head: [
          chalk.bold.white(''),
          chalk.bold.white('Resource'),
          chalk.bold.white('Type'),
          chalk.bold.white('Before'),
          chalk.bold.white('After'),
          chalk.bold.white('Diff'),
        ],
        style: { head: [], border: [] },
        colWidths: [3, 30, 35, 18, 18, 14],
      });
      
      for (const change of significantChanges.slice(0, 20)) { // Show top 20
        const isUsageBased = USAGE_BASED_RESOURCES.has(change.resourceType);
        
        let beforeDisplay = change.changeType === 'added' ? '-' : this.formatCurrency(change.beforeCost);
        let afterDisplay = change.changeType === 'removed' ? '-' : this.formatCurrency(change.afterCost);
        
        if (isUsageBased) {
          if (change.changeType !== 'added') {
            const details = this.formatCostDetails(change.beforeDetails);
            if (details) {
                beforeDisplay = `${this.formatCurrency(change.beforeCost)} (${details})`;
            } else if (change.beforeCost > 0) {
                beforeDisplay = `${beforeDisplay} + usage`;
            } else {
                beforeDisplay = 'Usage-based';
            }
          }
          if (change.changeType !== 'removed') {
             const details = this.formatCostDetails(change.afterDetails);
             if (details) {
                 afterDisplay = `${this.formatCurrency(change.afterCost)} (${details})`;
             } else if (change.afterCost > 0) {
                 afterDisplay = `${afterDisplay} + usage`;
             } else {
                 afterDisplay = 'Usage-based';
             }
          }
        }

        table.push([
          this.getChangeIcon(change.changeType),
          this.truncate(change.resourceId, 28),
          this.truncate(this.simplifyType(change.resourceType), 33),
          beforeDisplay,
          afterDisplay,
          this.colorDifference(change.costDifference),
        ]);
      }
      
      if (significantChanges.length > 20) {
        table.push(['', chalk.gray(`... and ${significantChanges.length - 20} more`), '', '', '', '']);
      }
      
      output.push(table.toString());
    } else {
      output.push(chalk.gray('   No significant cost changes detected'));
    }
    
    // Summary
    output.push('');
    output.push(this.formatChangeSummary(stats));
    output.push(this.formatCostSummary(comparison));
    
    return output.join('\n');
  }
  
  /**
   * Format estimate as Markdown
   */
  private formatEstimateMarkdown(estimate: StackCostEstimate): string {
    const lines: string[] = [];
    
    lines.push(`## 📦 Stack: ${estimate.stackName}`);
    lines.push(`> Source: ${estimate.templateSource}`);
    lines.push('');
    
    if (estimate.resources.length > 0) {
      lines.push('| Resource | Monthly Qty | Unit | Monthly Cost |');
      lines.push('|----------|------------:|------|-------------:|');
      
      for (const resource of estimate.resources.sort((a, b) => b.monthlyCost - a.monthlyCost)) {
        // Main resource row
        lines.push(`| **${resource.resourceId}** | | | **${this.formatCurrency(resource.monthlyCost)}** |`);
        
        // Detail rows
        if (resource.details && resource.details.length > 0) {
          for (const detail of resource.details) {
            // Format quantity
            let quantityStr = detail.quantity.toString();
            if (detail.quantity >= 1000000) {
              quantityStr = `${(detail.quantity / 1000000).toFixed(1)}M`;
            } else if (detail.quantity >= 1000) {
              quantityStr = `${(detail.quantity / 1000).toFixed(1)}k`;
            } else if (detail.quantity % 1 !== 0) {
                quantityStr = detail.quantity.toFixed(2);
            }

            lines.push(`| &nbsp;&nbsp; └─ ${detail.component} | ${quantityStr} | ${detail.unit} | ${this.formatCurrency(detail.monthlyCost)} |`);
          }
        }
      }
    }
    
    lines.push('');
    lines.push(`**💰 Total Monthly Cost: ${this.formatCurrency(estimate.totalMonthlyCost)}**`);
    lines.push(`📅 Estimated Annual: ${this.formatCurrency(estimate.totalMonthlyCost * 12)}`);
    
    if (estimate.unsupportedResources.length > 0) {
      lines.push('');
      lines.push(`⚠️ ${estimate.unsupportedResources.length} resources not priced`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Format comparison as Markdown
   */
  private formatComparisonMarkdown(comparison: CostComparison): string {
    const lines: string[] = [];
    const stats = this.diffCalculator.getSummaryStats(comparison);
    const significantChanges = this.diffCalculator.getSignificantChanges(comparison);
    
    lines.push(`## 📦 Stack: ${comparison.stackName}`);
    lines.push('');
    lines.push(`| | Before | After | Difference |`);
    lines.push(`|---|---:|---:|---:|`);
    lines.push(`| **Monthly Cost** | ${this.formatCurrency(comparison.before.totalMonthlyCost)} | ${this.formatCurrency(comparison.after.totalMonthlyCost)} | ${this.formatDifference(comparison.costDifference)} (${comparison.percentageChange >= 0 ? '+' : ''}${comparison.percentageChange.toFixed(1)}%) |`);
    lines.push('');
    
    if (significantChanges.length > 0) {
      lines.push('### Resource Changes');
      lines.push('');
      lines.push('| | Resource | Type | Before | After | Diff |');
      lines.push('|---|----------|------|-------:|------:|-----:|');
      
      for (const change of significantChanges.slice(0, 30)) {
        const icon = this.getMarkdownChangeIcon(change.changeType);
        const isUsageBased = USAGE_BASED_RESOURCES.has(change.resourceType);
        
        let beforeDisplay = change.changeType === 'added' ? '-' : this.formatCurrency(change.beforeCost);
        let afterDisplay = change.changeType === 'removed' ? '-' : this.formatCurrency(change.afterCost);

        if (isUsageBased) {
            if (change.changeType !== 'added') {
                const details = this.formatCostDetails(change.beforeDetails);
                if (details) {
                    beforeDisplay = `${this.formatCurrency(change.beforeCost)} <br>_(${details})_`;
                } else if (change.beforeCost > 0) {
                    beforeDisplay = `${this.formatCurrency(change.beforeCost)} + usage`;
                } else {
                    beforeDisplay = '_Usage-based_';
                }
            }
            if (change.changeType !== 'removed') {
                const details = this.formatCostDetails(change.afterDetails);
                if (details) {
                    afterDisplay = `${this.formatCurrency(change.afterCost)} <br>_(${details})_`;
                } else if (change.afterCost > 0) {
                    afterDisplay = `${this.formatCurrency(change.afterCost)} + usage`;
                } else {
                    afterDisplay = '_Usage-based_';
                }
            }
        }

        lines.push(`| ${icon} | ${change.resourceId} | ${this.simplifyType(change.resourceType)} | ${beforeDisplay} | ${afterDisplay} | ${this.formatDifference(change.costDifference)} |`);
      }
    }
    
    lines.push('');
    lines.push('### Summary');
    lines.push(`- ➕ Added: ${stats.totalAdded} resources (+${this.formatCurrency(stats.addedCost)})`);
    lines.push(`- ➖ Removed: ${stats.totalRemoved} resources (-${this.formatCurrency(stats.removedCost)})`);
    lines.push(`- 🔄 Modified: ${stats.totalModified} resources (${this.formatDifference(stats.modifiedCostChange)})`);
    
    return lines.join('\n');
  }
  
  /**
   * Format estimate for GitHub PR comments
   */
  private formatEstimateGitHub(estimate: StackCostEstimate): string {
    return this.formatEstimateMarkdown(estimate);
  }
  
  /**
   * Format comparison for GitHub PR comments
   */
  private formatComparisonGitHub(comparison: CostComparison): string {
    const lines: string[] = [];
    const stats = this.diffCalculator.getSummaryStats(comparison);
    const significantChanges = this.diffCalculator.getSignificantChanges(comparison);
    
    // Determine the overall trend emoji
    let trendEmoji = '➡️';
    if (comparison.costDifference > 1) {
      trendEmoji = '📈';
    } else if (comparison.costDifference < -1) {
      trendEmoji = '📉';
    }
    
    lines.push(`### ${trendEmoji} Stack: \`${comparison.stackName}\``);
    lines.push('');
    
    // Cost summary box
    lines.push('<table>');
    lines.push('<tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr>');
    lines.push(`<tr><td><strong>Monthly Cost</strong></td><td>${this.formatCurrency(comparison.before.totalMonthlyCost)}</td><td>${this.formatCurrency(comparison.after.totalMonthlyCost)}</td><td><strong>${this.formatDifference(comparison.costDifference)}</strong> (${comparison.percentageChange >= 0 ? '+' : ''}${comparison.percentageChange.toFixed(1)}%)</td></tr>`);
    lines.push(`<tr><td>Annual Cost</td><td>${this.formatCurrency(comparison.before.totalMonthlyCost * 12)}</td><td>${this.formatCurrency(comparison.after.totalMonthlyCost * 12)}</td><td>${this.formatDifference(comparison.costDifference * 12)}</td></tr>`);
    lines.push('</table>');
    lines.push('');
    
    // Resource changes
    if (significantChanges.length > 0) {
      lines.push('<details>');
      lines.push(`<summary>📋 Resource Changes (${significantChanges.length} with cost impact)</summary>`);
      lines.push('');
      lines.push('| | Resource | Type | Before | After | Diff |');
      lines.push('|---|----------|------|-------:|------:|-----:|');
      
      for (const change of significantChanges.slice(0, 50)) {
        const icon = this.getMarkdownChangeIcon(change.changeType);
        const isUsageBased = USAGE_BASED_RESOURCES.has(change.resourceType);
        
        let beforeDisplay = change.changeType === 'added' ? '-' : this.formatCurrency(change.beforeCost);
        let afterDisplay = change.changeType === 'removed' ? '-' : this.formatCurrency(change.afterCost);

        if (isUsageBased) {
            if (change.changeType !== 'added') {
                const details = this.formatCostDetails(change.beforeDetails);
                if (details) {
                    beforeDisplay = `${this.formatCurrency(change.beforeCost)} <br>_(${details})_`;
                } else if (change.beforeCost > 0) {
                    beforeDisplay = `${this.formatCurrency(change.beforeCost)} + usage`;
                } else {
                    beforeDisplay = '_Usage-based_';
                }
            }
            if (change.changeType !== 'removed') {
                const details = this.formatCostDetails(change.afterDetails);
                if (details) {
                    afterDisplay = `${this.formatCurrency(change.afterCost)} <br>_(${details})_`;
                } else if (change.afterCost > 0) {
                    afterDisplay = `${this.formatCurrency(change.afterCost)} + usage`;
                } else {
                    afterDisplay = '_Usage-based_';
                }
            }
        }

        lines.push(`| ${icon} | \`${change.resourceId}\` | ${this.simplifyType(change.resourceType)} | ${beforeDisplay} | ${afterDisplay} | ${this.formatDifference(change.costDifference)} |`);
      }
      
      lines.push('');
      lines.push('</details>');
    }
    
    // Quick stats
    lines.push('');
    lines.push(`> ➕ ${stats.totalAdded} added (+${this.formatCurrency(stats.addedCost)}) • ➖ ${stats.totalRemoved} removed (-${this.formatCurrency(stats.removedCost)}) • 🔄 ${stats.totalModified} modified`);
    
    return lines.join('\n');
  }
  
  /**
   * Format currency value
   */
  private formatCurrency(value: number): string {
    if (value < 0.01 && value > 0) {
      return '<$0.01';
    }
    return '$' + value.toFixed(2);
  }
  
  /**
   * Format difference with sign
   */
  private formatDifference(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return sign + this.formatCurrency(value);
  }
  
  /**
   * Color code a difference value for CLI
   */
  private colorDifference(value: number): string {
    const formatted = this.formatDifference(value);
    if (value > 0) {
      return chalk.red(formatted);
    } else if (value < 0) {
      return chalk.green(formatted);
    }
    return chalk.gray(formatted);
  }
  
  /**
   * Color code confidence level
   */
  private colorConfidence(confidence: 'high' | 'medium' | 'low' | 'unknown'): string {
    switch (confidence) {
      case 'high':
        return chalk.green('high');
      case 'medium':
        return chalk.yellow('medium');
      case 'low':
        return chalk.red('low');
      default:
        return chalk.gray('unknown');
    }
  }
  
  /**
   * Get icon for change type (CLI)
   */
  private getChangeIcon(changeType: ResourceChange['changeType']): string {
    switch (changeType) {
      case 'added':
        return chalk.green('+');
      case 'removed':
        return chalk.red('-');
      case 'modified':
        return chalk.yellow('~');
      default:
        return chalk.gray(' ');
    }
  }
  
  /**
   * Get icon for change type (Markdown)
   */
  private getMarkdownChangeIcon(changeType: ResourceChange['changeType']): string {
    switch (changeType) {
      case 'added':
        return '🟢';
      case 'removed':
        return '🔴';
      case 'modified':
        return '🟡';
      default:
        return '⚪';
    }
  }
  
  /**
   * Simplify AWS resource type for display
   */
  private simplifyType(type: string): string {
    return type.replace('AWS::', '').replace('::', '/');
  }
  
  /**
   * Truncate string for table display
   */
  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength - 3) + '...';
  }
  
  /**
   * Format comparison header
   */
  private formatComparisonHeader(comparison: CostComparison): string {
    const arrow = comparison.costDifference > 0 
      ? chalk.red('↑') 
      : comparison.costDifference < 0 
        ? chalk.green('↓') 
        : chalk.gray('→');
    
    return `   ${chalk.gray(comparison.before.templateSource)} ${arrow} ${chalk.gray(comparison.after.templateSource)}`;
  }
  
  /**
   * Format change summary line
   */
  private formatChangeSummary(stats: ReturnType<DiffCalculator['getSummaryStats']>): string {
    const parts: string[] = [];
    
    if (stats.totalAdded > 0) {
      parts.push(chalk.green(`+${stats.totalAdded} added`));
    }
    if (stats.totalRemoved > 0) {
      parts.push(chalk.red(`-${stats.totalRemoved} removed`));
    }
    if (stats.totalModified > 0) {
      parts.push(chalk.yellow(`~${stats.totalModified} modified`));
    }
    
    return `   📊 Changes: ${parts.join(', ') || chalk.gray('none')}`;
  }
  
  /**
   * Format cost summary line
   */
  private formatCostSummary(comparison: CostComparison): string {
    const before = this.formatCurrency(comparison.before.totalMonthlyCost);
    const after = this.formatCurrency(comparison.after.totalMonthlyCost);
    const diff = this.colorDifference(comparison.costDifference);
    const percent = `${comparison.percentageChange >= 0 ? '+' : ''}${comparison.percentageChange.toFixed(1)}%`;
    
    return `   💰 Monthly: ${chalk.gray(before)} → ${chalk.white(after)} (${diff}, ${percent})`;
  }
  
  /**
   * Generate a summary comment for GitHub
   */
  generateGitHubComment(comparisons: CostComparison[]): string {
    const lines: string[] = [];
    
    // Header
    lines.push('## 💰 CloudFormation Cost Estimate');
    lines.push('');
    lines.push('*Estimated infrastructure costs based on CloudFormation changes*');
    lines.push('');
    
    // Calculate totals
    let totalBefore = 0;
    let totalAfter = 0;
    
    for (const comparison of comparisons) {
      totalBefore += comparison.before.totalMonthlyCost;
      totalAfter += comparison.after.totalMonthlyCost;
    }
    
    const totalDiff = totalAfter - totalBefore;
    const totalPercent = totalBefore > 0 ? (totalDiff / totalBefore) * 100 : (totalAfter > 0 ? 100 : 0);
    
    // Overall summary
    let emoji = '➡️';
    if (totalDiff > 10) emoji = '📈';
    else if (totalDiff < -10) emoji = '📉';
    else if (Math.abs(totalDiff) < 1) emoji = '✅';
    
    lines.push(`### ${emoji} Overall Impact`);
    lines.push('');
    lines.push(`| | Monthly | Annual |`);
    lines.push(`|---|---:|---:|`);
    lines.push(`| **Before** | ${this.formatCurrency(totalBefore)} | ${this.formatCurrency(totalBefore * 12)} |`);
    lines.push(`| **After** | ${this.formatCurrency(totalAfter)} | ${this.formatCurrency(totalAfter * 12)} |`);
    lines.push(`| **Change** | ${this.formatDifference(totalDiff)} (${totalPercent >= 0 ? '+' : ''}${totalPercent.toFixed(1)}%) | ${this.formatDifference(totalDiff * 12)} |`);
    lines.push('');
    
    // Per-stack details
    if (comparisons.length > 1) {
      lines.push('---');
      lines.push('');
    }
    
    for (const comparison of comparisons) {
      lines.push(this.formatComparisonGitHub(comparison));
      lines.push('');
    }
    
    // Footer
    lines.push('---');
    lines.push('');
    lines.push('<sub>');
    lines.push('');
    lines.push('ℹ️ **Note**: Costs are estimates based on resource configurations. Actual costs may vary based on:');
    lines.push('- Usage patterns (requests, data transfer, etc.)');
    lines.push('- Reserved instances or savings plans');
    lines.push('- Free tier eligibility');
    lines.push('');
    lines.push('*Generated by cfn-cost-estimate*');
    lines.push('</sub>');
    
    return lines.join('\n');
  }
}

