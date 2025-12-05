/**
 * Cost Calculator
 * Calculates monthly costs for CloudFormation resources
 */

import { CloudFormationTemplate, CloudFormationResource, ResourceCost, CostDetail, StackCostEstimate, UnsupportedResource } from './types';
import { getRegionalPricing, HOURS_PER_MONTH, FREE_RESOURCES, USAGE_BASED_RESOURCES, AWSpricingData } from './pricing-data';
import { TemplateParser } from './template-parser';

type ResourceCostCalculator = (
  logicalId: string,
  resource: CloudFormationResource,
  template: CloudFormationTemplate,
  pricing: AWSpricingData
) => ResourceCost | null;

export class CostCalculator {
  private pricing: AWSpricingData;
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
      case 'AWS::SNS::Topic':
        return this.calculateSNSCost(logicalId, resource, template);
      case 'AWS::Logs::LogGroup':
        return this.calculateCloudWatchLogsCost(logicalId, resource, template);
      case 'AWS::SSM::Parameter':
        return this.calculateSSMParameterCost(logicalId, resource, template);
      case 'AWS::ECR::Repository':
        return this.calculateECRCost(logicalId, resource, template);
      case 'AWS::Route53::RecordSet':
        return this.calculateRoute53RecordSetCost(logicalId, resource, template);
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
      const hourlyPrice = pricing.ec2.instances[instanceType] || pricing.ec2.instances['t3.micro'] || 0.0104;
      
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
      const hourlyPrice = pricing.ec2.instances[instanceType] || pricing.ec2.instances['t3.micro'] || 0.0104;
      
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
      const throughput = TemplateParser.getPropertyValue(template, resource, 'Throughput', 125) as number;
      
      const pricePerGB = pricing.ebs.volumes[volumeType] || pricing.ebs.volumes['gp3'] || 0.08;
      let monthlyCost = pricePerGB * size;
      
      const details: CostDetail[] = [{
        component: `EBS ${volumeType.toUpperCase()} Storage`,
        quantity: size,
        unitPrice: pricePerGB,
        monthlyCost: pricePerGB * size,
        unit: 'GB/month',
      }];
      
      // Add IOPS cost for io1/io2/gp3
      if (volumeType === 'io1' || volumeType === 'io2') {
        const iopsPrice = pricing.ebs.iops[volumeType] || 0.065;
        const iopsCost = iopsPrice * iops;
        monthlyCost += iopsCost;
        details.push({
          component: 'Provisioned IOPS',
          quantity: iops,
          unitPrice: iopsPrice,
          monthlyCost: iopsCost,
          unit: 'IOPS/month',
        });
      } else if (volumeType === 'gp3' && iops > 3000) {
        const additionalIops = iops - 3000;
        const iopsPrice = pricing.ebs.iops['gp3'] || 0.005;
        const iopsCost = iopsPrice * additionalIops;
        monthlyCost += iopsCost;
        details.push({
          component: 'Additional IOPS (above 3000)',
          quantity: additionalIops,
          unitPrice: iopsPrice,
          monthlyCost: iopsCost,
          unit: 'IOPS/month',
        });
      }
      
      // Add throughput cost for gp3
      if (volumeType === 'gp3' && throughput > 125) {
        const additionalThroughput = throughput - 125;
        const throughputPrice = pricing.ebs.throughput['gp3'] || 0.04;
        const throughputCost = throughputPrice * additionalThroughput;
        monthlyCost += throughputCost;
        details.push({
          component: 'Additional Throughput (above 125 MBps)',
          quantity: additionalThroughput,
          unitPrice: throughputPrice,
          monthlyCost: throughputCost,
          unit: 'MBps/month',
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
      const storageType = (TemplateParser.getPropertyValue(template, resource, 'StorageType', 'gp2') as string).toLowerCase();
      const engine = (TemplateParser.getPropertyValue(template, resource, 'Engine', 'mysql') as string).toLowerCase();
      
      // Find hourly price from pricing data
      let hourlyPrice = 0.017; // default
      const enginePricing = pricing.rds.instances[engine] || pricing.rds.instances['mysql'];
      if (enginePricing) {
        hourlyPrice = enginePricing[instanceClass] || enginePricing['db.t3.micro'] || 0.017;
      }
      
      const instanceCost = hourlyPrice * HOURS_PER_MONTH * (multiAZ ? 2 : 1);
      
      const storagePrice = pricing.rds.storage[storageType] || pricing.rds.storage['gp2'] || 0.115;
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
      
      const hourlyPrice = pricing.elasticache.nodes[nodeType] || pricing.elasticache.nodes['cache.t3.micro'] || 0.017;
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
      const hourlyPrice = pricing.elasticache.nodes[nodeType] || pricing.elasticache.nodes['cache.t3.micro'] || 0.017;
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
      const hourlyPrice = pricing.natGateway.hourly || 0.045;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      // Add estimated data processing cost (assume 100GB/month)
      const estimatedDataGB = 100;
      const dataPrice = pricing.natGateway.perGB || 0.045;
      const dataProcessingCost = dataPrice * estimatedDataGB;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::NatGateway',
        monthlyCost: monthlyCost + dataProcessingCost,
        hourlyCost: hourlyPrice,
        unit: 'gateway',
        details: [
          {
            component: 'NAT Gateway Hourly',
            quantity: HOURS_PER_MONTH,
            unitPrice: hourlyPrice,
            monthlyCost,
            unit: 'hours',
          },
          {
            component: 'Data Processing (est. 100GB)',
            quantity: estimatedDataGB,
            unitPrice: dataPrice,
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
      const lbPricing = isNLB ? pricing.loadBalancer.nlb : pricing.loadBalancer.alb;
      
      const hourlyPrice = lbPricing.hourly || 0.0225;
      const lcuHourlyPrice = lbPricing.lcuHourly || 0.008;
      const baseMonthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      // Estimate LCU cost (assume 10 LCU average)
      const estimatedLCU = 10;
      const lcuCost = lcuHourlyPrice * HOURS_PER_MONTH * estimatedLCU;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
        monthlyCost: baseMonthlyCost + lcuCost,
        hourlyCost: hourlyPrice + (lcuHourlyPrice * estimatedLCU),
        unit: 'load balancer',
        details: [
          {
            component: `${isNLB ? 'NLB' : 'ALB'} Hourly`,
            quantity: HOURS_PER_MONTH,
            unitPrice: hourlyPrice,
            monthlyCost: baseMonthlyCost,
            unit: 'hours',
          },
          {
            component: 'LCU (est. 10 avg)',
            quantity: estimatedLCU * HOURS_PER_MONTH,
            unitPrice: lcuHourlyPrice,
            monthlyCost: lcuCost,
            unit: 'LCU-hours',
          },
        ],
        confidence: 'medium',
      };
    });
    
    // Classic Load Balancer
    calculators.set('AWS::ElasticLoadBalancing::LoadBalancer', (logicalId, resource, template, pricing) => {
      const elbHourlyPrice = pricing.loadBalancer.clb.hourly || 0.025;
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
      const vcpuHourly = pricing.fargate.vcpuHourly || 0.04048;
      const memoryHourly = pricing.fargate.memoryGBHourly || 0.004445;
      const vcpuCost = vcpuHourly * 0.5 * HOURS_PER_MONTH;
      const memoryCost = memoryHourly * 1 * HOURS_PER_MONTH;
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
      const hourlyPrice = pricing.eks.clusterHourly || 0.10;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EKS::Cluster',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'cluster',
        details: [{
          component: 'EKS Cluster',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // Secrets Manager
    calculators.set('AWS::SecretsManager::Secret', (logicalId, resource, template, pricing) => {
      const secretPrice = pricing.other?.secretsManager?.secret || 0.40;
      const monthlyCost = secretPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::SecretsManager::Secret',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'secret',
        details: [{
          component: 'Secrets Manager Secret',
          quantity: 1,
          unitPrice: secretPrice,
          monthlyCost,
          unit: 'secret/month',
        }],
        confidence: 'high',
      };
    });
    
    // KMS Key
    calculators.set('AWS::KMS::Key', (logicalId, resource, template, pricing) => {
      const keyPrice = pricing.other?.kms?.key || 1.00;
      const monthlyCost = keyPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::KMS::Key',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'key',
        details: [{
          component: 'KMS Customer Managed Key',
          quantity: 1,
          unitPrice: keyPrice,
          monthlyCost,
          unit: 'key/month',
        }],
        confidence: 'high',
      };
    });
    
    // Route53 Hosted Zone
    calculators.set('AWS::Route53::HostedZone', (logicalId, resource, template, pricing) => {
      const zonePrice = pricing.other?.route53?.hostedZone || 0.50;
      const monthlyCost = zonePrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Route53::HostedZone',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'hosted zone',
        details: [{
          component: 'Route53 Hosted Zone',
          quantity: 1,
          unitPrice: zonePrice,
          monthlyCost,
          unit: 'zone/month',
        }],
        confidence: 'high',
      };
    });
    
    // CloudWatch Alarm
    calculators.set('AWS::CloudWatch::Alarm', (logicalId, resource, template, pricing) => {
      const alarmPrice = pricing.other?.cloudwatch?.alarmStandard || 0.10;
      const monthlyCost = alarmPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CloudWatch::Alarm',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'alarm',
        details: [{
          component: 'CloudWatch Alarm',
          quantity: 1,
          unitPrice: alarmPrice,
          monthlyCost,
          unit: 'alarm/month',
        }],
        confidence: 'high',
      };
    });
    
    // CloudWatch Dashboard
    calculators.set('AWS::CloudWatch::Dashboard', (logicalId, resource, template, pricing) => {
      const dashboardPrice = pricing.other?.cloudwatch?.dashboards || 3.00;
      const monthlyCost = dashboardPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CloudWatch::Dashboard',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'dashboard',
        details: [{
          component: 'CloudWatch Dashboard',
          quantity: 1,
          unitPrice: dashboardPrice,
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
      const hourlyPrice = pricing.vpcEndpoint?.interfaceHourly || 0.01;
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
    
    // EBS Snapshot
    calculators.set('AWS::EC2::Snapshot', (logicalId, resource, template, pricing) => {
      // Estimate 100GB snapshot
      const estimatedSizeGB = 100;
      const snapshotPrice = pricing.ebs?.snapshots || 0.05;
      const monthlyCost = snapshotPrice * estimatedSizeGB;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::Snapshot',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'snapshot',
        details: [{
          component: 'EBS Snapshot Storage (est. 100GB)',
          quantity: estimatedSizeGB,
          unitPrice: snapshotPrice,
          monthlyCost,
          unit: 'GB/month',
        }],
        confidence: 'low',
      };
    });
    
    // Neptune Cluster
    calculators.set('AWS::Neptune::DBCluster', (logicalId, resource, template, pricing) => {
      // Cluster storage cost
      const estimatedStorageGB = 100;
      const storagePrice = pricing.neptune?.storage || 0.10;
      const storageCost = storagePrice * estimatedStorageGB;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Neptune::DBCluster',
        monthlyCost: storageCost,
        hourlyCost: storageCost / HOURS_PER_MONTH,
        unit: 'cluster',
        details: [{
          component: 'Neptune Storage (est. 100GB)',
          quantity: estimatedStorageGB,
          unitPrice: storagePrice,
          monthlyCost: storageCost,
          unit: 'GB/month',
        }],
        confidence: 'low',
      };
    });
    
    // Neptune Cluster Instance
    calculators.set('AWS::Neptune::DBInstance', (logicalId, resource, template, pricing) => {
      const instanceClass = TemplateParser.getPropertyValue(template, resource, 'DBInstanceClass', 'db.r5.large') as string;
      const hourlyPrice = pricing.neptune?.instances?.[instanceClass] || pricing.neptune?.instances?.['db.r5.large'] || 0.348;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Neptune::DBInstance',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'instance',
        details: [{
          component: `Neptune ${instanceClass}`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // DocumentDB Cluster
    calculators.set('AWS::DocDB::DBCluster', (logicalId, resource, template, pricing) => {
      const estimatedStorageGB = 100;
      const storagePrice = pricing.documentdb?.storage || 0.10;
      const storageCost = storagePrice * estimatedStorageGB;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::DocDB::DBCluster',
        monthlyCost: storageCost,
        hourlyCost: storageCost / HOURS_PER_MONTH,
        unit: 'cluster',
        details: [{
          component: 'DocumentDB Storage (est. 100GB)',
          quantity: estimatedStorageGB,
          unitPrice: storagePrice,
          monthlyCost: storageCost,
          unit: 'GB/month',
        }],
        confidence: 'low',
      };
    });
    
    // DocumentDB Instance
    calculators.set('AWS::DocDB::DBInstance', (logicalId, resource, template, pricing) => {
      const instanceClass = TemplateParser.getPropertyValue(template, resource, 'DBInstanceClass', 'db.r5.large') as string;
      const hourlyPrice = pricing.documentdb?.instances?.[instanceClass] || pricing.documentdb?.instances?.['db.r5.large'] || 0.277;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::DocDB::DBInstance',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'instance',
        details: [{
          component: `DocumentDB ${instanceClass}`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // Redshift Cluster
    calculators.set('AWS::Redshift::Cluster', (logicalId, resource, template, pricing) => {
      const nodeType = TemplateParser.getPropertyValue(template, resource, 'NodeType', 'dc2.large') as string;
      const numberOfNodes = TemplateParser.getPropertyValue(template, resource, 'NumberOfNodes', 1) as number;
      const hourlyPrice = pricing.redshift?.instances?.[nodeType] || pricing.redshift?.instances?.['dc2.large'] || 0.25;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * numberOfNodes;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Redshift::Cluster',
        monthlyCost,
        hourlyCost: hourlyPrice * numberOfNodes,
        unit: 'cluster',
        details: [{
          component: `Redshift ${nodeType} (${numberOfNodes} nodes)`,
          quantity: numberOfNodes * HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'node-hours',
        }],
        confidence: 'high',
      };
    });
    
    // VPN Connection
    calculators.set('AWS::EC2::VPNConnection', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.vpnConnection?.hourly || 0.05;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::VPNConnection',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'connection',
        details: [{
          component: 'Site-to-Site VPN Connection',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // Transit Gateway
    calculators.set('AWS::EC2::TransitGateway', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.transitGateway?.hourly || 0.05;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::TransitGateway',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'transit gateway',
        details: [{
          component: 'Transit Gateway',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // Transit Gateway VPC Attachment
    calculators.set('AWS::EC2::TransitGatewayAttachment', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.transitGateway?.hourly || 0.05;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      // Add estimated data processing
      const estimatedDataGB = 100;
      const dataPrice = pricing.transitGateway?.dataProcessed || 0.02;
      const dataCost = estimatedDataGB * dataPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::TransitGatewayAttachment',
        monthlyCost: monthlyCost + dataCost,
        hourlyCost: hourlyPrice,
        unit: 'attachment',
        details: [
          {
            component: 'Transit Gateway Attachment',
            quantity: HOURS_PER_MONTH,
            unitPrice: hourlyPrice,
            monthlyCost,
            unit: 'hours',
          },
          {
            component: 'Data Processing (est. 100GB)',
            quantity: estimatedDataGB,
            unitPrice: dataPrice,
            monthlyCost: dataCost,
            unit: 'GB',
          },
        ],
        confidence: 'medium',
      };
    });
    
    // Direct Connect Connection
    calculators.set('AWS::DirectConnect::Connection', (logicalId, resource, template, pricing) => {
      const bandwidth = TemplateParser.getPropertyValue(template, resource, 'Bandwidth', '1Gbps') as string;
      const portPrice = pricing.directConnect?.portHours?.[bandwidth] || pricing.directConnect?.portHours?.['1Gbps'] || 0.30;
      const monthlyCost = portPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::DirectConnect::Connection',
        monthlyCost,
        hourlyCost: portPrice,
        unit: 'connection',
        details: [{
          component: `Direct Connect ${bandwidth}`,
          quantity: HOURS_PER_MONTH,
          unitPrice: portPrice,
          monthlyCost,
          unit: 'port-hours',
        }],
        confidence: 'high',
      };
    });
    
    // Global Accelerator
    calculators.set('AWS::GlobalAccelerator::Accelerator', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.globalAccelerator?.hourly || 0.025;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::GlobalAccelerator::Accelerator',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'accelerator',
        details: [{
          component: 'Global Accelerator',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'medium',
      };
    });
    
    // MQ Broker
    calculators.set('AWS::AmazonMQ::Broker', (logicalId, resource, template, pricing) => {
      const instanceType = TemplateParser.getPropertyValue(template, resource, 'HostInstanceType', 'mq.t3.micro') as string;
      const hourlyPrice = pricing.mq?.instanceHourly?.[instanceType] || pricing.mq?.instanceHourly?.['mq.t3.micro'] || 0.027;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::AmazonMQ::Broker',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'broker',
        details: [{
          component: `Amazon MQ ${instanceType}`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // MSK Cluster
    calculators.set('AWS::MSK::Cluster', (logicalId, resource, template, pricing) => {
      const instanceType = TemplateParser.getPropertyValue(template, resource, 'BrokerNodeGroupInfo.InstanceType', 'kafka.t3.small') as string;
      const numberOfBrokerNodes = TemplateParser.getPropertyValue(template, resource, 'NumberOfBrokerNodes', 3) as number;
      const hourlyPrice = pricing.msk?.instanceHourly?.[instanceType] || pricing.msk?.instanceHourly?.['kafka.t3.small'] || 0.072;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * numberOfBrokerNodes;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::MSK::Cluster',
        monthlyCost,
        hourlyCost: hourlyPrice * numberOfBrokerNodes,
        unit: 'cluster',
        details: [{
          component: `MSK ${instanceType} (${numberOfBrokerNodes} brokers)`,
          quantity: numberOfBrokerNodes * HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'broker-hours',
        }],
        confidence: 'high',
      };
    });
    
    // Kinesis Stream
    calculators.set('AWS::Kinesis::Stream', (logicalId, resource, template, pricing) => {
      const shardCount = TemplateParser.getPropertyValue(template, resource, 'ShardCount', 1) as number;
      const shardHourly = pricing.kinesis?.shardHourly || 0.015;
      const monthlyCost = shardHourly * HOURS_PER_MONTH * shardCount;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Kinesis::Stream',
        monthlyCost,
        hourlyCost: shardHourly * shardCount,
        unit: 'stream',
        details: [{
          component: `Kinesis Stream (${shardCount} shards)`,
          quantity: shardCount * HOURS_PER_MONTH,
          unitPrice: shardHourly,
          monthlyCost,
          unit: 'shard-hours',
        }],
        confidence: 'high',
      };
    });
    
    // Kinesis Firehose
    calculators.set('AWS::KinesisFirehose::DeliveryStream', (logicalId, resource, template, pricing) => {
      // Estimate 100GB/month ingested
      const estimatedDataGB = 100;
      const dataPrice = pricing.kinesisFirehose?.dataIngested || 0.029;
      const monthlyCost = estimatedDataGB * dataPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::KinesisFirehose::DeliveryStream',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'delivery stream',
        details: [{
          component: 'Kinesis Firehose Data Ingested (est. 100GB)',
          quantity: estimatedDataGB,
          unitPrice: dataPrice,
          monthlyCost,
          unit: 'GB',
        }],
        confidence: 'low',
      };
    });
    
    // EFS File System
    calculators.set('AWS::EFS::FileSystem', (logicalId, resource, template, pricing) => {
      const throughputMode = TemplateParser.getPropertyValue(template, resource, 'ThroughputMode', 'bursting') as string;
      const estimatedStorageGB = 100;
      const standardPrice = pricing.efs?.standard || 0.30;
      let storageCost = estimatedStorageGB * standardPrice;
      const details: CostDetail[] = [{
        component: 'EFS Standard Storage (est. 100GB)',
        quantity: estimatedStorageGB,
        unitPrice: standardPrice,
        monthlyCost: storageCost,
        unit: 'GB/month',
      }];
      
      if (throughputMode === 'provisioned') {
        const provisionedThroughput = TemplateParser.getPropertyValue(template, resource, 'ProvisionedThroughputInMibps', 0) as number;
        if (provisionedThroughput > 0) {
          const throughputPrice = pricing.efs?.provisionedThroughput || 6.00;
          const throughputCost = provisionedThroughput * throughputPrice;
          storageCost += throughputCost;
          details.push({
            component: `Provisioned Throughput (${provisionedThroughput} MiBps)`,
            quantity: provisionedThroughput,
            unitPrice: throughputPrice,
            monthlyCost: throughputCost,
            unit: 'MiBps/month',
          });
        }
      }
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EFS::FileSystem',
        monthlyCost: storageCost,
        hourlyCost: storageCost / HOURS_PER_MONTH,
        unit: 'file system',
        details,
        confidence: 'low',
      };
    });
    
    // FSx for Windows
    calculators.set('AWS::FSx::FileSystem', (logicalId, resource, template, pricing) => {
      const fileSystemType = TemplateParser.getPropertyValue(template, resource, 'FileSystemType', 'WINDOWS') as string;
      const storageCapacity = TemplateParser.getPropertyValue(template, resource, 'StorageCapacity', 32) as number;
      
      let pricePerGB: number;
      switch (fileSystemType) {
        case 'LUSTRE':
          pricePerGB = pricing.fsx?.lustre || 0.14;
          break;
        case 'ONTAP':
          pricePerGB = pricing.fsx?.ontap || 0.25;
          break;
        case 'OPENZFS':
          pricePerGB = pricing.fsx?.openzfs || 0.09;
          break;
        default:
          pricePerGB = pricing.fsx?.windows || 0.23;
      }
      
      const monthlyCost = storageCapacity * pricePerGB;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::FSx::FileSystem',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'file system',
        details: [{
          component: `FSx ${fileSystemType} Storage (${storageCapacity}GB)`,
          quantity: storageCapacity,
          unitPrice: pricePerGB,
          monthlyCost,
          unit: 'GB/month',
        }],
        confidence: 'high',
      };
    });
    
    // Backup Vault
    calculators.set('AWS::Backup::BackupVault', (logicalId, resource, template, pricing) => {
      // Estimate 100GB storage
      const estimatedStorageGB = 100;
      const storagePrice = pricing.backup?.storage || 0.05;
      const monthlyCost = estimatedStorageGB * storagePrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Backup::BackupVault',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'vault',
        details: [{
          component: 'AWS Backup Storage (est. 100GB)',
          quantity: estimatedStorageGB,
          unitPrice: storagePrice,
          monthlyCost,
          unit: 'GB/month',
        }],
        confidence: 'low',
      };
    });
    
    // CloudFront Distribution
    calculators.set('AWS::CloudFront::Distribution', (logicalId, resource, template, pricing) => {
      // Estimate 100GB data transfer, 1M requests
      const estimatedDataGB = 100;
      const estimatedRequests = 1000000;
      const dataPrice = pricing.cloudfront?.dataTransfer?.['us'] || 0.085;
      const requestPrice = pricing.cloudfront?.requests?.https || 0.01;
      
      const dataCost = estimatedDataGB * dataPrice;
      const requestCost = (estimatedRequests / 10000) * requestPrice;
      const monthlyCost = dataCost + requestCost;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CloudFront::Distribution',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'distribution',
        details: [
          {
            component: 'CloudFront Data Transfer (est. 100GB)',
            quantity: estimatedDataGB,
            unitPrice: dataPrice,
            monthlyCost: dataCost,
            unit: 'GB',
          },
          {
            component: 'HTTPS Requests (est. 1M)',
            quantity: estimatedRequests / 10000,
            unitPrice: requestPrice,
            monthlyCost: requestCost,
            unit: '10k requests',
          },
        ],
        confidence: 'low',
      };
    });
    
    // ACM PCA Certificate Authority
    calculators.set('AWS::ACMPCA::CertificateAuthority', (logicalId, resource, template, pricing) => {
      const monthlyPrice = 400; // $400/month for private CA
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::ACMPCA::CertificateAuthority',
        monthlyCost: monthlyPrice,
        hourlyCost: monthlyPrice / HOURS_PER_MONTH,
        unit: 'certificate authority',
        details: [{
          component: 'ACM Private Certificate Authority',
          quantity: 1,
          unitPrice: monthlyPrice,
          monthlyCost: monthlyPrice,
          unit: 'CA/month',
        }],
        confidence: 'high',
      };
    });
    
    // Config Rule
    calculators.set('AWS::Config::ConfigRule', (logicalId, resource, template, pricing) => {
      const rulePrice = pricing.config?.rules || 1.00;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Config::ConfigRule',
        monthlyCost: rulePrice,
        hourlyCost: rulePrice / HOURS_PER_MONTH,
        unit: 'rule',
        details: [{
          component: 'AWS Config Rule',
          quantity: 1,
          unitPrice: rulePrice,
          monthlyCost: rulePrice,
          unit: 'rule/month',
        }],
        confidence: 'medium',
      };
    });
    
    // CloudTrail
    calculators.set('AWS::CloudTrail::Trail', (logicalId, resource, template, pricing) => {
      const isMultiRegion = TemplateParser.getPropertyValue(template, resource, 'IsMultiRegionTrail', false) as boolean;
      
      // First trail is free for management events, estimate data events
      const estimatedDataEvents = 100000;
      const dataEventPrice = pricing.cloudtrail?.dataEvents || 0.10;
      const monthlyCost = (estimatedDataEvents / 100000) * dataEventPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CloudTrail::Trail',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'trail',
        details: [{
          component: `CloudTrail${isMultiRegion ? ' (Multi-Region)' : ''} Data Events (est. 100k)`,
          quantity: estimatedDataEvents,
          unitPrice: dataEventPrice / 100000,
          monthlyCost,
          unit: 'events',
        }],
        confidence: 'low',
      };
    });
    
    // CodeBuild Project
    calculators.set('AWS::CodeBuild::Project', (logicalId, resource, template, pricing) => {
      const computeType = TemplateParser.getPropertyValue(template, resource, 'Environment.ComputeType', 'BUILD_GENERAL1_SMALL') as string;
      const environmentType = TemplateParser.getPropertyValue(template, resource, 'Environment.Type', 'LINUX_CONTAINER') as string;
      
      // Estimate 100 build minutes/month
      const estimatedMinutes = 100;
      let pricePerMinute: number;
      
      if (environmentType === 'ARM_CONTAINER') {
        pricePerMinute = pricing.codebuild?.armLarge || 0.015;
      } else if (environmentType === 'LINUX_GPU_CONTAINER') {
        pricePerMinute = pricing.codebuild?.gpuLarge || 0.18;
      } else if (environmentType.includes('WINDOWS')) {
        pricePerMinute = computeType.includes('LARGE') ? (pricing.codebuild?.windowsLarge || 0.04) : (pricing.codebuild?.windowsMedium || 0.02);
      } else {
        switch (computeType) {
          case 'BUILD_GENERAL1_MEDIUM':
            pricePerMinute = pricing.codebuild?.linuxMedium || 0.01;
            break;
          case 'BUILD_GENERAL1_LARGE':
            pricePerMinute = pricing.codebuild?.linuxLarge || 0.02;
            break;
          case 'BUILD_GENERAL1_2XLARGE':
            pricePerMinute = pricing.codebuild?.linux2xlarge || 0.04;
            break;
          default:
            pricePerMinute = pricing.codebuild?.linuxSmall || 0.005;
        }
      }
      
      const monthlyCost = estimatedMinutes * pricePerMinute;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CodeBuild::Project',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'project',
        details: [{
          component: `CodeBuild ${computeType} (est. ${estimatedMinutes} min)`,
          quantity: estimatedMinutes,
          unitPrice: pricePerMinute,
          monthlyCost,
          unit: 'minutes',
        }],
        confidence: 'low',
      };
    });
    
    // Glue Job
    calculators.set('AWS::Glue::Job', (logicalId, resource, template, pricing) => {
      // Estimate 10 DPU-hours/month
      const estimatedDpuHours = 10;
      const dpuPrice = pricing.glue?.dpuHour || 0.44;
      const monthlyCost = estimatedDpuHours * dpuPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Glue::Job',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'job',
        details: [{
          component: 'Glue Job (est. 10 DPU-hours)',
          quantity: estimatedDpuHours,
          unitPrice: dpuPrice,
          monthlyCost,
          unit: 'DPU-hours',
        }],
        confidence: 'low',
      };
    });
    
    // Glue Crawler
    calculators.set('AWS::Glue::Crawler', (logicalId, resource, template, pricing) => {
      // Estimate 5 DPU-hours/month
      const estimatedDpuHours = 5;
      const dpuPrice = pricing.glue?.crawlerDpuHour || 0.44;
      const monthlyCost = estimatedDpuHours * dpuPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Glue::Crawler',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'crawler',
        details: [{
          component: 'Glue Crawler (est. 5 DPU-hours)',
          quantity: estimatedDpuHours,
          unitPrice: dpuPrice,
          monthlyCost,
          unit: 'DPU-hours',
        }],
        confidence: 'low',
      };
    });
    
    // WAFv2 WebACL
    calculators.set('AWS::WAFv2::WebACL', (logicalId, resource, template, pricing) => {
      const rules = resource.Properties?.Rules as unknown[] || [];
      const ruleCount = rules.length;
      
      const webAclPrice = pricing.waf?.webACL || 5.00;
      const rulePrice = pricing.waf?.rule || 1.00;
      const monthlyCost = webAclPrice + (ruleCount * rulePrice);
      
      const details: CostDetail[] = [{
        component: 'Web ACL',
        quantity: 1,
        unitPrice: webAclPrice,
        monthlyCost: webAclPrice,
        unit: 'ACL/month',
      }];
      
      if (ruleCount > 0) {
        details.push({
          component: `Rules (${ruleCount})`,
          quantity: ruleCount,
          unitPrice: rulePrice,
          monthlyCost: ruleCount * rulePrice,
          unit: 'rules/month',
        });
      }
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::WAFv2::WebACL',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'web ACL',
        details,
        confidence: 'medium',
      };
    });
    
    // WAF (v1) WebACL
    calculators.set('AWS::WAF::WebACL', (logicalId, resource, template, pricing) => {
      const webAclPrice = pricing.waf?.webACL || 5.00;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::WAF::WebACL',
        monthlyCost: webAclPrice,
        hourlyCost: webAclPrice / HOURS_PER_MONTH,
        unit: 'web ACL',
        details: [{
          component: 'WAF Web ACL',
          quantity: 1,
          unitPrice: webAclPrice,
          monthlyCost: webAclPrice,
          unit: 'ACL/month',
        }],
        confidence: 'medium',
      };
    });
    
    // OpenSearch Domain
    calculators.set('AWS::OpenSearchService::Domain', (logicalId, resource, template, pricing) => {
      const instanceType = TemplateParser.getPropertyValue(template, resource, 'ClusterConfig.InstanceType', 't3.small.search') as string;
      const instanceCount = TemplateParser.getPropertyValue(template, resource, 'ClusterConfig.InstanceCount', 1) as number;
      const hourlyPrice = pricing.opensearch?.instances?.[instanceType] || pricing.opensearch?.instances?.['t3.small.search'] || 0.036;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * instanceCount;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::OpenSearchService::Domain',
        monthlyCost,
        hourlyCost: hourlyPrice * instanceCount,
        unit: 'domain',
        details: [{
          component: `OpenSearch ${instanceType} (${instanceCount} instances)`,
          quantity: instanceCount * HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'instance-hours',
        }],
        confidence: 'high',
      };
    });
    
    // Elasticsearch Domain (legacy)
    calculators.set('AWS::Elasticsearch::Domain', (logicalId, resource, template, pricing) => {
      const instanceType = TemplateParser.getPropertyValue(template, resource, 'ElasticsearchClusterConfig.InstanceType', 't3.small.elasticsearch') as string;
      const instanceCount = TemplateParser.getPropertyValue(template, resource, 'ElasticsearchClusterConfig.InstanceCount', 1) as number;
      const hourlyPrice = pricing.elasticsearch?.instances?.[instanceType] || pricing.opensearch?.instances?.['t3.small.search'] || 0.036;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * instanceCount;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Elasticsearch::Domain',
        monthlyCost,
        hourlyCost: hourlyPrice * instanceCount,
        unit: 'domain',
        details: [{
          component: `Elasticsearch ${instanceType} (${instanceCount} instances)`,
          quantity: instanceCount * HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'instance-hours',
        }],
        confidence: 'high',
      };
    });
    
    // Lightsail Instance
    calculators.set('AWS::Lightsail::Instance', (logicalId, resource, template, pricing) => {
      const bundleId = TemplateParser.getPropertyValue(template, resource, 'BundleId', 'nano_2_0') as string;
      
      let monthlyPrice = 3.50;
      if (bundleId.includes('micro')) monthlyPrice = pricing.lightsail?.instances?.['micro'] || 5.00;
      else if (bundleId.includes('small')) monthlyPrice = pricing.lightsail?.instances?.['small'] || 10.00;
      else if (bundleId.includes('medium')) monthlyPrice = pricing.lightsail?.instances?.['medium'] || 20.00;
      else if (bundleId.includes('large')) monthlyPrice = 40.00;
      else if (bundleId.includes('xlarge')) monthlyPrice = 80.00;
      else monthlyPrice = pricing.lightsail?.instances?.['nano'] || 3.50;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Lightsail::Instance',
        monthlyCost: monthlyPrice,
        hourlyCost: monthlyPrice / HOURS_PER_MONTH,
        unit: 'instance',
        details: [{
          component: `Lightsail ${bundleId}`,
          quantity: 1,
          unitPrice: monthlyPrice,
          monthlyCost: monthlyPrice,
          unit: 'instance/month',
        }],
        confidence: 'high',
      };
    });
    
    // DMS Replication Instance
    calculators.set('AWS::DMS::ReplicationInstance', (logicalId, resource, template, pricing) => {
      const instanceClass = TemplateParser.getPropertyValue(template, resource, 'ReplicationInstanceClass', 'dms.t3.micro') as string;
      const hourlyPrice = pricing.dms?.instances?.[instanceClass] || pricing.dms?.instances?.['dms.t3.micro'] || 0.018;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::DMS::ReplicationInstance',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'instance',
        details: [{
          component: `DMS ${instanceClass}`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });
    
    // Transfer Family Server
    calculators.set('AWS::Transfer::Server', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.transferFamily?.protocols || 0.30;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Transfer::Server',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'server',
        details: [{
          component: 'AWS Transfer Family Server',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'medium',
      };
    });
    
    // CodePipeline
    calculators.set('AWS::CodePipeline::Pipeline', (logicalId, resource, template, pricing) => {
      const pipelinePrice = pricing.codepipeline?.activePipeline || 1.00;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CodePipeline::Pipeline',
        monthlyCost: pipelinePrice,
        hourlyCost: pipelinePrice / HOURS_PER_MONTH,
        unit: 'pipeline',
        details: [{
          component: 'CodePipeline Active Pipeline',
          quantity: 1,
          unitPrice: pipelinePrice,
          monthlyCost: pipelinePrice,
          unit: 'pipeline/month',
        }],
        confidence: 'high',
      };
    });
    
    // Network Firewall
    calculators.set('AWS::NetworkFirewall::Firewall', (logicalId, resource, template, pricing) => {
      // $0.395/hour per endpoint + data processing
      const endpointHourly = 0.395;
      const subnetMappings = resource.Properties?.SubnetMappings as unknown[] || [{}];
      const endpointCount = subnetMappings.length;
      const baseCost = endpointHourly * HOURS_PER_MONTH * endpointCount;
      
      // Estimate 100GB data processed
      const estimatedDataGB = 100;
      const dataPrice = 0.065;
      const dataCost = estimatedDataGB * dataPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::NetworkFirewall::Firewall',
        monthlyCost: baseCost + dataCost,
        hourlyCost: endpointHourly * endpointCount,
        unit: 'firewall',
        details: [
          {
            component: `Network Firewall Endpoints (${endpointCount})`,
            quantity: endpointCount * HOURS_PER_MONTH,
            unitPrice: endpointHourly,
            monthlyCost: baseCost,
            unit: 'endpoint-hours',
          },
          {
            component: 'Data Processing (est. 100GB)',
            quantity: estimatedDataGB,
            unitPrice: dataPrice,
            monthlyCost: dataCost,
            unit: 'GB',
          },
        ],
        confidence: 'medium',
      };
    });
    
    // Grafana Workspace
    calculators.set('AWS::Grafana::Workspace', (logicalId, resource, template, pricing) => {
      // $9/editor/month + $5/viewer/month, estimate 2 editors
      const editorPrice = 9.00;
      const estimatedEditors = 2;
      const monthlyCost = editorPrice * estimatedEditors;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Grafana::Workspace',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'workspace',
        details: [{
          component: 'Managed Grafana Editors (est. 2)',
          quantity: estimatedEditors,
          unitPrice: editorPrice,
          monthlyCost,
          unit: 'editors/month',
        }],
        confidence: 'low',
      };
    });
    
    // SageMaker Notebook Instance
    calculators.set('AWS::SageMaker::NotebookInstance', (logicalId, resource, template, pricing) => {
      const instanceType = TemplateParser.getPropertyValue(template, resource, 'InstanceType', 'ml.t3.medium') as string;
      const hourlyPrice = pricing.sagemaker?.notebookInstances?.[instanceType] || 0.05;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::SageMaker::NotebookInstance',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'notebook instance',
        details: [{
          component: `SageMaker Notebook ${instanceType}`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'medium',
      };
    });
    
    // Directory Service - Simple AD
    calculators.set('AWS::DirectoryService::SimpleAD', (logicalId, resource, template, pricing) => {
      const size = TemplateParser.getPropertyValue(template, resource, 'Size', 'Small') as string;
      const sizeLower = size.toLowerCase();
      const simpleADPricing = pricing.directoryService?.simpleAD as Record<string, number> | undefined;
      
      const hourlyPrice = simpleADPricing?.[sizeLower] || 
                          (sizeLower === 'large' ? 0.15 : 0.05);
      
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::DirectoryService::SimpleAD',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'directory',
        details: [{
          component: `Simple AD (${size})`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });

    // Directory Service - Microsoft AD
    calculators.set('AWS::DirectoryService::MicrosoftAD', (logicalId, resource, template, pricing) => {
      const edition = TemplateParser.getPropertyValue(template, resource, 'Edition', 'Standard') as string;
      const editionLower = edition.toLowerCase();
      const msADPricing = pricing.directoryService?.microsoftAD as Record<string, number> | undefined;
      
      const hourlyPrice = msADPricing?.[editionLower] || 
                          (editionLower === 'enterprise' ? 0.40 : 0.12);
      
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::DirectoryService::MicrosoftAD',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'directory',
        details: [{
          component: `Microsoft AD (${edition})`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });

    // MWAA Environment
    calculators.set('AWS::MWAA::Environment', (logicalId, resource, template, pricing) => {
      const environmentClass = TemplateParser.getPropertyValue(template, resource, 'EnvironmentClass', 'mw1.small') as string;
      
      const hourlyPrice = pricing.mwaa?.environment?.[environmentClass] || 0.49;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::MWAA::Environment',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'environment',
        details: [{
          component: `MWAA Environment (${environmentClass})`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });

    // Kinesis Analytics V2
    calculators.set('AWS::KinesisAnalyticsV2::Application', (logicalId, resource, template, pricing) => {
      // Base cost: 1 KPU per hour for orchestration (Infracost says 2 KPUs for Studio, 1 for App?)
      // Assuming 1 KPU baseline for running application
      const kpuHourly = pricing.kinesisAnalytics?.kpuHourly || 0.11;
      const runningKpus = 1; 
      const monthlyCost = kpuHourly * runningKpus * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::KinesisAnalyticsV2::Application',
        monthlyCost,
        hourlyCost: kpuHourly * runningKpus,
        unit: 'application',
        details: [{
          component: 'Kinesis Analytics Application (1 KPU est.)',
          quantity: HOURS_PER_MONTH,
          unitPrice: kpuHourly,
          monthlyCost,
          unit: 'KPU-hours',
        }],
        confidence: 'low',
      };
    });

    // CloudFront Function
    calculators.set('AWS::CloudFront::Function', (logicalId, resource, template, pricing) => {
      // Estimate 2M invocations/month
      const estimatedInvocations = 2000000;
      const pricePerMillion = pricing.cloudfront?.functions || 0.10;
      const monthlyCost = (estimatedInvocations / 1000000) * pricePerMillion;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::CloudFront::Function',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'function',
        details: [{
          component: 'CloudFront Function Invocations (est. 2M/mo)',
          quantity: estimatedInvocations,
          unitPrice: pricePerMillion / 1000000,
          monthlyCost,
          unit: 'invocations',
        }],
        confidence: 'low',
      };
    });

    // Route 53 Resolver Endpoint
    calculators.set('AWS::Route53Resolver::ResolverEndpoint', (logicalId, resource, template, pricing) => {
      const ipAddresses = TemplateParser.getPropertyValue(template, resource, 'IpAddresses', []) as unknown[];
      const eniCount = Math.max(ipAddresses.length, 2); // Minimum 2 for high availability usually
      
      const hourlyPrice = pricing.route53?.resolverEndpoint || 0.125;
      const monthlyCost = hourlyPrice * eniCount * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Route53Resolver::ResolverEndpoint',
        monthlyCost,
        hourlyCost: hourlyPrice * eniCount,
        unit: 'endpoint',
        details: [{
          component: `Resolver Endpoint ENIs (${eniCount})`,
          quantity: eniCount * HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'ENI-hours',
        }],
        confidence: 'medium',
      };
    });

    // Route 53 Health Check
    calculators.set('AWS::Route53::HealthCheck', (logicalId, resource, template, pricing) => {
      // Assume basic health check
      const monthlyPrice = pricing.route53?.healthChecks?.basic || 0.50;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Route53::HealthCheck',
        monthlyCost: monthlyPrice,
        hourlyCost: monthlyPrice / HOURS_PER_MONTH,
        unit: 'health check',
        details: [{
          component: 'Route 53 Health Check (Basic)',
          quantity: 1,
          unitPrice: monthlyPrice,
          monthlyCost: monthlyPrice,
          unit: 'check/month',
        }],
        confidence: 'medium',
      };
    });

    // EC2 Client VPN Endpoint
    calculators.set('AWS::EC2::ClientVpnEndpoint', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.vpnConnection?.clientVpn?.endpointHourly || 0.05;
      const connectionHourly = pricing.vpnConnection?.clientVpn?.connectionHourly || 0.05;
      
      // Estimate 1 active connection
      const estimatedConnections = 1;
      const endpointCost = hourlyPrice * HOURS_PER_MONTH;
      const connectionCost = connectionHourly * estimatedConnections * HOURS_PER_MONTH;
      const monthlyCost = endpointCost + connectionCost;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::ClientVpnEndpoint',
        monthlyCost,
        hourlyCost: hourlyPrice + (connectionHourly * estimatedConnections),
        unit: 'endpoint',
        details: [
          {
            component: 'Client VPN Endpoint',
            quantity: HOURS_PER_MONTH,
            unitPrice: hourlyPrice,
            monthlyCost: endpointCost,
            unit: 'hours',
          },
          {
            component: 'VPN Connection (est. 1)',
            quantity: estimatedConnections * HOURS_PER_MONTH,
            unitPrice: connectionHourly,
            monthlyCost: connectionCost,
            unit: 'connection-hours',
          }
        ],
        confidence: 'medium',
      };
    });

    // EC2 Traffic Mirror Session
    calculators.set('AWS::EC2::TrafficMirrorSession', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.trafficMirror?.sessionHourly || 0.15;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::TrafficMirrorSession',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'session',
        details: [{
          component: 'Traffic Mirror Session',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });

    // EC2 Transit Gateway Peering Attachment
    calculators.set('AWS::EC2::TransitGatewayPeeringAttachment', (logicalId, resource, template, pricing) => {
      const hourlyPrice = pricing.transitGateway?.peering || 0.05;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::TransitGatewayPeeringAttachment',
        monthlyCost,
        hourlyCost: hourlyPrice,
        unit: 'attachment',
        details: [{
          component: 'Transit Gateway Peering Attachment',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'high',
      };
    });

    // EC2 Dedicated Host
    calculators.set('AWS::EC2::Host', (logicalId, resource, template, pricing) => {
      const instanceType = TemplateParser.getPropertyValue(template, resource, 'InstanceType', 'm5.large') as string;
      // Use dedicated host pricing or fallback to instance price + 10%
      const hostPrice = pricing.ec2?.hosts?.[instanceType] || (pricing.ec2?.instances?.[instanceType] || 0.096) * 1.1;
      const monthlyCost = hostPrice * HOURS_PER_MONTH;

      return {
        resourceId: logicalId,
        resourceType: 'AWS::EC2::Host',
        monthlyCost,
        hourlyCost: hostPrice,
        unit: 'host',
        details: [{
          component: `Dedicated Host (${instanceType})`,
          quantity: HOURS_PER_MONTH,
          unitPrice: hostPrice,
          monthlyCost,
          unit: 'hours',
        }],
        confidence: 'medium',
      };
    });

    // EKS Nodegroup
    calculators.set('AWS::EKS::Nodegroup', (logicalId, resource, template, pricing) => {
      const scalingConfig = resource.Properties?.ScalingConfig as any;
      const desiredSize = scalingConfig?.DesiredSize || scalingConfig?.MinSize || 1;
      
      const instanceTypes = (resource.Properties?.InstanceTypes as string[]) || ['t3.medium'];
      const instanceType = instanceTypes[0];
      
      const hourlyPrice = pricing.ec2.instances[instanceType] || pricing.ec2.instances['t3.medium'] || 0.0416;
      const monthlyCost = hourlyPrice * HOURS_PER_MONTH * desiredSize;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EKS::Nodegroup',
        monthlyCost,
        hourlyCost: hourlyPrice * desiredSize,
        unit: 'nodegroup',
        details: [{
          component: `EKS Node Group (${desiredSize} x ${instanceType})`,
          quantity: desiredSize * HOURS_PER_MONTH,
          unitPrice: hourlyPrice,
          monthlyCost,
          unit: 'instance-hours',
        }],
        confidence: 'medium',
      };
    });

    // EKS Fargate Profile
    calculators.set('AWS::EKS::FargateProfile', (logicalId, resource, template, pricing) => {
      // Estimate 1 pod running continuously
      // vCPU: 0.25, Memory: 0.5 GB (small pod)
      const vcpuHourly = pricing.eks?.fargateVcpuHourly || pricing.fargate?.vcpuHourly || 0.04048;
      const memoryHourly = pricing.eks?.fargateMemoryGBHourly || pricing.fargate?.memoryGBHourly || 0.004445;
      
      const estimatedVcpu = 0.25;
      const estimatedMemory = 0.5;
      
      const hourlyCost = (vcpuHourly * estimatedVcpu) + (memoryHourly * estimatedMemory);
      const monthlyCost = hourlyCost * HOURS_PER_MONTH;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::EKS::FargateProfile',
        monthlyCost,
        hourlyCost,
        unit: 'profile',
        details: [{
          component: 'Fargate Pods (est. 1 small pod)',
          quantity: HOURS_PER_MONTH,
          unitPrice: hourlyCost,
          monthlyCost,
          unit: 'pod-hours',
        }],
        confidence: 'low',
      };
    });

    // Glue Database
    calculators.set('AWS::Glue::Database', (logicalId, resource, template, pricing) => {
      // Estimate small metadata storage
      // Pricing is for Data Catalog storage (per 100K objects? No, usually per GB or requests)
      // Infracost uses 100KB placeholder or similar? 
      // AWS Glue Data Catalog storage is free for the first million objects.
      // Requests are $1.00 per million.
      // So for a single database, cost is negligible/zero unless huge.
      // But Infracost lists it.
      
      // Let's assume negligible unless we have usage data.
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Glue::Database',
        monthlyCost: 0,
        hourlyCost: 0,
        unit: 'database',
        details: [{
          component: 'Glue Database (free tier/negligible)',
          quantity: 1,
          unitPrice: 0,
          monthlyCost: 0,
          unit: 'database',
        }],
        confidence: 'high',
      };
    });

    // Config Recorder
    calculators.set('AWS::Config::ConfigurationRecorder', (logicalId, resource, template, pricing) => {
      // $0.003 per configuration item recorded
      // Estimate 1000 items per month
      const itemPrice = pricing.config?.configItems || 0.003;
      const estimatedItems = 1000;
      const monthlyCost = estimatedItems * itemPrice;
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::Config::ConfigurationRecorder',
        monthlyCost,
        hourlyCost: monthlyCost / HOURS_PER_MONTH,
        unit: 'recorder',
        details: [{
          component: 'Config Items Recorded (est. 1000/mo)',
          quantity: estimatedItems,
          unitPrice: itemPrice,
          monthlyCost,
          unit: 'items',
        }],
        confidence: 'low',
      };
    });

    // SSM Activation
    calculators.set('AWS::SSM::Activation', (logicalId, resource, template, pricing) => {
      // Only Advanced instances cost money.
      // But Activation resource doesn't specify tier explicitly? 
      // It registers a managed instance. The instance tier is set on the instance (agent) or account settings.
      // However, if we assume standard (default), it's free (up to 1000).
      
      return {
        resourceId: logicalId,
        resourceType: 'AWS::SSM::Activation',
        monthlyCost: 0,
        hourlyCost: 0,
        unit: 'activation',
        details: [{
          component: 'SSM Activation (Standard)',
          quantity: 1,
          unitPrice: 0,
          monthlyCost: 0,
          unit: 'activation',
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
    
    const requestPrice = this.pricing.lambda.requests || 0.20;
    const durationPrice = this.pricing.lambda.duration || 0.0000166667;
    const freeDuration = 400000; // GB-seconds free tier
    
    const gbSeconds = (memorySize / 1024) * (avgDurationMs / 1000) * estimatedInvocations;
    const requestCost = (estimatedInvocations / 1000000) * requestPrice;
    const computeCost = Math.max(0, gbSeconds - freeDuration) * durationPrice;
    
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
          unitPrice: requestPrice / 1000000,
          monthlyCost: requestCost,
          unit: 'requests',
        },
        {
          component: `Lambda Compute (${memorySize}MB, ${avgDurationMs}ms avg)`,
          quantity: gbSeconds,
          unitPrice: durationPrice,
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
    const dynamo = this.pricing.other?.dynamodb || {
      readCapacity: 0.00013,
      writeCapacity: 0.00065,
      onDemandRead: 0.25,
      onDemandWrite: 1.25,
      storage: 0.25,
    };
    
    if (billingMode === 'PAY_PER_REQUEST') {
      // On-demand - estimate based on usage
      const estimatedWrites = 1000000; // 1M writes/month
      const estimatedReads = 5000000; // 5M reads/month
      
      const writeCost = (estimatedWrites / 1000000) * dynamo.onDemandWrite;
      const readCost = (estimatedReads / 1000000) * dynamo.onDemandRead;
      
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
            unitPrice: dynamo.onDemandWrite / 1000000,
            monthlyCost: writeCost,
            unit: 'writes',
          },
          {
            component: 'DynamoDB On-Demand Reads (est. 5M/mo)',
            quantity: estimatedReads,
            unitPrice: dynamo.onDemandRead / 1000000,
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
    
    // Provisioned pricing is per hour, multiply by hours per month
    const readCost = readCapacity * dynamo.readCapacity * HOURS_PER_MONTH;
    const writeCost = writeCapacity * dynamo.writeCapacity * HOURS_PER_MONTH;
    
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
          unitPrice: dynamo.readCapacity * HOURS_PER_MONTH,
          monthlyCost: readCost,
          unit: 'RCU/month',
        },
        {
          component: `DynamoDB Write Capacity (${writeCapacity} WCU)`,
          quantity: writeCapacity,
          unitPrice: dynamo.writeCapacity * HOURS_PER_MONTH,
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
    const s3Pricing = this.pricing.other?.s3 || { standardStorage: 0.023 };
    
    // Estimate 100GB storage
    const estimatedStorageGB = 100;
    const storageCost = estimatedStorageGB * s3Pricing.standardStorage;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::S3::Bucket',
      monthlyCost: storageCost,
      hourlyCost: storageCost / HOURS_PER_MONTH,
      unit: 'bucket',
      details: [{
        component: 'S3 Storage (est. 100GB)',
        quantity: estimatedStorageGB,
        unitPrice: s3Pricing.standardStorage,
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
    const sqsPricing = this.pricing.other?.sqs || { standard: 0.40, fifo: 0.50 };
    const isFifo = (resource.Properties?.QueueName as string)?.endsWith('.fifo') || 
                   resource.Properties?.FifoQueue === true;
    
    // Estimate 1M requests/month
    const estimatedRequests = 1000000;
    const pricePerMillion = isFifo ? sqsPricing.fifo : sqsPricing.standard;
    const requestCost = (estimatedRequests / 1000000) * pricePerMillion;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::SQS::Queue',
      monthlyCost: requestCost,
      hourlyCost: requestCost / HOURS_PER_MONTH,
      unit: 'queue',
      details: [{
        component: `SQS ${isFifo ? 'FIFO' : 'Standard'} Requests (est. 1M/mo)`,
        quantity: estimatedRequests,
        unitPrice: pricePerMillion / 1000000,
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
    const apiPricing = this.pricing.other?.apiGateway || { rest: 3.50, http: 1.00, websocket: 1.00 };
    const isHttpApi = resource.Type === 'AWS::ApiGatewayV2::Api';
    const estimatedRequests = 1000000; // 1M requests/month
    
    const pricePerMillion = isHttpApi ? apiPricing.http : apiPricing.rest;
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
    const sfPricing = this.pricing.other?.stepFunctions || { standard: 25.00, express: 1.00 };
    const type = TemplateParser.getPropertyValue(template, resource, 'StateMachineType', 'STANDARD') as string;
    
    // Estimate 10,000 executions/month with 5 transitions each
    const estimatedExecutions = 10000;
    const transitionsPerExecution = 5;
    const totalTransitions = estimatedExecutions * transitionsPerExecution;
    
    const pricePerMillion = type === 'EXPRESS' ? sfPricing.express : sfPricing.standard;
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
  
  /**
   * Calculate SNS Topic cost
   */
  private calculateSNSCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const snsPricing = this.pricing.other?.sns || { publish: 0.50 };
    
    // Estimate 1M publishes/month
    const estimatedPublishes = 1000000;
    const publishCost = (estimatedPublishes / 1000000) * snsPricing.publish;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::SNS::Topic',
      monthlyCost: publishCost,
      hourlyCost: publishCost / HOURS_PER_MONTH,
      unit: 'topic',
      details: [{
        component: 'SNS Publishes (est. 1M/mo)',
        quantity: estimatedPublishes,
        unitPrice: snsPricing.publish / 1000000,
        monthlyCost: publishCost,
        unit: 'publishes',
      }],
      confidence: 'low',
    };
  }
  
  /**
   * Calculate CloudWatch Logs cost
   */
  private calculateCloudWatchLogsCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const cwPricing = this.pricing.other?.cloudwatch || { logsIngestion: 0.50, logsStorage: 0.03 };
    
    // Estimate 10GB/month ingestion, 50GB storage
    const estimatedIngestionGB = 10;
    const estimatedStorageGB = 50;
    
    const ingestionCost = estimatedIngestionGB * cwPricing.logsIngestion;
    const storageCost = estimatedStorageGB * cwPricing.logsStorage;
    const totalCost = ingestionCost + storageCost;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::Logs::LogGroup',
      monthlyCost: totalCost,
      hourlyCost: totalCost / HOURS_PER_MONTH,
      unit: 'log group',
      details: [
        {
          component: 'Log Data Ingestion (est. 10GB/mo)',
          quantity: estimatedIngestionGB,
          unitPrice: cwPricing.logsIngestion,
          monthlyCost: ingestionCost,
          unit: 'GB',
        },
        {
          component: 'Log Storage (est. 50GB)',
          quantity: estimatedStorageGB,
          unitPrice: cwPricing.logsStorage,
          monthlyCost: storageCost,
          unit: 'GB',
        },
      ],
      confidence: 'low',
    };
  }
  
  /**
   * Calculate SSM Parameter cost
   */
  private calculateSSMParameterCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const tier = TemplateParser.getPropertyValue(template, resource, 'Tier', 'Standard') as string;
    
    // Standard parameters: first 10,000 free, then $0.05 per parameter/month
    // Advanced parameters: $0.05 per parameter/month
    const isAdvanced = tier === 'Advanced';
    
    // Estimate 10,000 API calls/month
    const estimatedApiCalls = 10000;
    const apiCallCost = (estimatedApiCalls / 10000) * 0.05; // $0.05 per 10,000 API calls
    
    // Parameter storage cost
    let parameterCost = 0;
    if (isAdvanced) {
      parameterCost = 0.05; // $0.05/month for Advanced tier
    }
    
    const totalCost = apiCallCost + parameterCost;
    
    const details: CostDetail[] = [];
    if (parameterCost > 0) {
      details.push({
        component: 'Advanced Parameter Storage',
        quantity: 1,
        unitPrice: parameterCost,
        monthlyCost: parameterCost,
        unit: 'parameter/month',
      });
    }
    details.push({
      component: 'API Calls (est. 10k/mo)',
      quantity: estimatedApiCalls,
      unitPrice: 0.05 / 10000,
      monthlyCost: apiCallCost,
      unit: 'calls',
    });
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::SSM::Parameter',
      monthlyCost: totalCost,
      hourlyCost: totalCost / HOURS_PER_MONTH,
      unit: 'parameter',
      details,
      confidence: 'low',
    };
  }
  
  /**
   * Calculate ECR Repository cost
   */
  private calculateECRCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const ecrPricing = this.pricing.other?.ecr || { storage: 0.10 };
    
    // Estimate 10GB storage
    const estimatedStorageGB = 10;
    const storageCost = estimatedStorageGB * ecrPricing.storage;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::ECR::Repository',
      monthlyCost: storageCost,
      hourlyCost: storageCost / HOURS_PER_MONTH,
      unit: 'repository',
      details: [{
        component: 'ECR Storage (est. 10GB)',
        quantity: estimatedStorageGB,
        unitPrice: ecrPricing.storage,
        monthlyCost: storageCost,
        unit: 'GB/month',
      }],
      confidence: 'low',
    };
  }

  /**
   * Calculate Route 53 Record Set cost
   */
  private calculateRoute53RecordSetCost(
    logicalId: string,
    resource: CloudFormationResource,
    template: CloudFormationTemplate
  ): ResourceCost {
    const queriesPrice = this.pricing.route53?.queries || 0.40;
    
    // Estimate 1M queries/month
    const estimatedQueries = 1000000;
    const monthlyCost = (estimatedQueries / 1000000) * queriesPrice;
    
    return {
      resourceId: logicalId,
      resourceType: 'AWS::Route53::RecordSet',
      monthlyCost,
      hourlyCost: monthlyCost / HOURS_PER_MONTH,
      unit: 'record set',
      details: [{
        component: 'DNS Queries (est. 1M/mo)',
        quantity: estimatedQueries,
        unitPrice: queriesPrice / 1000000,
        monthlyCost,
        unit: 'queries',
      }],
      confidence: 'low',
    };
  }
}

