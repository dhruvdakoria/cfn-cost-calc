# cfn-cost-estimate

> 💰 CloudFormation/CDK cost estimation tool - Compare deployed vs synthesized stack costs

A robust solution to estimate AWS infrastructure costs from CloudFormation templates, similar to how [Infracost](https://www.infracost.io/) works for Terraform. Since Infracost doesn't support CloudFormation JSON, this tool provides a custom solution specifically designed for CDK/CloudFormation workflows.

## Features

- **Compare Deployed vs Synthesized**: Automatically fetches currently deployed stack templates from AWS and compares with your new CDK synthesized templates
- **Beautiful Output**: Tabular format with color-coded cost differences, perfect for CI/CD pipelines
- **GitHub Integration**: Ready-to-use GitHub Actions workflow that posts cost estimates as PR comments
- **Multiple Output Formats**: Table (CLI), JSON, Markdown, and GitHub-optimized formats
- **Comprehensive AWS Service Coverage**: Supports pricing for 30+ AWS resource types
- **Regional Pricing**: Accurate pricing adjustments based on AWS region
- **Usage Estimates**: Provides cost estimates for usage-based services (Lambda, DynamoDB, S3, etc.)

## Installation

```bash
# Install globally
npm install -g cfn-cost-estimate

# Or install locally in your CDK project
npm install --save-dev cfn-cost-estimate
```

## Pricing Data

This tool uses the [Infracost Cloud Pricing API](https://www.infracost.io/docs/supported_resources/cloud_pricing_api/) to fetch accurate, up-to-date AWS pricing data. The pricing data is stored in `data/aws-pricing.json` and supports:

- **us-east-1** (US East - N. Virginia)
- **ca-central-1** (Canada - Central)

### Updating Pricing Data

To update the pricing data with the latest prices from Infracost:

```bash
# First, configure your Infracost API key
infracost configure set api_key YOUR_API_KEY

# Then run the update script
npm run update-pricing
```

The script fetches pricing for:
- 180+ EC2 instance types
- All EBS volume types with IOPS and throughput pricing
- 170+ RDS instance types across 5 database engines
- 28+ ElastiCache node types
- 22+ OpenSearch instance types
- 11+ DocumentDB instance types
- Lambda, Fargate, NAT Gateway, Load Balancers, EKS, and more

## Quick Start

### Basic Usage

```bash
# Synthesize your CDK app first
cdk synth

# Compare with deployed stacks
cfn-cost compare

# Estimate costs for new templates only (no AWS credentials needed)
cfn-cost compare --no-deployed

# Estimate a single template file
cfn-cost estimate path/to/template.json

# Compare two template files
cfn-cost diff before.json after.json
```

### CLI Commands

#### `compare` - Compare CDK stacks with deployed versions

```bash
cfn-cost compare [options]

Options:
  -d, --cdk-out <dir>       CDK output directory (default: "cdk.out")
  -s, --stacks <stacks...>  Specific stack names to compare
  -r, --region <region>     AWS region (default: "us-east-1")
  -p, --profile <profile>   AWS profile to use
  -f, --format <format>     Output format: table, json, markdown, github
  -o, --output <file>       Write output to file
  --no-deployed             Skip comparing with deployed stacks
  -v, --verbose             Verbose output
```

#### `estimate` - Estimate costs for a single template

```bash
cfn-cost estimate <template> [options]

Arguments:
  template                  Path to CloudFormation template (JSON or YAML)

Options:
  -n, --stack-name <name>   Stack name for the estimate
  -r, --region <region>     AWS region (default: "us-east-1")
  -f, --format <format>     Output format: table, json, markdown
  -o, --output <file>       Write output to file
```

#### `diff` - Compare two template files

```bash
cfn-cost diff <before> <after> [options]

Arguments:
  before                    Path to the before template file
  after                     Path to the after template file

Options:
  -n, --stack-name <name>   Stack name for the comparison
  -r, --region <region>     AWS region (default: "us-east-1")
  -f, --format <format>     Output format: table, json, markdown, github
  -o, --output <file>       Write output to file
```

#### `github-comment` - Generate PR comment

```bash
cfn-cost github-comment [options]

Options:
  -d, --cdk-out <dir>       CDK output directory (default: "cdk.out")
  -s, --stacks <stacks...>  Specific stack names to compare
  -r, --region <region>     AWS region (default: "us-east-1")
  -p, --profile <profile>   AWS profile to use
  -o, --output <file>       Write comment to file
```

#### `list-stacks` - List available stacks

```bash
cfn-cost list-stacks [options]

Options:
  -d, --cdk-out <dir>       CDK output directory
  --deployed                List deployed stacks from AWS
  -r, --region <region>     AWS region
  -p, --profile <profile>   AWS profile to use
```

## Example Output

### CLI Table Output

```
📦 Stack: MyAppStack
   deployed → synthesized

   +  DatabaseInstance    RDS/DBInstance          -      $125.56    +$125.56
   ~  WebServerASG        AutoScaling/AutoSca...  $70.08  $140.16   +$70.08
   -  OldCacheCluster     ElastiCache/CacheClu... $49.64  -         -$49.64

   📊 Changes: +1 added, -1 removed, ~1 modified
   💰 Monthly: $119.72 → $265.72 (+$146.00, +121.9%)
```

### GitHub PR Comment

The tool generates beautiful PR comments with:

- Overall cost impact summary
- Per-stack breakdowns
- Resource-level changes with cost differences
- Collapsible details for large changes
- Annual cost projections

## GitHub Actions Integration

### Basic Setup

Add this workflow to your CDK repository (`.github/workflows/cdk-cost.yml`):

```yaml
name: CDK Cost Estimate

on:
  pull_request:
    branches: [main]
    paths:
      - 'lib/**'
      - 'bin/**'
      - 'cdk.json'

permissions:
  contents: read
  pull-requests: write
  id-token: write

jobs:
  cost-estimate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - run: npx cdk synth --quiet

      - run: npx cfn-cost github-comment -o comment.md

      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const comment = fs.readFileSync('comment.md', 'utf8');
            
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            
            const existing = comments.find(c => 
              c.user.type === 'Bot' && 
              c.body.includes('CloudFormation Cost Estimate')
            );
            
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body: comment,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: comment,
              });
            }
```

## Supported AWS Resources

Pricing data is fetched from the [Infracost Cloud Pricing API](https://www.infracost.io/docs/supported_resources/cloud_pricing_api/), which provides accurate, real-time AWS pricing for all major AWS services.

### High Confidence Pricing (Fixed Costs)

| Resource Type | Pricing Components |
|--------------|-------------------|
| **Compute** ||
| `AWS::EC2::Instance` | 180+ instance types with hourly rates |
| `AWS::EC2::Volume` | All EBS types (gp2, gp3, io1, io2, st1, sc1) with IOPS/throughput |
| `AWS::EC2::Snapshot` | Snapshot storage |
| `AWS::AutoScaling::AutoScalingGroup` | Based on instance count and type |
| `AWS::Lightsail::Instance` | Bundle pricing |
| **Containers** ||
| `AWS::EKS::Cluster` | Cluster hourly rate |
| `AWS::ECS::Service` | Fargate vCPU + memory |
| **Databases** ||
| `AWS::RDS::DBInstance` | 170+ instance types across MySQL, PostgreSQL, MariaDB |
| `AWS::RDS::DBCluster` | Aurora Serverless ACUs |
| `AWS::ElastiCache::CacheCluster` | 28+ node types |
| `AWS::ElastiCache::ReplicationGroup` | Node type, node groups, replicas |
| `AWS::OpenSearchService::Domain` | 22+ instance types |
| `AWS::Elasticsearch::Domain` | Legacy Elasticsearch instances |
| `AWS::DocDB::DBCluster` / `AWS::DocDB::DBInstance` | DocumentDB instances + storage |
| `AWS::Neptune::DBCluster` / `AWS::Neptune::DBInstance` | Neptune instances + storage |
| `AWS::Redshift::Cluster` | Redshift node types |
| **Networking** ||
| `AWS::EC2::NatGateway` | Hourly + data processing |
| `AWS::ElasticLoadBalancingV2::LoadBalancer` | ALB/NLB hourly + LCU |
| `AWS::ElasticLoadBalancing::LoadBalancer` | Classic ELB hourly |
| `AWS::EC2::VPCEndpoint` | Interface endpoints per AZ |
| `AWS::EC2::VPNConnection` | VPN connection hourly |
| `AWS::EC2::TransitGateway` | Transit gateway hourly + attachments |
| `AWS::DirectConnect::Connection` | Port hours by bandwidth |
| `AWS::GlobalAccelerator::Accelerator` | Accelerator hourly |
| `AWS::NetworkFirewall::Firewall` | Endpoints + data processing |
| **Messaging & Streaming** ||
| `AWS::Kinesis::Stream` | Shard hours |
| `AWS::KinesisFirehose::DeliveryStream` | Data ingested |
| `AWS::MSK::Cluster` | Kafka broker instances |
| `AWS::AmazonMQ::Broker` | MQ broker instances |
| **Security & Management** ||
| `AWS::SecretsManager::Secret` | Per secret per month |
| `AWS::KMS::Key` | Per key per month |
| `AWS::WAFv2::WebACL` / `AWS::WAF::WebACL` | Web ACL + rules + requests |
| `AWS::Config::ConfigRule` | Config rules |
| `AWS::CloudTrail::Trail` | Data events |
| `AWS::CloudWatch::Alarm` | Per alarm (standard/high-res) |
| `AWS::CloudWatch::Dashboard` | Per dashboard |
| **Storage** ||
| `AWS::EFS::FileSystem` | Standard + IA storage, provisioned throughput |
| `AWS::FSx::FileSystem` | Lustre, Windows, ONTAP, OpenZFS |
| `AWS::Backup::BackupVault` | Backup storage |
| **Developer Tools** ||
| `AWS::CodeBuild::Project` | Build minutes by compute type |
| `AWS::CodePipeline::Pipeline` | Active pipeline |
| `AWS::Glue::Job` / `AWS::Glue::Crawler` | DPU hours |
| **Migration** ||
| `AWS::DMS::ReplicationInstance` | DMS instance types |
| `AWS::Transfer::Server` | Transfer Family protocols |
| **Other** ||
| `AWS::Route53::HostedZone` | Per hosted zone |
| `AWS::ACMPCA::CertificateAuthority` | Private CA |
| `AWS::SageMaker::NotebookInstance` | Notebook instance types |
| `AWS::Grafana::Workspace` | Managed Grafana users |

### Usage-Based Estimates (Lower Confidence)

| Resource Type | Estimation Basis |
|--------------|-----------------|
| `AWS::Lambda::Function` | 100K invocations/month estimate |
| `AWS::DynamoDB::Table` | Provisioned RCU/WCU or on-demand estimates |
| `AWS::S3::Bucket` | 100GB storage estimate |
| `AWS::SQS::Queue` | 1M requests/month (Standard/FIFO) |
| `AWS::ApiGateway::RestApi` | 1M requests/month (REST API) |
| `AWS::ApiGatewayV2::Api` | 1M requests/month (HTTP API) |
| `AWS::StepFunctions::StateMachine` | 10K executions/month (Standard/Express) |
| `AWS::CloudFront::Distribution` | 100GB transfer, 1M requests estimate |

### Free Resources (Not Priced)

Based on the [Infracost free resources documentation](https://www.infracost.io/docs/supported_resources/aws/), over 200+ resource types are recognized as free/configuration-only:

- **IAM**: Roles, policies, users, groups, instance profiles
- **VPC**: Security groups, route tables, subnets, VPCs, internet gateways
- **Lambda**: Permissions, event source mappings, aliases, versions, layers
- **Logs**: Log groups, streams, subscription filters
- **Events**: Rules, event buses, archives
- **Auto Scaling**: Scaling policies, targets, lifecycle hooks
- **API Gateway**: REST APIs, routes, stages, authorizers (requests have cost)
- **ECS/EKS**: Clusters, task definitions, capacity providers
- **RDS/ElastiCache**: Subnet groups, parameter groups
- **CloudFormation**: Stacks, custom resources, macros
- **And many more...**

## Programmatic Usage

```typescript
import { 
  compareCdkStacks, 
  generateGitHubComment,
  CostCalculator,
  TemplateFetcher 
} from 'cfn-cost-estimate';

// Compare CDK stacks
const comparisons = await compareCdkStacks({
  cdkOutDir: 'cdk.out',
  region: 'us-east-1',
});

// Generate GitHub comment
const comment = generateGitHubComment(comparisons);

// Or use individual components
const fetcher = new TemplateFetcher('us-east-1');
const template = await fetcher.fetchDeployedTemplate('MyStack');

const calculator = new CostCalculator('us-east-1');
const estimate = calculator.calculateStackCost('MyStack', template.template, 'deployed');

console.log(`Monthly cost: $${estimate.totalMonthlyCost.toFixed(2)}`);
```

## Configuration

### AWS Credentials

The tool uses the AWS SDK and supports all standard credential providers:

- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- Shared credentials file (`~/.aws/credentials`)
- IAM roles (when running on EC2/ECS/Lambda)
- OIDC authentication (recommended for GitHub Actions)

### Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:GetTemplate",
        "cloudformation:DescribeStacks",
        "cloudformation:ListStacks"
      ],
      "Resource": "*"
    }
  ]
}
```

## Limitations

- **Usage-based costs are estimates**: Actual costs for Lambda, S3, DynamoDB, etc. depend on actual usage patterns
- **Pricing data is approximate**: Prices are based on public AWS pricing and may not reflect discounts, reserved instances, or savings plans
- **Some resources not supported**: Very new or uncommon AWS resources may not have pricing calculators
- **Regional variations**: While regional multipliers are applied, actual regional pricing may vary

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

### Adding New Resource Pricing

1. Add pricing data to `src/pricing-data.ts`
2. Add a calculator function to `src/cost-calculator.ts`
3. Register the calculator in `initializeCalculators()`

## License

MIT

