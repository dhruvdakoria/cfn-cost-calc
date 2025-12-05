## 📦 Stack: complex-test-v2

| | Before | After | Difference |
|---|---:|---:|---:|
| **Monthly Cost** | $77.60 | $106.43 | +$28.82 (+37.1%) |

### Resource Changes

| | Resource | Type | Before | After | Diff |
|---|----------|------|-------:|------:|-----:|
| 🟡 | MyEC2Instance | EC2/Instance | $30.37 | $60.74 | +$30.37 |
| 🟡 | MyDynamoDBTable | DynamoDB/Table | $2.50 <br>_(est. 1.0M writes)_ | $0.00 <br>_(est. 10 RCU)_ | $-2.50 |
| 🟢 | MyNewLambdaFunction | Lambda/Function | - | $1.35 <br>_(est. 500.0k GB-seconds)_ | +$1.35 |
| 🔴 | MySQSQueue | SQS/Queue | $0.40 <br>_(est. 1.0M requests)_ | - | $-0.40 |

### Summary
- ➕ Added: 1 resources (+$1.35)
- ➖ Removed: 1 resources (-$0.40)
- 🔄 Modified: 2 resources (+$27.87)