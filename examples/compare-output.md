## 📦 Stack: ComplexStack
> Source: synthesized

| Resource | Monthly Qty | Unit | Monthly Cost |
|----------|------------:|------|-------------:|
| **MyNatGateway** | | | **$37.35** |
| &nbsp;&nbsp; └─ NAT Gateway Hourly | 730 | hours | $32.85 |
| &nbsp;&nbsp; └─ Data Processing (est. 100GB) | 100 | GB | $4.50 |
| **MyEC2Instance** | | | **$30.37** |
| &nbsp;&nbsp; └─ EC2 t3.medium | 1 | hour | $30.37 |
| **MyLambdaFunction** | | | **$4.69** |
| &nbsp;&nbsp; └─ Lambda Requests (est. 100,000/mo) | 100.0k | requests | $0.02 |
| &nbsp;&nbsp; └─ Lambda Compute (512MB, 15000ms avg) | 750.0k | GB-seconds | $4.67 |
| **MyDynamoDBTable** | | | **$2.50** |
| &nbsp;&nbsp; └─ DynamoDB On-Demand Writes (est. 1M/mo) | 1.0M | writes | $1.25 |
| &nbsp;&nbsp; └─ DynamoDB On-Demand Reads (est. 5M/mo) | 5.0M | reads | $1.25 |
| **MyS3Bucket** | | | **$2.30** |
| &nbsp;&nbsp; └─ S3 Storage (est. 100GB) | 100 | GB/month | $2.30 |
| **MySQSQueue** | | | **$0.40** |
| &nbsp;&nbsp; └─ SQS Standard Requests (est. 1M/mo) | 1.0M | requests | $0.40 |

**💰 Total Monthly Cost: $77.60**
📅 Estimated Annual: $931.26