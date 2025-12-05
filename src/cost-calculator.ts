/**
 * Cost Calculator
 * Calculates monthly costs for CloudFormation resources
 */

import { CloudFormationTemplate, CloudFormationResource, ResourceCost, CostDetail, StackCostEstimate, UnsupportedResource } from './types';
import { getRegionalPricing, HOURS_PER_MONTH, FREE_RESOURCES, USAGE_BASED_RESOURCES, RegionalPricing } from './pricing-data';
import { TemplateParser } from './template-parser';

type ResourceCostCalculator = (
  logicalId: string,
  resource: CloudFormationResource,
  template: CloudFormationTemplate,
  pricing: RegionalPricing
) => ResourceCost | null;

export class CostCalculator {
  private pricing: RegionalPricing;
  private region: string;
  private calculators: Map<string, ResourceCostCalculator>;
  
  constructor(region: string = 'us-east-1') {
    this.region = region;
    this.pricing = getRegionalPricing(region);
    this.calculators = this.initializeCalculators();
  }
  
  /**
   * Calculate costs for an entire stack
   */
  calculateStackCost(
    stackName: string,
    template: CloudFormationTemplate,
    source: 'deployed' | 'synthesized' | 'local'
  ): StackCostEstimate {
    const resources: ResourceCost[] = [];
    const unsupportedResources: UnsupportedResource[] = [];
    
    const templateResources = TemplateParser.extractResources(template);
    
    for (const [logicalId, resource] of templateResources) {
      const resourceType = resource.Type;
      
      // Skip free resources
      if (this.isFreeResource(resourceType)) {
        continue;
      }
      
      // Try to calculate cost
      const calculator = this.calculators.get(resourceType);
      
      if (calculator) {
        try {
          const cost = calculator(logicalId, resource, template, this.pricing);
          if (cost) {
            resources.push(cost);
          }
        } catch (error) {
          unsupportedResources.push({
            resourceId: logicalId,
            resourceType,
            reason: `Calculation error: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } else if (USAGE_BASED_RESOURCES.has(resourceType)) {
        // Usage-based resources - provide estimate with assumptions
        const cost = this.calculateUsageBasedResource(logicalId, resource, template);
        if (cost) {
          resources.push(cost);
        }
      } else {
        unsupportedResources.push({
          resourceId: logicalId,
          resourceType,
          reason: 'No pricing calculator available for this resource type',
        });
      }
    }
    
    // Calculate totals
    const totalMonthlyCost = resources.reduce((sum, r) => sum + r.monthlyCost, 0);
    const totalHourlyCost = resources.reduce((sum, r) => sum + r.hourlyCost, 0);
    
    return {
      stackName,
      templateSource: source,
      totalMonthlyCost,
      totalHourlyCost,
      resources,
      unsupportedResources,
      timestamp: new Date().toISOString(),
    };
  }
  
  /**
   * Check if a resource type is free
   */
  private isFreeResource(resourceType: string): boolean {
    if (FREE_RESOURCES.has(resourceType)) {
      return true;
    }
    
    // Check for Custom:: prefix
    if (resourceType.startsWith('Custom::')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Calculate cost for usage-based resources with default assumptions
   */
  private calculateUsageBasedResource(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost | null {
    const resourceType = resource.Type;
    
    switch (resourceType) {
      case 'AWS::Lambda::Function':
        return this.calculateLambdaCost(logicalId, resource, template);
      case 'AWS::DynamoDB::Table':
        return this.calculateDynamoDBCost(logicalId, resource, template);
      case 'AWS::S3::Bucket':
        return this.calculateS3Cost(logicalId, resource, template);
      case 'AWS::SQS::Queue':
        return this.calculateSQSCost(logicalId, resource, template);
      case 'AWS::ApiGateway::RestApi':
      case 'AWS::ApiGatewayV2::Api':
        return this.calculateApiGatewayCost(logicalId, resource, template);
      case 'AWS::StepFunctions::StateMachine':
        return this.calculateStepFunctionsCost(logicalId, resource, template);
      default:
        return null;
    }
  }
  
  /**
   * Initialize calculators for supported resource types
   */
  private initializeCalculators(): Map<string, ResourceCostCalculator> {
    const calculators = new Map<string, ResourceCostCalculator>();
    
    // EC2 Instance
    calculators.set('AWS::EC2::Instance', (logicalId, resource, template, pricing) => {
      const instanceType = TemplateParser.getPropertyValue(template, resource, 'InstanceType', 't3.micro') as string;
      const hourlyPrice = pricing.ec2[instanceType] || pricing.ec2['t3.micro'];
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::Instance',
        monthlyCost: hourlyPrice * HOURS_PER_MONTH,
        hourlyCost: hourlyPrice,
        unit: 'instance',
        details: [{
          component: `EC2 ${instanceType}`,
          quantity: 1,
          unitPrice: hourlyPrice,
          monthlyCost: hourlyPrice * HOURS_PER_MONTH,
          unit: 'hour',
        }],
        confidence: 'high',
      };
    });
    
    // Auto Scaling Group
    calculators.set('AWS::AutoScaling::AutoScalingGroup', (logicalId, resource, template, pricing) => {
      const minSize = TemplateParser.getPropertyValue(template, resource, 'MinSize', 1) as number;
      const maxSize = TemplateParser.getPropertyValue(template, resource, 'MaxSize', 1) as number;
      const desiredCapacity = TemplateParser.getPropertyValue(template, resource, 'DesiredCapacity', minSize) as number;
      
      // Try to get instance type from launch template or launch config
      let instanceType = 't3.micro';
      const launchTemplate = resource.Properties?.LaunchTemplate as Record<string, unknown> | undefined;
      const launchConfig = resource.Properties?.LaunchConfigurationName;
      
      // Use desired capacity as the baseline for estimation
      const instanceCount = typeof desiredCapacity === 'number' ? desiredCapacity : minSize;
      const hourlyPrice = pricing.ec2[instanceType] || pricing.ec2['t3.micro'];
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::AutoScaling::AutoScalingGroup',
        monthlyCost: hourlyPrice * HOURS_PER_MONTH * instanceCount,
        hourlyCost: hourlyPrice * instanceCount,
        unit: 'instances',
        details: [{
          component: `ASG (${instanceCount} x ${instanceType})`,
          quantity: instanceCount,
          unitPrice: hourlyPrice * HOURS_PER_MONTH,
          monthlyCost: hourlyPrice * HOURS_PER_MONTH * instanceCount,
          unit: 'instance/month',
        }],
        confidence: launchTemplate || launchConfig ? 'medium' : 'low',
      };
    });
    
    // EBS Volume
    calculators.set('AWS::EC2::Volume', (logicalId, resource, template, pricing) => {
      const volumeType = (TemplateParser.getPropertyValue(template, resource, 'VolumeType', 'gp3') as string).toLowerCase();
      const size = TemplateParser.getPropertyValue(template, resource, 'Size', 100) as number;
      const iops = TemplateParser.getPropertyValue(template, resource, 'Iops', 3000) as number;
      
      const priceKey = volumeType as keyof typeof pricing.ebs;
      const pricePerGB = pricing.ebs[priceKey] || pricing.ebs.gp3;
      let monthlyCost = pricePerGB * size;
      
      const details: CostDetail[] = [{
        component: `EBS ${volumeType.toUpperCase()} Storage`,
        quantity: size,
        unitPrice: pricePerGB,
        monthlyCost: pricePerGB * size,
        unit: 'GB/month',
      }];
      
      // Add IOPS cost for io1/io2
      if (volumeType === 'io1' || volumeType === 'io2') {
        const iopsPrice = 0.065; // per IOPS/month
        const iopsCost = iopsPrice * iops;
        monthlyCost += iopsCost;
        details.push({
          component: 'Provisioned IOPS',
          quantity: iops,
          unitPrice: iopsPrice,
          monthlyCost: iopsCost,
          unit: 'IOPS/month',
        });
      }
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::Volume',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'volume',
        details,
        confidence: 'high',
      };
    });
    
    // RDS Instance
    calculators.set('AWS::RDS::DBInstance', (logicalId, resource, template, pricing) => {
      const instanceClass = TemplateParser.getPropertyValue(template, resource, 'DBInstanceClass', 'db.t3.micro') as string;
      const allocatedStorage = TemplateParser.getPropertyValue(template, resource, 'AllocatedStorage', 20) as number;
      const multiAZ = TemplateParser.getPropertyValue(template, resource, 'MultiAZ', false) as boolean;
      const storageType = TemplateParser.getPropertyValue(template, resource, 'StorageType', 'gp2') as string;
      
      const hourlyPrice = pricing.rds[instanceClass] || pricing.rds['db.t3.micro'];
      const instanceCost = hourlyPrice * HOURS_PER_MONTH * (multiAZ ? 2 : 1);
      
      const storagePrice = storageType === 'io1' ? 0.125 : 0.115; // GP2/GP3
      const storageCost = storagePrice * allocatedStorage * (multiAZ ? 2 : 1);
      
      const details: CostDetail[] = [
        {
          component: `RDS ${instanceClass}${multiAZ ? ' (Multi-AZ)' : ''}`,
          quantity: multiAZ ? 2 : 1,
          unitPrice: hourlyPrice * HOURS_PER_MONTH,
          monthlyCost: instanceCost,
          unit: 'instance/month',
        },
        {
          component: `Storage (${storageType})`,
          quantity: allocatedStorage,
          unitPrice: storagePrice,
          monthlyCost: storageCost,
          unit: 'GB/month',
        },
      ];
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::RDS::DBInstance',
        monthlyCost: instanceCost + storageCost,
        hourlyCost: (instanceCost + storageCost) / HOURS_PER_MONTH,
        unit: 'instance',
        details,
        confidence: 'high',
      };
    });
    
    // RDS Cluster (Aurora)
    calculators.set('AWS::RDS::DBCluster', (logicalId, resource, template, pricing) => {
      const engineMode = TemplateParser.getPropertyValue(template, resource, 'EngineMode', 'provisioned') as string;
      
      if (engineMode === 'serverless') {
        // Aurora Serverless v1 - estimate based on min/max capacity
        const minCapacity = TemplateParser.getPropertyValue(template, resource, 'ScalingConfiguration.MinCapacity', 2) as number;
        const maxCapacity = TemplateParser.getPropertyValue(template, resource, 'ScalingConfiguration.MaxCapacity', 8) as number;
        
        const avgCapacity = (minCapacity + maxCapacity) / 2;
        const acuPrice = 0.06; // per ACU-hour
        const monthlyCost = acuPrice * avgCapacity * HOURS_PER_MONTH;
        
        return {
          resourceId: logicalId,
          resourceType: 'AWS::RDS::DBCluster',
          monthlyCost,
          hourlyCost: monthlyCost / HOURS_PER_MONTH,
          unit: 'cluster',
          details: [{
            component: `Aurora Serverless (avg ${avgCapacity} ACU)`,
            quantity: avgCapacity,
            unitPrice: acuPrice * HOURS_PER_MONTH,
            monthlyCost,
            unit: 'ACU/month',
          }],
          confidence: 'medium',
        };
      }
      
      // Provisioned Aurora - cost is from DB instances, cluster itself is free
      return {
        resourceId: logicalId,
        resourceType: 'AWS::RDS::DBCluster',
        monthlyCost: 0,
        hourlyCost: 0,
        unit: 'cluster',
        details: [{
          component: 'Aurora Cluster (cost in DB instances)',
          quantity: 1,
          unitPrice: 0,
          monthlyCost: 0,
          unit: 'cluster',
        }],
        confidence: 'high',
      };
    });
    
    // ElastiCache Cluster
    calculators.set('AWS::ElastiCache::CacheCluster', (logicalId, resource, template, pricing) => {
      const nodeType = TemplateParser.getPropertyValue(template, resource, 'CacheNodeType', 'cache.t3.micro') as string;
      const numNodes = TemplateParser.getPropertyValue(template, resource, 'NumCacheNodes', 1) as number;
      
      const hourlyPrice = pricing.elasticache[nodeType] || pricing.elasticache['cache.t3.micro'];
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * numNodes;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::ElastiCache::CacheCluster',
        monthlyCost,
        hourlyCost: hourlyPrice * numNodes,
        unit: 'cluster',
        details: [{
          component: `ElastiCache ${nodeType}`,
          quantity: numNodes,
          unitPrice: hourlyPrice * HOURS_PER_MONTH,
          monthlyCost,
          unit: 'node/month',
        }],
        confidence: 'high',
      };
    });
    
    // ElastiCache Replication Group
    calculators.set('AWS::ElastiCache::ReplicationGroup', (logicalId, resource, template, pricing) => {
      const nodeType = TemplateParser.getPropertyValue(template, resource, 'CacheNodeType', 'cache.t3.micro') as string;
      const numNodeGroups = TemplateParser.getPropertyValue(template, resource, 'NumNodeGroups', 1) as number;
      const replicasPerNodeGroup = TemplateParser.getPropertyValue(template, resource, 'ReplicasPerNodeGroup', 1) as number;
      
      const totalNodes = numNodeGroups * (1 + replicasPerNodeGroup);
      const hourlyPrice = pricing.elasticache[nodeType] || pricing.elasticache['cache.t3.micro'];
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * totalNodes;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::ElastiCache::ReplicationGroup',
        monthlyCost,
        hourlyCost: hourlyPrice * totalNodes,
        unit: 'replication group',
        details: [{
          component: `ElastiCache ${nodeType} (${totalNodes} nodes)`,
          quantity: totalNodes,
          unitPrice: hourlyPrice * HOURS_PER_MONTH,
          monthlyCost,
          unit: 'node/month',
        }],
        confidence: 'high',
      };
    });
    
    // NAT Gateway
    calculators.set('AWS::EC2::NatGateway', (logicalId, resource, template, pricing) => {
      const monthlyCost = pricing.nat.gatewayPerHour * HOURS_PER_MONTH;
      
      // Add estimated data processing cost (assume 100GB/month)
      const estimatedDataGB = 100;
      const dataProcessingCost = pricing.nat.dataProcessedPerGB * estimatedDataGB;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::NatGateway',
        monthlyCost: monthlyCost + dataProcessingCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'gateway',
        details: [
          {
            component: 'NAT Gateway Hourly',
            quantity: HOURS_PER_MONTH,
            unitPrice: pricing.nat.gatewayPerHour,
            monthlyCost,
            unit: 'hours',
          },
          {
            component: 'Data Processing (est. 100GB)',
            quantity: estimatedDataGB,
            unitPrice: pricing.nat.dataProcessedPerGB,
            monthlyCost: dataProcessingCost,
            unit: 'GB',
          },
        ],
        confidence: 'medium',
      };
    });
    
    // Application Load Balancer
    calculators.set('AWS::ElasticLoadBalancingV2::LoadBalancer', (logicalId, resource, template, pricing) => {
      const type = TemplateParser.getPropertyValue(template, resource, 'Type', 'application') as string;
      
      const isNLB = type.toLowerCase() === 'network';
      const lbPricing = isNLB ? pricing.nlb : pricing.alb;
      
      const baseHourlyCost = lbPricing.perHour * HOURS_PER_MONTH;
      
      // Estimate LCU cost (assume 10 LCU average)
      const estimatedLCU = 10;
      const lcuCost = lbPricing.lcuPerHour * HOURS_PER_MONTH * estimatedLCU;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
        monthlyCost: baseHourlyCost + lcuCost,
        hourlyCost: (baseHourlyCost + lcuCost) / HOURS_PER_MONTH,
        unit: 'load balancer',
        details: [
          {
            component: `${isNLB ? 'NLB' : 'ALB'} Hourly`,
            quantity: HOURS_PER_MONTH,
            unitPrice: lbPricing.perHour,
            monthlyCost: baseHourlyCost,
            unit: 'hours',
          },
          {
            component: 'LCU (est. 10 avg)',
            quantity: estimatedLCU * HOURS_PER_MONTH,
            unitPrice: lbPricing.lcuPerHour,
            monthlyCost: lcuCost,
            unit: 'LCU-hours',
          },
        ],
        confidence: 'medium',
      };
    });
    
    // Classic Load Balancer
    calculators.set('AWS::ElasticLoadBalancing::LoadBalancer', (logicalId, resource, template, pricing) => {
      const elbHourlyPrice = 0.025;
      const monthlyCost = elbHourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::ElasticLoadBalancing::LoadBalancer',
        monthlyCost,
        hourlyCost: elbHourlyPrice,
        unit: 'load balancer',
        details: [{
          component: 'Classic ELB',
          quantity: HOURS_PER_MONTH,
          unitPrice: elbHourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // ECS Cluster (Fargate)
    calculators.set('AWS::ECS::Service', (logicalId, resource, template, pricing) => {
      const desiredCount = TemplateParser.getPropertyValue(template, resource, 'DesiredCount', 1) as number;
      const launchType = TemplateParser.getPropertyValue(template, resource, 'LaunchType', 'FARGATE') as string;
      
      if (launchType !== 'FARGATE') {
        // EC2 launch type - cost is in EC2 instances
        return {
          resourceId: logicalId,
          resourceType: 'AWS::ECS::Service',
          monthlyCost: 0,
          hourlyCost: 0,
          unit: 'service',
          details: [{
            component: 'ECS Service (EC2 - cost in instances)',
            quantity: desiredCount,
            unitPrice: 0,
            monthlyCost: 0,
            unit: 'tasks',
          }],
          confidence: 'medium',
        };
      }
      
      // Estimate Fargate cost (assume 0.5 vCPU, 1GB memory)
      const vcpuCost = pricing.ecs.fargateVCPUPerHour * 0.5 * HOURS_PER_MONTH;
      const memoryCost = pricing.ecs.fargateMemoryPerGBHour * 1 * HOURS_PER_MONTH;
      const perTaskCost = vcpuCost + memoryCost;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::ECS::Service',
        monthlyCost: perTaskCost * desiredCount,
        hourlyCost: (perTaskCost / HOURS_PER_MONTH) * desiredCount,
        unit: 'service',
        details: [
          {
            component: 'Fargate vCPU (0.5 vCPU est.)',
            quantity: desiredCount,
            unitPrice: vcpuCost,
            monthlyCost: vcpuCost * desiredCount,
            unit: 'task/month',
          },
          {
            component: 'Fargate Memory (1GB est.)',
            quantity: desiredCount,
            unitPrice: memoryCost,
            monthlyCost: memoryCost * desiredCount,
            unit: 'task/month',
          },
        ],
        confidence: 'low',
      };
    });
    
    // EKS Cluster
    calculators.set('AWS::EKS::Cluster', (logicalId, resource, template, pricing) => {
      const monthlyCost = pricing.eks.clusterPerHour * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EKS::Cluster',
        monthlyCost,
        hourlyCost: pricing.eks.clusterPerHour,
        unit: 'cluster',
        details: [{
          component: 'EKS Cluster',
          quantity: HOURS_PER_MONTH,
          unitPrice: pricing.eks.clusterPerHour,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // Secrets Manager
    calculators.set('AWS::SecretsManager::Secret', (logicalId, resource, template, pricing) => {
      const monthlyCost = pricing.secretsManager.perSecretPerMonth;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::SecretsManager::Secret',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'secret',
        details: [{
          component: 'Secrets Manager Secret',
          quantity: 1,
          unitPrice: pricing.secretsManager.perSecretPerMonth,
          monthlyCost,
          unit: 'secret/month',
        }],
        confidence: 'high',
      };
    });
    
    // KMS Key
    calculators.set('AWS::KMS::Key', (logicalId, resource, template, pricing) => {
      const monthlyCost = pricing.kms.perKeyPerMonth;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::KMS::Key',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'key',
        details: [{
          component: 'KMS Customer Managed Key',
          quantity: 1,
          unitPrice: pricing.kms.perKeyPerMonth,
          monthlyCost,
          unit: 'key/month',
        }],
        confidence: 'high',
      };
    });
    
    // Route53 Hosted Zone
    calculators.set('AWS::Route53::HostedZone', (logicalId, resource, template, pricing) => {
      const monthlyCost = pricing.route53.hostedZonePerMonth;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Route53::HostedZone',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'hosted zone',
        details: [{
          component: 'Route53 Hosted Zone',
          quantity: 1,
          unitPrice: pricing.route53.hostedZonePerMonth,
          monthlyCost,
          unit: 'zone/month',
        }],
        confidence: 'high',
      };
    });
    
    // CloudWatch Alarm
    calculators.set('AWS::CloudWatch::Alarm', (logicalId, resource, template, pricing) => {
      const monthlyCost = pricing.cloudwatch.alarmsPerMonth;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CloudWatch::Alarm',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'alarm',
        details: [{
          component: 'CloudWatch Alarm',
          quantity: 1,
          unitPrice: pricing.cloudwatch.alarmsPerMonth,
          monthlyCost,
          unit: 'alarm/month',
        }],
        confidence: 'high',
      };
    });
    
    // CloudWatch Dashboard
    calculators.set('AWS::CloudWatch::Dashboard', (logicalId, resource, template, pricing) => {
      const monthlyCost = pricing.cloudwatch.dashboardsPerMonth;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CloudWatch::Dashboard',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'dashboard',
        details: [{
          component: 'CloudWatch Dashboard',
          quantity: 1,
          unitPrice: pricing.cloudwatch.dashboardsPerMonth,
          monthlyCost,
          unit: 'dashboard/month',
        }],
        confidence: 'high',
      };
    });
    
    // Elastic IP
    calculators.set('AWS::EC2::EIP', (logicalId, resource, template, pricing) => {
      // EIPs are free when attached to a running instance
      // Charge $0.005/hour when not attached (assume attached for estimation)
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::EIP',
        monthlyCost: 0,
        hourlyCost: 0,
        unit: 'elastic IP',
        details: [{
          component: 'Elastic IP (free when attached)',
          quantity: 1,
          unitPrice: 0,
          monthlyCost: 0,
          unit: 'IP/month',
        }],
        confidence: 'medium',
      };
    });
    
    // VPC Endpoint
    calculators.set('AWS::EC2::VPCEndpoint', (logicalId, resource, template, pricing) => {
      const endpointType = TemplateParser.getPropertyValue(template, resource, 'VpcEndpointType', 'Interface') as string;
      
      if (endpointType === 'Gateway') {
        // Gateway endpoints (S3, DynamoDB) are free
        return {
          resourceId: logicalId,
          resourceType: 'AWS::EC2::VPCEndpoint',
          monthlyCost: 0,
          hourlyCost: 0,
          unit: 'endpoint',
          details: [{
            component: 'VPC Gateway Endpoint (free)',
            quantity: 1,
            unitPrice: 0,
            monthlyCost: 0,
            unit: 'endpoint',
          }],
          confidence: 'high',
        };
      }
      
      // Interface endpoint - $0.01/hour per AZ + data processing
      const hourlyPrice = 0.01;
      const subnetIds = TemplateParser.getPropertyValue(template, resource, 'SubnetIds', []) as string[];
      const azCount = Math.max(subnetIds.length, 1);
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * azCount;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::VPCEndpoint',
        monthlyCost,
        hourlyCost: hourlyPrice * azCount,
        unit: 'endpoint',
        details: [{
          component: `VPC Interface Endpoint (${azCount} AZ)`,
          quantity: azCount * HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'endpoint-hours',
        }],
        confidence: 'medium',
      };
    });
    
    return calculators;
  }
  
  /**
   * Calculate Lambda function cost (usage-based with estimates)
   */
  private calculateLambdaCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const memorySize = TemplateParser.getPropertyValue(template, resource, 'MemorySize', 128) as number;
    const timeout = TemplateParser.getPropertyValue(template, resource, 'Timeout', 3) as number;
    
    // Estimate 100,000 invocations/month with average duration of timeout/2
    const estimatedInvocations = 100000;
    const avgDurationMs = timeout * 500; // Half of timeout in ms
    
    const gbSeconds = (memorySize / 1024) * (avgDurationMs / 1000) * estimatedInvocations;
    const requestCost = (estimatedInvocations / 1000000) * this.pricing.lambda.requestPrice;
    const computeCost = Math.max(0, gbSeconds - this.pricing.lambda.freeDuration) * this.pricing.lambda.durationPrice;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::Lambda::Function',
      monthlyCost: requestCost + computeCost,
      hourlyCost: (requestCost + computeCost) / HOURS_PER_MONTH,
      unit: 'function',
      details: [
        {
          component: `Lambda Requests (est. ${estimatedInvocations.toLocaleString()}/mo)`,
          quantity: estimatedInvocations,
          unitPrice: this.pricing.lambda.requestPrice / 1000000,
          monthlyCost: requestCost,
          unit: 'requests',
        },
        {
          component: `Lambda Compute (${memorySize}MB, ${avgDurationMs}ms avg)`,
          quantity: gbSeconds,
          unitPrice: this.pricing.lambda.durationPrice,
          monthlyCost: computeCost,
          unit: 'GB-seconds',
        },
      ],
      confidence: 'low',
    };
  }
  
  /**
   * Calculate DynamoDB table cost
   */
  private calculateDynamoDBCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const billingMode = TemplateParser.getPropertyValue(template, resource, 'BillingMode', 'PROVISIONED') as string;
    
    if (billingMode === 'PAY_PER_REQUEST') {
      // On-demand - estimate based on usage
      const estimatedWrites = 1000000; // 1M writes/month
      const estimatedReads = 5000000; // 5M reads/month
      
      const writeCost = (estimatedWrites / 1000000) * this.pricing.dynamodb.onDemandWrite;
      const readCost = (estimatedReads / 1000000) * this.pricing.dynamodb.onDemandRead;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::DynamoDB::Table',
        monthlyCost: writeCost + readCost,
        hourlyCost: (writeCost + readCost) / HOURS_PER_MONTH,
        unit: 'table',
        details: [
          {
            component: 'DynamoDB On-Demand Writes (est. 1M/mo)',
            quantity: estimatedWrites,
            unitPrice: this.pricing.dynamodb.onDemandWrite / 1000000,
            monthlyCost: writeCost,
            unit: 'writes',
          },
          {
            component: 'DynamoDB On-Demand Reads (est. 5M/mo)',
            quantity: estimatedReads,
            unitPrice: this.pricing.dynamodb.onDemandRead / 1000000,
            monthlyCost: readCost,
            unit: 'reads',
          },
        ],
        confidence: 'low',
      };
    }
    
    // Provisioned capacity
    const throughput = resource.Properties?.ProvisionedThroughput as Record<string, unknown> | undefined;
    const readCapacity = (throughput?.ReadCapacityUnits as number) || 5;
    const writeCapacity = (throughput?.WriteCapacityUnits as number) || 5;
    
    const readCost = readCapacity * this.pricing.dynamodb.readCapacityUnit;
    const writeCost = writeCapacity * this.pricing.dynamodb.writeCapacityUnit;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::DynamoDB::Table',
      monthlyCost: readCost + writeCost,
      hourlyCost: (readCost + writeCost) / HOURS_PER_MONTH,
      unit: 'table',
      details: [
        {
          component: `DynamoDB Read Capacity (${readCapacity} RCU)`,
          quantity: readCapacity,
          unitPrice: this.pricing.dynamodb.readCapacityUnit,
          monthlyCost: readCost,
          unit: 'RCU/month',
        },
        {
          component: `DynamoDB Write Capacity (${writeCapacity} WCU)`,
          quantity: writeCapacity,
          unitPrice: this.pricing.dynamodb.writeCapacityUnit,
          monthlyCost: writeCost,
          unit: 'WCU/month',
        },
      ],
      confidence: 'medium',
    };
  }
  
  /**
   * Calculate S3 bucket cost (storage estimate)
   */
  private calculateS3Cost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    // Estimate 100GB storage
    const estimatedStorageGB = 100;
    const storageCost = estimatedStorageGB * this.pricing.s3.storage;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::S3::Bucket',
      monthlyCost: storageCost,
      hourlyCost: storageCost / HOURS_PER_MONTH,
      unit: 'bucket',
      details: [{
        component: 'S3 Storage (est. 100GB)',
        quantity: estimatedStorageGB,
        unitPrice: this.pricing.s3.storage,
        monthlyCost: storageCost,
        unit: 'GB/month',
      }],
      confidence: 'low',
    };
  }
  
  /**
   * Calculate SQS queue cost
   */
  private calculateSQSCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    // Estimate 1M requests/month
    const estimatedRequests = 1000000;
    const requestCost = (estimatedRequests / 1000000) * this.pricing.sqs.requestsPerMillion;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::SQS::Queue',
      monthlyCost: requestCost,
      hourlyCost: requestCost / HOURS_PER_MONTH,
      unit: 'queue',
      details: [{
        component: 'SQS Requests (est. 1M/mo)',
        quantity: estimatedRequests,
        unitPrice: this.pricing.sqs.requestsPerMillion / 1000000,
        monthlyCost: requestCost,
        unit: 'requests',
      }],
      confidence: 'low',
    };
  }
  
  /**
   * Calculate API Gateway cost
   */
  private calculateApiGatewayCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const isHttpApi = resource.Type === 'AWS::ApiGatewayV2::Api';
    const estimatedRequests = 1000000; // 1M requests/month
    
    const pricePerMillion = isHttpApi 
      ? this.pricing.apiGateway.httpApiPerMillion 
      : this.pricing.apiGateway.restApiPerMillion;
    
    const requestCost = (estimatedRequests / 1000000) * pricePerMillion;
    
    return {
      resourceId: logicalId,
      resourceType: resource.Type,
      monthlyCost: requestCost,
      hourlyCost: requestCost / HOURS_PER_MONTH,
      unit: 'API',
      details: [{
        component: `${isHttpApi ? 'HTTP' : 'REST'} API Requests (est. 1M/mo)`,
        quantity: estimatedRequests,
        unitPrice: pricePerMillion / 1000000,
        monthlyCost: requestCost,
        unit: 'requests',
      }],
      confidence: 'low',
    };
  }
  
  /**
   * Calculate Step Functions cost
   */
  private calculateStepFunctionsCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const type = TemplateParser.getPropertyValue(template, resource, 'StateMachineType', 'STANDARD') as string;
    
    // Estimate 10,000 executions/month with 5 transitions each
    const estimatedExecutions = 10000;
    const transitionsPerExecution = 5;
    const totalTransitions = estimatedExecutions * transitionsPerExecution;
    
    const pricePerMillion = type === 'EXPRESS' 
      ? this.pricing.stepFunctions.expressPerMillion 
      : this.pricing.stepFunctions.standardTransitionsPerMillion;
    
    const cost = (totalTransitions / 1000000) * pricePerMillion;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::StepFunctions::StateMachine',
      monthlyCost: cost,
      hourlyCost: cost / HOURS_PER_MONTH,
      unit: 'state machine',
      details: [{
        component: `Step Functions ${type} (est. ${totalTransitions.toLocaleString()} transitions/mo)`,
        quantity: totalTransitions,
        unitPrice: pricePerMillion / 1000000,
        monthlyCost: cost,
        unit: 'transitions',
      }],
      confidence: 'low',
    };
  }
}

