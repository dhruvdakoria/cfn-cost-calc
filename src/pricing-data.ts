/**
 * AWS Pricing Data for common services
 * Prices are monthly estimates in USD for us-east-1 region
 * These are approximate values - actual costs may vary based on usage patterns
 * 
 * Data structure: region -> service -> pricing details
 */

export interface EC2InstancePricing {
  [instanceType: string]: number; // hourly price
}

export interface EBSPricing {
  gp2: number; // per GB/month
  gp3: number;
  io1: number;
  io2: number;
  st1: number;
  sc1: number;
  standard: number;
}

export interface RDSPricing {
  [instanceClass: string]: number; // hourly price
}

export interface LambdaPricing {
  requestPrice: number; // per million requests
  durationPrice: number; // per GB-second
  freeRequests: number;
  freeDuration: number;
}

export interface S3Pricing {
  storage: number; // per GB/month
  requests: number; // per 1000 requests
}

export interface RegionalPricing {
  ec2: EC2InstancePricing;
  ebs: EBSPricing;
  rds: RDSPricing;
  lambda: LambdaPricing;
  s3: S3Pricing;
  dynamodb: {
    writeCapacityUnit: number; // per WCU/month
    readCapacityUnit: number; // per RCU/month
    storagePerGB: number;
    onDemandWrite: number; // per million writes
    onDemandRead: number; // per million reads
  };
  elasticache: {
    [nodeType: string]: number; // hourly price
  };
  sns: {
    requestsPerMillion: number;
    smsPerMessage: number;
  };
  sqs: {
    requestsPerMillion: number;
  };
  apiGateway: {
    restApiPerMillion: number;
    httpApiPerMillion: number;
    websocketPerMillion: number;
  };
  cloudwatch: {
    metricsPerMonth: number;
    logsIngestionPerGB: number;
    logsStoragePerGB: number;
    dashboardsPerMonth: number;
    alarmsPerMonth: number;
  };
  ecs: {
    fargateVCPUPerHour: number;
    fargateMemoryPerGBHour: number;
  };
  eks: {
    clusterPerHour: number;
  };
  nat: {
    gatewayPerHour: number;
    dataProcessedPerGB: number;
  };
  alb: {
    perHour: number;
    lcuPerHour: number;
  };
  nlb: {
    perHour: number;
    lcuPerHour: number;
  };
  elasticIP: {
    perHour: number; // only when not attached
    dataTransferPerGB: number;
  };
  secretsManager: {
    perSecretPerMonth: number;
    perAPICallPer10k: number;
  };
  kms: {
    perKeyPerMonth: number;
    perRequestPer10k: number;
  };
  stepFunctions: {
    standardTransitionsPerMillion: number;
    expressPerMillion: number;
  };
  eventBridge: {
    customEventsPerMillion: number;
    archivePerGB: number;
  };
  cognito: {
    mauFreeLimit: number;
    perMAUAboveFree: number;
  };
  route53: {
    hostedZonePerMonth: number;
    queriesPerMillion: number;
  };
}

// Comprehensive pricing data for US East (N. Virginia) region
// Prices as of late 2024 - approximate values
const US_EAST_1_PRICING: RegionalPricing = {
  ec2: {
    // General Purpose
    't3.nano': 0.0052,
    't3.micro': 0.0104,
    't3.small': 0.0208,
    't3.medium': 0.0416,
    't3.large': 0.0832,
    't3.xlarge': 0.1664,
    't3.2xlarge': 0.3328,
    't3a.nano': 0.0047,
    't3a.micro': 0.0094,
    't3a.small': 0.0188,
    't3a.medium': 0.0376,
    't3a.large': 0.0752,
    't3a.xlarge': 0.1504,
    't3a.2xlarge': 0.3008,
    'm5.large': 0.096,
    'm5.xlarge': 0.192,
    'm5.2xlarge': 0.384,
    'm5.4xlarge': 0.768,
    'm5.8xlarge': 1.536,
    'm5.12xlarge': 2.304,
    'm5.16xlarge': 3.072,
    'm5.24xlarge': 4.608,
    'm6i.large': 0.096,
    'm6i.xlarge': 0.192,
    'm6i.2xlarge': 0.384,
    'm6i.4xlarge': 0.768,
    'm6i.8xlarge': 1.536,
    'm7i.large': 0.1008,
    'm7i.xlarge': 0.2016,
    'm7i.2xlarge': 0.4032,
    // Compute Optimized
    'c5.large': 0.085,
    'c5.xlarge': 0.17,
    'c5.2xlarge': 0.34,
    'c5.4xlarge': 0.68,
    'c5.9xlarge': 1.53,
    'c6i.large': 0.085,
    'c6i.xlarge': 0.17,
    'c6i.2xlarge': 0.34,
    'c7i.large': 0.0893,
    'c7i.xlarge': 0.1785,
    // Memory Optimized
    'r5.large': 0.126,
    'r5.xlarge': 0.252,
    'r5.2xlarge': 0.504,
    'r5.4xlarge': 1.008,
    'r6i.large': 0.126,
    'r6i.xlarge': 0.252,
    'r7i.large': 0.1323,
    // Storage Optimized
    'i3.large': 0.156,
    'i3.xlarge': 0.312,
    'i3.2xlarge': 0.624,
    // ARM-based
    't4g.nano': 0.0042,
    't4g.micro': 0.0084,
    't4g.small': 0.0168,
    't4g.medium': 0.0336,
    't4g.large': 0.0672,
    't4g.xlarge': 0.1344,
    'm6g.large': 0.077,
    'm6g.xlarge': 0.154,
    'm6g.2xlarge': 0.308,
    'm7g.large': 0.0816,
    'm7g.xlarge': 0.1632,
    'c6g.large': 0.068,
    'c6g.xlarge': 0.136,
    'c7g.large': 0.0725,
    'r6g.large': 0.1008,
    'r6g.xlarge': 0.2016,
    'r7g.large': 0.107,
  },
  ebs: {
    gp2: 0.10, // per GB/month
    gp3: 0.08,
    io1: 0.125,
    io2: 0.125,
    st1: 0.045,
    sc1: 0.015,
    standard: 0.05,
  },
  rds: {
    // MySQL/PostgreSQL/MariaDB
    'db.t3.micro': 0.017,
    'db.t3.small': 0.034,
    'db.t3.medium': 0.068,
    'db.t3.large': 0.136,
    'db.t3.xlarge': 0.272,
    'db.t3.2xlarge': 0.544,
    'db.t4g.micro': 0.016,
    'db.t4g.small': 0.032,
    'db.t4g.medium': 0.065,
    'db.t4g.large': 0.129,
    'db.m5.large': 0.171,
    'db.m5.xlarge': 0.342,
    'db.m5.2xlarge': 0.684,
    'db.m5.4xlarge': 1.368,
    'db.m6i.large': 0.171,
    'db.m6i.xlarge': 0.342,
    'db.m6g.large': 0.154,
    'db.m6g.xlarge': 0.308,
    'db.r5.large': 0.24,
    'db.r5.xlarge': 0.48,
    'db.r5.2xlarge': 0.96,
    'db.r6i.large': 0.24,
    'db.r6g.large': 0.216,
    'db.r6g.xlarge': 0.432,
    // Aurora
    'db.serverless': 0.06, // per ACU-hour
  },
  lambda: {
    requestPrice: 0.20, // per million requests
    durationPrice: 0.0000166667, // per GB-second
    freeRequests: 1000000,
    freeDuration: 400000, // GB-seconds
  },
  s3: {
    storage: 0.023, // per GB/month (Standard)
    requests: 0.0004, // per 1000 PUT/POST requests
  },
  dynamodb: {
    writeCapacityUnit: 0.00065 * 730, // ~$0.47/WCU/month
    readCapacityUnit: 0.00013 * 730, // ~$0.095/RCU/month
    storagePerGB: 0.25,
    onDemandWrite: 1.25, // per million writes
    onDemandRead: 0.25, // per million reads
  },
  elasticache: {
    'cache.t3.micro': 0.017,
    'cache.t3.small': 0.034,
    'cache.t3.medium': 0.068,
    'cache.t4g.micro': 0.016,
    'cache.t4g.small': 0.032,
    'cache.t4g.medium': 0.065,
    'cache.m5.large': 0.155,
    'cache.m5.xlarge': 0.31,
    'cache.m6g.large': 0.14,
    'cache.r5.large': 0.218,
    'cache.r6g.large': 0.196,
  },
  sns: {
    requestsPerMillion: 0.50,
    smsPerMessage: 0.00645, // varies by destination
  },
  sqs: {
    requestsPerMillion: 0.40, // Standard queue
  },
  apiGateway: {
    restApiPerMillion: 3.50,
    httpApiPerMillion: 1.00,
    websocketPerMillion: 1.00,
  },
  cloudwatch: {
    metricsPerMonth: 0.30, // per metric
    logsIngestionPerGB: 0.50,
    logsStoragePerGB: 0.03,
    dashboardsPerMonth: 3.00,
    alarmsPerMonth: 0.10, // standard
  },
  ecs: {
    fargateVCPUPerHour: 0.04048,
    fargateMemoryPerGBHour: 0.004445,
  },
  eks: {
    clusterPerHour: 0.10, // $72/month
  },
  nat: {
    gatewayPerHour: 0.045,
    dataProcessedPerGB: 0.045,
  },
  alb: {
    perHour: 0.0225,
    lcuPerHour: 0.008,
  },
  nlb: {
    perHour: 0.0225,
    lcuPerHour: 0.006,
  },
  elasticIP: {
    perHour: 0.005, // when not attached or additional
    dataTransferPerGB: 0.00,
  },
  secretsManager: {
    perSecretPerMonth: 0.40,
    perAPICallPer10k: 0.05,
  },
  kms: {
    perKeyPerMonth: 1.00, // customer managed
    perRequestPer10k: 0.03,
  },
  stepFunctions: {
    standardTransitionsPerMillion: 25.00,
    expressPerMillion: 1.00,
  },
  eventBridge: {
    customEventsPerMillion: 1.00,
    archivePerGB: 0.023,
  },
  cognito: {
    mauFreeLimit: 50000,
    perMAUAboveFree: 0.0055,
  },
  route53: {
    hostedZonePerMonth: 0.50,
    queriesPerMillion: 0.40,
  },
};

// Regional pricing multipliers (relative to us-east-1)
const REGIONAL_MULTIPLIERS: Record<string, number> = {
  'us-east-1': 1.0,
  'us-east-2': 1.0,
  'us-west-1': 1.1,
  'us-west-2': 1.0,
  'eu-west-1': 1.05,
  'eu-west-2': 1.08,
  'eu-west-3': 1.1,
  'eu-central-1': 1.08,
  'eu-north-1': 1.05,
  'ap-southeast-1': 1.1,
  'ap-southeast-2': 1.15,
  'ap-northeast-1': 1.15,
  'ap-northeast-2': 1.12,
  'ap-south-1': 1.05,
  'ca-central-1': 1.05,
  'sa-east-1': 1.5,
};

export function getRegionalPricing(region: string): RegionalPricing {
  const multiplier = REGIONAL_MULTIPLIERS[region] || 1.1; // default to 10% higher
  
  if (region === 'us-east-1') {
    return US_EAST_1_PRICING;
  }
  
  // Apply regional multiplier to all prices
  return applyMultiplier(US_EAST_1_PRICING, multiplier);
}

function applyMultiplier(pricing: RegionalPricing, multiplier: number): RegionalPricing {
  const result: RegionalPricing = JSON.parse(JSON.stringify(pricing));
  
  // Apply to all numeric values recursively
  const applyToObject = (obj: Record<string, unknown>): void => {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === 'number') {
        obj[key] = value * multiplier;
      } else if (typeof value === 'object' && value !== null) {
        applyToObject(value as Record<string, unknown>);
      }
    }
  };
  
  applyToObject(result as unknown as Record<string, unknown>);
  return result;
}

export const HOURS_PER_MONTH = 730; // Average hours in a month
export const DEFAULT_REGION = 'us-east-1';

// Resource types that are always free or have no direct cost
export const FREE_RESOURCES = new Set([
  'AWS::CloudFormation::Stack',
  'AWS::CloudFormation::WaitCondition',
  'AWS::CloudFormation::WaitConditionHandle',
  'AWS::CloudFormation::CustomResource',
  'AWS::CloudFormation::Macro',
  'Custom::*',
  'AWS::IAM::Role',
  'AWS::IAM::Policy',
  'AWS::IAM::ManagedPolicy',
  'AWS::IAM::InstanceProfile',
  'AWS::IAM::User',
  'AWS::IAM::Group',
  'AWS::IAM::AccessKey',
  'AWS::IAM::ServiceLinkedRole',
  'AWS::EC2::SecurityGroup',
  'AWS::EC2::SecurityGroupIngress',
  'AWS::EC2::SecurityGroupEgress',
  'AWS::EC2::RouteTable',
  'AWS::EC2::Route',
  'AWS::EC2::SubnetRouteTableAssociation',
  'AWS::EC2::NetworkAclEntry',
  'AWS::EC2::VPCGatewayAttachment',
  'AWS::EC2::InternetGateway',
  'AWS::Lambda::Permission',
  'AWS::Lambda::EventSourceMapping',
  'AWS::Lambda::Alias',
  'AWS::Lambda::Version',
  'AWS::Lambda::LayerVersion',
  'AWS::Lambda::LayerVersionPermission',
  'AWS::Logs::LogGroup', // First 5GB free, then charged
  'AWS::Logs::LogStream',
  'AWS::Logs::SubscriptionFilter',
  'AWS::SNS::Topic', // Charges based on usage
  'AWS::SNS::Subscription',
  'AWS::SQS::QueuePolicy',
  'AWS::Events::Rule',
  'AWS::Events::EventBus',
  'AWS::ApplicationAutoScaling::ScalableTarget',
  'AWS::ApplicationAutoScaling::ScalingPolicy',
  'AWS::AutoScaling::LaunchConfiguration',
  'AWS::AutoScaling::ScalingPolicy',
  'AWS::AutoScaling::LifecycleHook',
  'AWS::SSM::Parameter',
  'AWS::CDK::Metadata',
]);

// Resources that have costs but are difficult to estimate without usage data
export const USAGE_BASED_RESOURCES = new Set([
  'AWS::Lambda::Function',
  'AWS::DynamoDB::Table',
  'AWS::S3::Bucket',
  'AWS::SNS::Topic',
  'AWS::SQS::Queue',
  'AWS::ApiGateway::RestApi',
  'AWS::ApiGatewayV2::Api',
  'AWS::StepFunctions::StateMachine',
  'AWS::Kinesis::Stream',
  'AWS::Firehose::DeliveryStream',
]);

