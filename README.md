# cfn-cost-estimate

> 💰 CloudFormation/CDK cost estimation tool - Compare deployed vs synthesized stack costs

A robust solution to estimate AWS infrastructure costs from CloudFormation templates, similar to how [Infracost](https://www.infracost.io/) works for Terraform. Since Infracost doesn't natively support CloudFormation JSON templates for direct comparison, this tool bridges that gap specifically for CDK/CloudFormation workflows.

## Features

- **Compare Deployed vs Synthesized**: Automatically fetches currently deployed stack templates from AWS and compares them with your new CDK synthesized templates.
- **Beautiful Output**: Tabular format with color-coded cost differences, perfect for CI/CD pipelines.
- **GitHub Integration**: Ready-to-use GitHub Actions workflow that posts cost estimates as PR comments.
- **Multiple Output Formats**: Table (CLI), JSON, Markdown, and GitHub-optimized formats.
- **Comprehensive AWS Service Coverage**: Supports pricing for 30+ AWS resource types including Compute, Database, Storage, Networking, and more.
- **Regional Pricing**: Accurate pricing adjustments based on AWS region (currently supporting `us-east-1` and `ca-central-1`).
- **Usage Estimates**: Provides reasonable default cost estimates for usage-based services (Lambda, DynamoDB, S3, etc.).
- **Free Resource Detection**: Automatically identifies and excludes 200+ free resources from cost calculations.

## Installation

```bash
# Install globally
npm install -g cfn-cost-estimate

# Or install locally in your CDK project
npm install --save-dev cfn-cost-estimate
```

## Prerequisites

### Pricing Data (Infracost API Key)

This tool uses the [Infracost Cloud Pricing API](https://www.infracost.io/docs/supported_resources/cloud_pricing_api/) to fetch accurate, up-to-date AWS pricing data. The data is locally cached in `data/aws-pricing.json`.

To keep pricing data current or to fetch it for the first time, you need an Infracost API key.

1.  **Get API Key**: Download Infracost and run `infracost auth login` to get your free API key.
2.  **Configure**:
    ```bash
    infracost configure set api_key YOUR_API_KEY
    ```
3.  **Update Pricing**:
    ```bash
    npm run update-pricing
    ```

## Usage

### Basic Commands

```bash
# Synthesize your CDK app first
cdk synth

# Compare synthesized stacks with deployed stacks (requires AWS credentials)
cfn-cost compare

# Estimate costs for new templates only (no AWS credentials needed)
cfn-cost compare --no-deployed

# Estimate a single template file
cfn-cost estimate path/to/template.json

# Compare two local template files
cfn-cost diff before.json after.json
```

### CLI Commands Reference

#### `compare`
Compare CDK stacks in `cdk.out` with their deployed counterparts in AWS.

```bash
cfn-cost compare [options]

Options:
  -d, --cdk-out <dir>       CDK output directory (default: "cdk.out")
  -s, --stacks <stacks...>  Specific stack names to compare (default: all)
  -r, --region <region>     AWS region (default: "us-east-1")
  -p, --profile <profile>   AWS profile to use
  -f, --format <format>     Output format: table, json, markdown, github (default: "table")
  -o, --output <file>       Write output to file
  --no-deployed             Skip comparing with deployed stacks (estimates only)
  -v, --verbose             Verbose output
```

#### `estimate`
Estimate monthly costs for a single CloudFormation template.

```bash
cfn-cost estimate <template> [options]

Arguments:
  template                  Path to CloudFormation template (JSON or YAML)

Options:
  -n, --stack-name <name>   Stack name for the estimate display
  -r, --region <region>     AWS region (default: "us-east-1")
  -f, --format <format>     Output format: table, json, markdown
  -o, --output <file>       Write output to file
```

#### `diff`
Compare costs between two local CloudFormation templates (e.g., current git version vs previous version).

```bash
cfn-cost diff <before> <after> [options]

Arguments:
  before                    Path to the "before" template file
  after                     Path to the "after" template file

Options:
  -n, --stack-name <name>   Stack name for the comparison
  -r, --region <region>     AWS region (default: "us-east-1")
  -f, --format <format>     Output format: table, json, markdown, github
  -o, --output <file>       Write output to file
```

#### `list-stacks`
List available stacks in your CDK output or deployed in your AWS account.

```bash
cfn-cost list-stacks [options]

Options:
  -d, --cdk-out <dir>       CDK output directory
  --deployed                List currently deployed stacks from AWS instead of local CDK
  -r, --region <region>     AWS region
  -p, --profile <profile>   AWS profile
```

#### `github-comment`
Generate a formatted Markdown comment suitable for GitHub Pull Requests.

```bash
cfn-cost github-comment [options]

Options:
  -d, --cdk-out <dir>       CDK output directory
  -s, --stacks <stacks...>  Specific stack names to compare
  -r, --region <region>     AWS region
  -p, --profile <profile>   AWS profile
  -o, --output <file>       Write comment to file (default: stdout)
```

## Supported Resources

The tool currently supports cost estimation for a wide range of AWS resources, categorized as follows:

### High Confidence (Fixed Costs)
Resources with predictable hourly or monthly costs.
- **Compute**: EC2 Instances (180+ types), EBS Volumes & Snapshots, Lightsail.
- **Databases**: RDS Instances (MySQL, Postgres, MariaDB, Aurora), ElastiCache (Redis, Memcached), OpenSearch, DocumentDB, Neptune, Redshift.
- **Containers**: EKS Clusters, Fargate (vCPU/Memory).
- **Networking**: NAT Gateways, Load Balancers (ALB/NLB/CLB), VPN, Transit Gateway, Global Accelerator.
- **Storage**: EFS (Standard/IA), FSx.
- **Misc**: KMS Keys, Secrets Manager Secrets, CloudWatch Alarms/Dashboards.

### Usage-Based Estimates
Resources where cost depends heavily on usage (requests, data transfer, etc.). The tool applies industry-standard default estimates (e.g., 1M requests/month) to provide a baseline.
- **Serverless**: Lambda Functions (Requests/Duration), API Gateway (REST/HTTP/WebSocket).
- **Storage/DB**: S3 Buckets (Storage/Requests), DynamoDB (On-Demand/Provisioned).
- **Streaming**: Kinesis Streams, Firehose.
- **Queueing**: SQS, SNS.
- **Others**: CloudFront, Step Functions, Glue Jobs/Crawlers, CodeBuild.

### Free Resources
Automatically detects and reports $0.00 for:
- IAM Resources (Roles, Policies, Users)
- VPC Configuration (Security Groups, Route Tables, Subnets, IGW)
- Auto Scaling Configurations
- CloudWatch Log Groups (Ingestion costs are estimated separately)
- CloudFormation Stacks & Custom Resources
- Tagging & Metadata

## Configuration

### AWS Credentials
The tool uses the standard AWS SDK credential chain. You can configure credentials via:
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)
- Shared credentials file (`~/.aws/credentials`)
- IAM Roles (for EC2/Lambda/CodeBuild)
- SSO / Identity Center

### IAM Permissions
To run `compare` or `list-stacks --deployed`, the following read-only permissions are required:

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

## GitHub Actions Integration

Add this workflow to your CDK repository (`.github/workflows/cost-estimate.yml`) to automatically comment on PRs with cost changes.

```yaml
name: Cost Estimate
on: [pull_request]

permissions:
  contents: read
  pull-requests: write
  id-token: write # for AWS OIDC

jobs:
  estimate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - run: npm ci
      
      # Build your CDK app
      - run: npx cdk synth
      
      # Configure AWS Credentials (optional, for comparison with deployed)
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1
          
      # Generate Cost Comment
      - name: Generate Cost Estimate
        run: |
          npx cfn-cost github-comment --output comment.md
          
      # Post Comment
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const comment = fs.readFileSync('comment.md', 'utf8');
            
            // Find existing bot comment to update, or create new
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const botComment = comments.find(c => c.body.includes('CloudFormation Cost Estimate'));
            
            if (botComment) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: botComment.id,
                body: comment
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: comment
              });
            }
```

## Contributing

Contributions are welcome!

### Adding New Resource Pricing
1.  Update `scripts/fetch-infracost-pricing.ts` to fetch the new resource data from the Infracost API.
2.  Run `npm run update-pricing` to verify the data is captured in `data/aws-pricing.json`.
3.  Update `src/pricing-data.ts` to define the types for the new resource.
4.  Add a calculator function in `src/cost-calculator.ts`.
5.  Register the calculator in `initializeCalculators()`.

## License

MIT
