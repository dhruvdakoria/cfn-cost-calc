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

### High Confidence Pricing (Fixed Costs)

| Resource Type | Pricing Components |
|--------------|-------------------|
| `AWS::EC2::Instance` | Instance type hourly rate |
| `AWS::EC2::Volume` | Storage type, size, IOPS |
| `AWS::RDS::DBInstance` | Instance class, storage, Multi-AZ |
| `AWS::RDS::DBCluster` | Aurora Serverless ACUs |
| `AWS::ElastiCache::CacheCluster` | Node type, count |
| `AWS::ElastiCache::ReplicationGroup` | Node type, node groups, replicas |
| `AWS::EC2::NatGateway` | Hourly + data processing |
| `AWS::ElasticLoadBalancingV2::LoadBalancer` | ALB/NLB hourly + LCU |
| `AWS::EKS::Cluster` | Cluster hourly rate |
| `AWS::SecretsManager::Secret` | Per secret per month |
| `AWS::KMS::Key` | Per key per month |
| `AWS::Route53::HostedZone` | Per hosted zone |
| `AWS::CloudWatch::Alarm` | Per alarm |
| `AWS::CloudWatch::Dashboard` | Per dashboard |
| `AWS::EC2::VPCEndpoint` | Interface endpoints per AZ |

### Usage-Based Estimates (Lower Confidence)

| Resource Type | Estimation Basis |
|--------------|-----------------|
| `AWS::Lambda::Function` | 100K invocations/month estimate |
| `AWS::DynamoDB::Table` | Provisioned capacity or on-demand estimates |
| `AWS::S3::Bucket` | 100GB storage estimate |
| `AWS::SQS::Queue` | 1M requests/month estimate |
| `AWS::ApiGateway::RestApi` | 1M requests/month estimate |
| `AWS::ApiGatewayV2::Api` | 1M requests/month estimate |
| `AWS::StepFunctions::StateMachine` | 10K executions/month estimate |

### Free Resources (Not Priced)

IAM resources, security groups, route tables, Lambda permissions, event rules, and other configuration-only resources are excluded from cost calculations.

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

