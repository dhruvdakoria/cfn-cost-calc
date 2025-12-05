/**
 * Type definitions for CloudFormation cost estimation
 */

export interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Parameters?: Record<string, unknown>;
  Mappings?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
  Resources: Record<string, CloudFormationResource>;
  Outputs?: Record<string, unknown>;
}

export interface CloudFormationResource {
  Type: string;
  Properties?: Record<string, unknown>;
  Metadata?: Record<string, unknown>;
  DependsOn?: string | string[];
  Condition?: string;
}

export interface ResourceCost {
  resourceId: string;
  resourceType: string;
  resourceName?: string;
  monthlyCost: number;
  hourlyCost: number;
  unit: string;
  details: CostDetail[];
  confidence: 'high' | 'medium' | 'low' | 'unknown';
}

export interface CostDetail {
  component: string;
  quantity: number;
  unitPrice: number;
  monthlyCost: number;
  unit: string;
}

export interface StackCostEstimate {
  stackName: string;
  templateSource: 'deployed' | 'synthesized' | 'local';
  totalMonthlyCost: number;
  totalHourlyCost: number;
  resources: ResourceCost[];
  unsupportedResources: UnsupportedResource[];
  timestamp: string;
}

export interface UnsupportedResource {
  resourceId: string;
  resourceType: string;
  reason: string;
}

export interface CostComparison {
  stackName: string;
  before: StackCostEstimate;
  after: StackCostEstimate;
  costDifference: number;
  percentageChange: number;
  resourceChanges: ResourceChange[];
}

export interface ResourceChange {
  resourceId: string;
  resourceType: string;
  changeType: 'added' | 'removed' | 'modified' | 'unchanged';
  beforeCost: number;
  afterCost: number;
  costDifference: number;
}

export interface PricingRule {
  resourceType: string;
  calculator: (properties: Record<string, unknown>, region: string) => ResourceCost;
}

export interface RegionPricing {
  region: string;
  services: Record<string, ServicePricing>;
}

export interface ServicePricing {
  [key: string]: number | Record<string, number>;
}

export interface CLIOptions {
  stackNames?: string[];
  cdkOutDir?: string;
  region?: string;
  profile?: string;
  format?: 'table' | 'json' | 'markdown';
  compareDeployed?: boolean;
  outputFile?: string;
  verbose?: boolean;
}

