#!/bin/bash
# CDK Cost Check Script
# Run this script in your CDK project directory after making changes
# 
# Usage: ./cdk-cost-check.sh [options]
#
# Options:
#   --region <region>    AWS region (default: us-east-1)
#   --profile <profile>  AWS profile to use
#   --format <format>    Output format: table, json, markdown, github
#   --stacks <stacks>    Comma-separated list of stack names

set -e

# Default values
REGION="${AWS_REGION:-us-east-1}"
FORMAT="table"
CDK_OUT="cdk.out"
PROFILE=""
STACKS=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --region)
      REGION="$2"
      shift 2
      ;;
    --profile)
      PROFILE="--profile $2"
      shift 2
      ;;
    --format)
      FORMAT="$2"
      shift 2
      ;;
    --stacks)
      STACKS="--stacks $2"
      shift 2
      ;;
    --cdk-out)
      CDK_OUT="$2"
      shift 2
      ;;
    -h|--help)
      echo "CDK Cost Check Script"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --region <region>    AWS region (default: us-east-1)"
      echo "  --profile <profile>  AWS profile to use"
      echo "  --format <format>    Output format: table, json, markdown, github"
      echo "  --stacks <stacks>    Comma-separated list of stack names"
      echo "  --cdk-out <dir>      CDK output directory (default: cdk.out)"
      echo "  -h, --help           Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 CDK Cost Check${NC}"
echo ""

# Check if we're in a CDK project
if [ ! -f "cdk.json" ]; then
  echo -e "${RED}Error: Not in a CDK project directory (cdk.json not found)${NC}"
  exit 1
fi

# Check if cfn-cost is installed
if ! command -v cfn-cost &> /dev/null; then
  if [ -f "node_modules/.bin/cfn-cost" ]; then
    CFN_COST="npx cfn-cost"
  else
    echo -e "${YELLOW}Warning: cfn-cost not found. Installing...${NC}"
    npm install --save-dev cfn-cost-estimate
    CFN_COST="npx cfn-cost"
  fi
else
  CFN_COST="cfn-cost"
fi

# Step 1: Synthesize CDK
echo -e "${BLUE}📦 Synthesizing CDK stacks...${NC}"
cdk synth --quiet $PROFILE

if [ ! -d "$CDK_OUT" ]; then
  echo -e "${RED}Error: CDK output directory not found: $CDK_OUT${NC}"
  exit 1
fi

# Step 2: List discovered stacks
echo -e "${BLUE}📋 Discovered stacks:${NC}"
$CFN_COST list-stacks --cdk-out "$CDK_OUT"
echo ""

# Step 3: Run cost comparison
echo -e "${BLUE}💰 Running cost comparison...${NC}"
echo ""

$CFN_COST compare \
  --cdk-out "$CDK_OUT" \
  --region "$REGION" \
  --format "$FORMAT" \
  $PROFILE \
  $STACKS

echo ""
echo -e "${GREEN}✅ Cost check complete${NC}"

