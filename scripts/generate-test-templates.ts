
import * as fs from 'fs';
import * as path from 'path';
import { FREE_RESOURCES, USAGE_BASED_RESOURCES } from '../src/pricing-data';

const EXAMPLES_DIR = path.join(__dirname, '../examples');

// Ensure examples directory exists
if (!fs.existsSync(EXAMPLES_DIR)) {
  fs.mkdirSync(EXAMPLES_DIR);
}

function generateTemplate(resources: Set<string>, filename: string, description: string) {
  const templateObj: any = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: description,
    Resources: {}
  };

  let counter = 1;
  for (const resourceType of resources) {
    // Clean up resource type for logical ID (remove AWS::, ::, etc)
    const logicalId = resourceType
      .replace(/AWS::/g, '')
      .replace(/::/g, '')
      .replace(/[^a-zA-Z0-9]/g, '') + counter++;
    
    templateObj.Resources[logicalId] = {
      Type: resourceType,
      Properties: {} // Minimal properties
    };
  }

  const yamlContent = JSON.stringify(templateObj, null, 2); // Using JSON for simplicity as it's valid CloudFormation
  // But user might prefer YAML. Let's stick to JSON for now as the tool supports both, or I can try to format as YAML if needed.
  // The tool uses 'yaml' package which parses both.
  
  fs.writeFileSync(path.join(EXAMPLES_DIR, filename), yamlContent);
  console.log(`Generated ${filename} with ${resources.size} resources.`);
}

// Generate Free Resources Template
generateTemplate(FREE_RESOURCES, 'free-resources.json', 'Template containing all free resources');

// Generate Usage Based Resources Template
generateTemplate(USAGE_BASED_RESOURCES, 'usage-based-resources.json', 'Template containing all usage-based resources');

// Generate Paid Resources Template (EC2, RDS, etc.)
const paidResourcesObj = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Template containing paid resources (EC2, RDS, etc.)',
  Resources: {
    MyEC2Instance: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: 'm5.large',
        ImageId: 'ami-12345678'
      }
    },
    MyRDSInstance: {
      Type: 'AWS::RDS::DBInstance',
      Properties: {
        DBInstanceClass: 'db.m5.large',
        Engine: 'mysql',
        AllocatedStorage: 20
      }
    },
    MyElastiCache: {
      Type: 'AWS::ElastiCache::CacheCluster',
      Properties: {
        CacheNodeType: 'cache.m5.large',
        Engine: 'redis',
        NumCacheNodes: 1
      }
    },
    MyNatGateway: {
        Type: 'AWS::EC2::NatGateway',
        Properties: {
            AllocationId: 'eip-12345',
            SubnetId: 'subnet-12345'
        }
    }
  }
};
fs.writeFileSync(path.join(EXAMPLES_DIR, 'paid-resources.json'), JSON.stringify(paidResourcesObj, null, 2));
console.log('Generated paid-resources.json');

// Generate Empty Template
const emptyTemplate = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Empty template for comparison',
  Resources: {}
};
fs.writeFileSync(path.join(EXAMPLES_DIR, 'empty.json'), JSON.stringify(emptyTemplate, null, 2));
console.log('Generated empty.json');

