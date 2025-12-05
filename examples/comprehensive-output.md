## 📦 Stack: ComprehensiveStack
> Source: synthesized

| Resource | Monthly Qty | Unit | Monthly Cost |
|----------|------------:|------|-------------:|
| **MyPaidRDSInstance** | | | **$122.28** |
| &nbsp;&nbsp; └─ RDS db.t3.medium (Multi-AZ) | 2 | instance/month | $99.28 |
| &nbsp;&nbsp; └─ Storage (gp3) | 50 | GB/month | $23.00 |
| **MyPaidALB** | | | **$62.05** |
| &nbsp;&nbsp; └─ ALB Hourly | 730 | hours | $3.65 |
| &nbsp;&nbsp; └─ LCU (est. 10 avg) | 7.3k | LCU-hours | $58.40 |
| **MyPaidNLB** | | | **$60.22** |
| &nbsp;&nbsp; └─ NLB Hourly | 730 | hours | $16.43 |
| &nbsp;&nbsp; └─ LCU (est. 10 avg) | 7.3k | LCU-hours | $43.80 |
| **MyUsageLambdaFunction** | | | **$34.69** |
| &nbsp;&nbsp; └─ Lambda Requests (est. 100,000/mo) | 100.0k | requests | $0.02 |
| &nbsp;&nbsp; └─ Lambda Compute (1024MB, 30000ms avg) | 3.0M | GB-seconds | $34.67 |
| **MyUsageApiGateway** | | | **$3.50** |
| &nbsp;&nbsp; └─ REST API Requests (est. 1M/mo) | 1.0M | requests | $3.50 |
| **MyUsageDynamoDBTable** | | | **$2.50** |
| &nbsp;&nbsp; └─ DynamoDB On-Demand Writes (est. 1M/mo) | 1.0M | writes | $1.25 |
| &nbsp;&nbsp; └─ DynamoDB On-Demand Reads (est. 5M/mo) | 5.0M | reads | $1.25 |
| **MyPaidS3Bucket** | | | **$2.30** |
| &nbsp;&nbsp; └─ S3 Storage (est. 100GB) | 100 | GB/month | $2.30 |
| **MyPaidKMSKey** | | | **$1.00** |
| &nbsp;&nbsp; └─ KMS Customer Managed Key | 1 | key/month | $1.00 |
| **MyPaidSecret** | | | **$0.40** |
| &nbsp;&nbsp; └─ Secrets Manager Secret | 1 | secret/month | $0.40 |
| **MyPaidCloudWatchAlarm** | | | **$0.10** |
| &nbsp;&nbsp; └─ CloudWatch Alarm | 1 | alarm/month | $0.10 |
| **MyFreeSSMParameter** | | | **$0.05** |
| &nbsp;&nbsp; └─ API Calls (est. 10k/mo) | 10.0k | calls | $0.05 |
| **MyFreeIamRole** | | | **$0.00** |
| &nbsp;&nbsp; └─ Free Resource | 1 | resource | $0.00 |
| **MyFreeVPCEndpoint** | | | **$0.00** |
| &nbsp;&nbsp; └─ VPC Gateway Endpoint (free) | 1 | endpoint | $0.00 |

**💰 Total Monthly Cost: $289.09**
📅 Estimated Annual: $3469.10