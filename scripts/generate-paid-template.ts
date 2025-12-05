
import * as fs from 'fs';
import * as path from 'path';

const EXAMPLES_DIR = path.join(__dirname, '../examples');

// Ensure examples directory exists
if (!fs.existsSync(EXAMPLES_DIR)) {
  fs.mkdirSync(EXAMPLES_DIR);
}

const paidResources = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Template containing paid resources (EC2, RDS, etc)',
  Resources: {
    MyEC2Instance: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: 'm5.large',
        ImageId: 'ami-12345678', // Dummy AMI
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/sda1',
            Ebs: {
              VolumeSize: 100,
              VolumeType: 'gp3'
            }
          }
        ]
      }
    },
    MyRDSInstance: {
      Type: 'AWS::RDS::DBInstance',
      Properties: {
        DBInstanceClass: 'db.m5.large',
        Engine: 'MySQL',
        AllocatedStorage: 100,
        StorageType: 'gp3',
        MultiAZ: false
      }
    },
    MyNatGateway: {
      Type: 'AWS::EC2::NatGateway',
      Properties: {
        AllocationId: 'eip-12345',
        SubnetId: 'subnet-12345'
      }
    },
    MyLoadBalancer: {
      Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
      Properties: {
        Type: 'application',
        Subnets: ['subnet-1', 'subnet-2']
      }
    },
    MyEFSFileSystem: {
      Type: 'AWS::EFS::FileSystem',
      Properties: {
        PerformanceMode: 'generalPurpose',
        ThroughputMode: 'bursting'
      }
    },
    MyRedshiftCluster: {
        Type: 'AWS::Redshift::Cluster',
        Properties: {
            NodeType: 'dc2.large',
            NumberOfNodes: 2
        }
    }
  }
};

fs.writeFileSync(path.join(EXAMPLES_DIR, 'paid-resources.json'), JSON.stringify(paidResources, null, 2));
console.log('Generated paid-resources.json');
