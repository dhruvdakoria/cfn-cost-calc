
import * as fs from 'fs';
import * as path from 'path';

const EXAMPLES_DIR = path.join(__dirname, '../examples');

// Ensure examples directory exists
if (!fs.existsSync(EXAMPLES_DIR)) {
  fs.mkdirSync(EXAMPLES_DIR);
}

const paidResources = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Template containing paid resources with regional pricing differences',
  Resources: {
    // EC2 Instances
    MyEC2InstanceT3Micro: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: 't3.micro',
        ImageId: 'ami-12345678'
      }
    },
    MyEC2InstanceM5Large: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: 'm5.large',
        ImageId: 'ami-12345678'
      }
    },
    // RDS Instance
    MyRDSInstance: {
      Type: 'AWS::RDS::DBInstance',
      Properties: {
        DBInstanceClass: 'db.t3.medium',
        Engine: 'MySQL',
        AllocatedStorage: 20
      }
    },
    // ElastiCache
    MyElastiCache: {
      Type: 'AWS::ElastiCache::CacheCluster',
      Properties: {
        CacheNodeType: 'cache.t3.micro',
        Engine: 'redis',
        NumCacheNodes: 1
      }
    },
    // NAT Gateway
    MyNATGateway: {
      Type: 'AWS::EC2::NatGateway',
      Properties: {
        AllocationId: 'eip-12345',
        SubnetId: 'subnet-12345'
      }
    },
    // Load Balancer (ALB)
    MyALB: {
      Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
      Properties: {
        Type: 'application',
        Subnets: ['subnet-1', 'subnet-2']
      }
    },
    // EBS Volume
    MyEBSVolume: {
      Type: 'AWS::EC2::Volume',
      Properties: {
        Size: 100,
        VolumeType: 'gp3',
        AvailabilityZone: 'us-east-1a'
      }
    }
  }
};

fs.writeFileSync(path.join(EXAMPLES_DIR, 'paid-resources.json'), JSON.stringify(paidResources, null, 2));
console.log('Generated paid-resources.json');

