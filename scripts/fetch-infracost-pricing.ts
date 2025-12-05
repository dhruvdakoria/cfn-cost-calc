#!/usr/bin/env ts-node
/**
 * Fetch AWS Pricing Data from Infracost Cloud Pricing API
 * 
 * Based on: https://www.infracost.io/docs/supported_resources/cloud_pricing_api/
 * 
 * Prerequisites:
 *   infracost configure set api_key YOUR_API_KEY
 * 
 * Usage: npx ts-node scripts/fetch-infracost-pricing.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execSync } from 'child_process';

// Get API key from Infracost CLI config or environment
function getApiKey(): string {
  if (process.env.INFRACOST_API_KEY) {
    return process.env.INFRACOST_API_KEY;
  }
  
  try {
    const key = execSync('infracost configure get api_key', { encoding: 'utf-8' }).trim();
    if (key) return key;
  } catch {
    // CLI not installed or not configured
  }
  
  throw new Error('No API key found. Run: infracost configure set api_key YOUR_KEY');
}

const INFRACOST_API_KEY = getApiKey();
const REGIONS = ['us-east-1', 'ca-central-1'];

interface PriceResult {
  USD: string;
  unit?: string;
  description?: string;
  startUsageAmount?: string;
  endUsageAmount?: string;
}

interface AttributeResult {
  key: string;
  value: string;
}

interface ProductResult {
  attributes?: AttributeResult[];
  prices: PriceResult[];
}

// Helper to convert attributes array to object
function attributesToObject(attrs: AttributeResult[] | undefined): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const attr of attrs || []) {
    obj[attr.key] = attr.value;
  }
  return obj;
}

interface GraphQLResponse {
  data?: {
    products: ProductResult[];
  };
  errors?: Array<{ message: string }>;
}

async function queryPricingAPI(query: string): Promise<GraphQLResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    
    const options = {
      hostname: 'pricing.api.infracost.io',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': INFRACOST_API_KEY,
        'User-Agent': 'cfn-cost-estimate/1.0',
        'Accept': '*/*',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse: ${data.substring(0, 200)}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Helper to build attribute filters string
function buildAttributeFilters(filters: Record<string, string>): string {
  const parts = Object.entries(filters).map(
    ([key, value]) => `{key: "${key}", value: "${value}"}`
  );
  return `[${parts.join(', ')}]`;
}

// Fetch EC2 instance pricing
async function fetchEC2Instances(region: string): Promise<Record<string, number>> {
  console.log('  Fetching EC2 instances...');
  const instances: Record<string, number> = {};
  
  // Common instance types to fetch
  const instanceTypes = [
    // T3 series
    't3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge', 't3.2xlarge',
    't3a.nano', 't3a.micro', 't3a.small', 't3a.medium', 't3a.large', 't3a.xlarge', 't3a.2xlarge',
    // T4g (ARM)
    't4g.nano', 't4g.micro', 't4g.small', 't4g.medium', 't4g.large', 't4g.xlarge', 't4g.2xlarge',
    // M5 series
    'm5.large', 'm5.xlarge', 'm5.2xlarge', 'm5.4xlarge', 'm5.8xlarge', 'm5.12xlarge', 'm5.16xlarge', 'm5.24xlarge',
    'm5a.large', 'm5a.xlarge', 'm5a.2xlarge', 'm5a.4xlarge', 'm5a.8xlarge', 'm5a.12xlarge',
    'm5n.large', 'm5n.xlarge', 'm5n.2xlarge', 'm5n.4xlarge', 'm5n.8xlarge',
    // M6i series
    'm6i.large', 'm6i.xlarge', 'm6i.2xlarge', 'm6i.4xlarge', 'm6i.8xlarge', 'm6i.12xlarge', 'm6i.16xlarge',
    // M6g (ARM)
    'm6g.medium', 'm6g.large', 'm6g.xlarge', 'm6g.2xlarge', 'm6g.4xlarge', 'm6g.8xlarge',
    // M7i series
    'm7i.large', 'm7i.xlarge', 'm7i.2xlarge', 'm7i.4xlarge', 'm7i.8xlarge',
    // M7g (ARM)
    'm7g.medium', 'm7g.large', 'm7g.xlarge', 'm7g.2xlarge', 'm7g.4xlarge',
    // C5 series
    'c5.large', 'c5.xlarge', 'c5.2xlarge', 'c5.4xlarge', 'c5.9xlarge', 'c5.12xlarge', 'c5.18xlarge',
    'c5a.large', 'c5a.xlarge', 'c5a.2xlarge', 'c5a.4xlarge', 'c5a.8xlarge',
    'c5n.large', 'c5n.xlarge', 'c5n.2xlarge', 'c5n.4xlarge', 'c5n.9xlarge',
    // C6i series
    'c6i.large', 'c6i.xlarge', 'c6i.2xlarge', 'c6i.4xlarge', 'c6i.8xlarge', 'c6i.12xlarge',
    // C6g (ARM)
    'c6g.medium', 'c6g.large', 'c6g.xlarge', 'c6g.2xlarge', 'c6g.4xlarge', 'c6g.8xlarge',
    // C7i series
    'c7i.large', 'c7i.xlarge', 'c7i.2xlarge', 'c7i.4xlarge', 'c7i.8xlarge',
    // C7g (ARM)
    'c7g.medium', 'c7g.large', 'c7g.xlarge', 'c7g.2xlarge', 'c7g.4xlarge',
    // R5 series (Memory optimized)
    'r5.large', 'r5.xlarge', 'r5.2xlarge', 'r5.4xlarge', 'r5.8xlarge', 'r5.12xlarge', 'r5.16xlarge',
    'r5a.large', 'r5a.xlarge', 'r5a.2xlarge', 'r5a.4xlarge', 'r5a.8xlarge',
    'r5n.large', 'r5n.xlarge', 'r5n.2xlarge', 'r5n.4xlarge', 'r5n.8xlarge',
    // R6i series
    'r6i.large', 'r6i.xlarge', 'r6i.2xlarge', 'r6i.4xlarge', 'r6i.8xlarge', 'r6i.12xlarge',
    // R6g (ARM)
    'r6g.medium', 'r6g.large', 'r6g.xlarge', 'r6g.2xlarge', 'r6g.4xlarge', 'r6g.8xlarge',
    // R7i series
    'r7i.large', 'r7i.xlarge', 'r7i.2xlarge', 'r7i.4xlarge', 'r7i.8xlarge',
    // R7g (ARM)
    'r7g.medium', 'r7g.large', 'r7g.xlarge', 'r7g.2xlarge', 'r7g.4xlarge',
    // I3 series (Storage optimized)
    'i3.large', 'i3.xlarge', 'i3.2xlarge', 'i3.4xlarge', 'i3.8xlarge',
    // I4i series
    'i4i.large', 'i4i.xlarge', 'i4i.2xlarge', 'i4i.4xlarge', 'i4i.8xlarge',
    // D2 series
    'd2.xlarge', 'd2.2xlarge', 'd2.4xlarge', 'd2.8xlarge',
    // D3 series
    'd3.xlarge', 'd3.2xlarge', 'd3.4xlarge', 'd3.8xlarge',
    // P3 series (GPU)
    'p3.2xlarge', 'p3.8xlarge', 'p3.16xlarge',
    // P4d series (GPU)
    'p4d.24xlarge',
    // G4dn series (GPU)
    'g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge', 'g4dn.8xlarge', 'g4dn.12xlarge', 'g4dn.16xlarge',
    // G5 series (GPU)
    'g5.xlarge', 'g5.2xlarge', 'g5.4xlarge', 'g5.8xlarge', 'g5.12xlarge', 'g5.16xlarge',
    // Inf1 series (Inference)
    'inf1.xlarge', 'inf1.2xlarge', 'inf1.6xlarge', 'inf1.24xlarge',
    // X1 series (High memory)
    'x1.16xlarge', 'x1.32xlarge',
    // X2idn series
    'x2idn.large', 'x2idn.xlarge', 'x2idn.2xlarge', 'x2idn.4xlarge',
  ];
  
  // Batch fetch - 10 at a time
  for (let i = 0; i < instanceTypes.length; i += 10) {
    const batch = instanceTypes.slice(i, i + 10);
    
    for (const instanceType of batch) {
      const query = `{
        products(filter: {
          vendorName: "aws",
          service: "AmazonEC2",
          productFamily: "Compute Instance",
          region: "${region}",
          attributeFilters: [
            {key: "instanceType", value: "${instanceType}"},
            {key: "operatingSystem", value: "Linux"},
            {key: "tenancy", value: "Shared"},
            {key: "capacitystatus", value: "Used"},
            {key: "preInstalledSw", value: "NA"}
          ]
        }) {
          prices(filter: {purchaseOption: "on_demand"}) { USD }
        }
      }`;
      
      try {
        const response = await queryPricingAPI(query);
        if (response.data?.products?.[0]?.prices?.[0]?.USD) {
          instances[instanceType] = parseFloat(response.data.products[0].prices[0].USD);
        }
      } catch (e) {
        // Skip on error
      }
      
      await new Promise(r => setTimeout(r, 20)); // Rate limit
    }
    
    process.stdout.write(`    ${Object.keys(instances).length}/${instanceTypes.length} instances\r`);
  }
  
  console.log(`    ✓ ${Object.keys(instances).length} EC2 instance types`);
  return instances;
}

// Fetch EBS volume pricing
async function fetchEBSVolumes(region: string): Promise<{
  volumes: Record<string, number>;
  iops: Record<string, number>;
  throughput: Record<string, number>;
}> {
  console.log('  Fetching EBS volumes...');
  const volumes: Record<string, number> = {};
  const iops: Record<string, number> = {};
  const throughput: Record<string, number> = {};
  
  const volumeTypes = ['gp2', 'gp3', 'io1', 'io2', 'st1', 'sc1', 'standard'];
  
  for (const volumeType of volumeTypes) {
    // Storage pricing
    const storageQuery = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonEC2",
        productFamily: "Storage",
        region: "${region}",
        attributeFilters: [{key: "volumeApiName", value: "${volumeType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(storageQuery);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'GB-Mo');
      if (price?.USD) {
        volumes[volumeType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 30));
  }
  
  // IOPS pricing for io1/io2/gp3
  const iopsQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonEC2",
      productFamily: "System Operation",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(iopsQuery);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const usagetype = attrs.usagetype || '';
      const price = product.prices?.[0];
      if (price?.USD && price.unit?.includes('IOPS')) {
        if (usagetype.includes('io2') || usagetype.includes('VolumeP-IOPS.io2')) {
          iops['io2'] = parseFloat(price.USD);
        } else if (usagetype.includes('io1') || usagetype.includes('Piops')) {
          iops['io1'] = parseFloat(price.USD);
        } else if (usagetype.includes('gp3') && usagetype.includes('IOPS')) {
          iops['gp3'] = parseFloat(price.USD);
        }
      }
      if (price?.USD && usagetype.includes('gp3') && usagetype.includes('Throughput')) {
        throughput['gp3'] = parseFloat(price.USD);
      }
    }
  } catch (e) {
    // Skip
  }
  
  console.log(`    ✓ ${Object.keys(volumes).length} volume types`);
  return { volumes, iops, throughput };
}

// Fetch RDS instance pricing
async function fetchRDSInstances(region: string): Promise<{
  instances: Record<string, Record<string, number>>;
  storage: Record<string, number>;
  iops: number;
}> {
  console.log('  Fetching RDS instances...');
  const instances: Record<string, Record<string, number>> = {};
  const storage: Record<string, number> = {};
  let rdsIops = 0;
  
  const engines = ['MySQL', 'PostgreSQL', 'MariaDB', 'Aurora MySQL', 'Aurora PostgreSQL'];
  const instanceTypes = [
    'db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.t3.large', 'db.t3.xlarge', 'db.t3.2xlarge',
    'db.t4g.micro', 'db.t4g.small', 'db.t4g.medium', 'db.t4g.large', 'db.t4g.xlarge', 'db.t4g.2xlarge',
    'db.m5.large', 'db.m5.xlarge', 'db.m5.2xlarge', 'db.m5.4xlarge', 'db.m5.8xlarge', 'db.m5.12xlarge',
    'db.m6i.large', 'db.m6i.xlarge', 'db.m6i.2xlarge', 'db.m6i.4xlarge', 'db.m6i.8xlarge',
    'db.m6g.large', 'db.m6g.xlarge', 'db.m6g.2xlarge', 'db.m6g.4xlarge', 'db.m6g.8xlarge',
    'db.r5.large', 'db.r5.xlarge', 'db.r5.2xlarge', 'db.r5.4xlarge', 'db.r5.8xlarge', 'db.r5.12xlarge',
    'db.r6i.large', 'db.r6i.xlarge', 'db.r6i.2xlarge', 'db.r6i.4xlarge', 'db.r6i.8xlarge',
    'db.r6g.large', 'db.r6g.xlarge', 'db.r6g.2xlarge', 'db.r6g.4xlarge', 'db.r6g.8xlarge',
  ];
  
  let count = 0;
  for (const engine of engines) {
    const engineKey = engine.toLowerCase().replace(/\s+/g, '-');
    instances[engineKey] = {};
    
    for (const instanceType of instanceTypes) {
      const query = `{
        products(filter: {
          vendorName: "aws",
          service: "AmazonRDS",
          productFamily: "Database Instance",
          region: "${region}",
          attributeFilters: [
            {key: "instanceType", value: "${instanceType}"},
            {key: "databaseEngine", value: "${engine}"},
            {key: "deploymentOption", value: "Single-AZ"}
          ]
        }) {
          prices(filter: {purchaseOption: "on_demand"}) { USD unit }
        }
      }`;
      
      try {
        const response = await queryPricingAPI(query);
        const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
        if (price?.USD) {
          instances[engineKey][instanceType] = parseFloat(price.USD);
          count++;
        }
      } catch (e) {
        // Skip
      }
      
      await new Promise(r => setTimeout(r, 20));
    }
  }
  
  // RDS Storage
  const storageTypes = ['gp2', 'gp3', 'io1'];
  for (const storageType of storageTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonRDS",
        productFamily: "Database Storage",
        region: "${region}",
        attributeFilters: [{key: "volumeType", value: "General Purpose (SSD)"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'GB-Mo');
      if (price?.USD) {
        storage[storageType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
  }
  
  // RDS IOPS
  const iopsQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonRDS",
      productFamily: "Provisioned IOPS",
      region: "${region}"
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(iopsQuery);
    const price = response.data?.products?.[0]?.prices?.find(p => p.unit?.includes('IOPS'));
    if (price?.USD) {
      rdsIops = parseFloat(price.USD);
    }
  } catch (e) {
    // Skip
  }
  
  console.log(`    ✓ ${count} RDS instance types across ${Object.keys(instances).length} engines`);
  return { instances, storage, iops: rdsIops };
}

// Fetch ElastiCache pricing
async function fetchElastiCache(region: string): Promise<Record<string, number>> {
  console.log('  Fetching ElastiCache nodes...');
  const nodes: Record<string, number> = {};
  
  const nodeTypes = [
    'cache.t3.micro', 'cache.t3.small', 'cache.t3.medium',
    'cache.t4g.micro', 'cache.t4g.small', 'cache.t4g.medium',
    'cache.m5.large', 'cache.m5.xlarge', 'cache.m5.2xlarge', 'cache.m5.4xlarge',
    'cache.m6g.large', 'cache.m6g.xlarge', 'cache.m6g.2xlarge', 'cache.m6g.4xlarge',
    'cache.m7g.large', 'cache.m7g.xlarge', 'cache.m7g.2xlarge',
    'cache.r5.large', 'cache.r5.xlarge', 'cache.r5.2xlarge', 'cache.r5.4xlarge',
    'cache.r6g.large', 'cache.r6g.xlarge', 'cache.r6g.2xlarge', 'cache.r6g.4xlarge',
    'cache.r7g.large', 'cache.r7g.xlarge', 'cache.r7g.2xlarge',
  ];
  
  for (const nodeType of nodeTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonElastiCache",
        productFamily: "Cache Instance",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${nodeType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        nodes[nodeType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  console.log(`    ✓ ${Object.keys(nodes).length} ElastiCache node types`);
  return nodes;
}

// Fetch Lambda pricing
async function fetchLambda(region: string): Promise<{ requests: number; duration: number; durationArm?: number }> {
  console.log('  Fetching Lambda...');
  let requests = 0;
  let duration = 0;
  let durationArm: number | undefined;
  
  const query = `{
    products(filter: {
      vendorName: "aws",
      service: "AWSLambda",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(query);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const group = attrs.group || '';
      const usagetype = attrs.usagetype || '';
      const description = (product as any).description || ''; // Note: product interface above doesn't have description but API might return it if requested, though query doesn't ask for it. attributes might contain it.
      // attributes often has 'groupDescription' or similar. 
      
      const price = product.prices?.[0];
      if (price?.USD) {
        if (group.includes('Request') || usagetype.includes('Request')) {
          requests = parseFloat(price.USD) * 1000000;
        } else if (group.includes('Duration') || usagetype.includes('Lambda-GB-Second')) {
          // Check for ARM
          const isArm = usagetype.includes('ARM') || 
                        group.includes('ARM') || 
                        (attrs['groupDescription'] && attrs['groupDescription'].includes('ARM'));
                        
          if (isArm) {
            durationArm = parseFloat(price.USD);
          } else {
            duration = parseFloat(price.USD);
          }
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  console.log(`    ✓ Lambda pricing`);
  return { requests, duration, durationArm };
}

// Fetch NAT Gateway pricing
async function fetchNATGateway(region: string): Promise<{ hourly: number; perGB: number }> {
  console.log('  Fetching NAT Gateway...');
  let hourly = 0;
  let perGB = 0;
  
  const query = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonEC2",
      productFamily: "NAT Gateway",
      region: "${region}"
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(query);
    for (const product of response.data?.products || []) {
      for (const price of product.prices || []) {
        if (price.unit === 'Hrs') {
          hourly = parseFloat(price.USD);
        } else if (price.unit === 'GB') {
          perGB = parseFloat(price.USD);
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  console.log(`    ✓ NAT Gateway pricing`);
  return { hourly, perGB };
}

// Fetch Load Balancer pricing
async function fetchLoadBalancers(region: string): Promise<{
  alb: { hourly: number; lcuHourly: number };
  nlb: { hourly: number; lcuHourly: number };
  clb: { hourly: number };
}> {
  console.log('  Fetching Load Balancers...');
  const result = {
    alb: { hourly: 0, lcuHourly: 0 },
    nlb: { hourly: 0, lcuHourly: 0 },
    clb: { hourly: 0 },
  };
  
  // ALB
  const albQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AWSELB",
      productFamily: "Load Balancer-Application",
      region: "${region}"
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(albQuery);
    for (const product of response.data?.products || []) {
      for (const price of product.prices || []) {
        if (price.unit === 'Hrs') {
          result.alb.hourly = parseFloat(price.USD);
        } else if (price.unit?.includes('LCU')) {
          result.alb.lcuHourly = parseFloat(price.USD);
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  // NLB
  const nlbQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AWSELB",
      productFamily: "Load Balancer-Network",
      region: "${region}"
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(nlbQuery);
    for (const product of response.data?.products || []) {
      for (const price of product.prices || []) {
        if (price.unit === 'Hrs') {
          result.nlb.hourly = parseFloat(price.USD);
        } else if (price.unit?.includes('LCU') || price.unit?.includes('NLCU')) {
          result.nlb.lcuHourly = parseFloat(price.USD);
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  // CLB
  const clbQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AWSELB",
      productFamily: "Load Balancer",
      region: "${region}"
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(clbQuery);
    for (const product of response.data?.products || []) {
      const price = product.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        result.clb.hourly = parseFloat(price.USD);
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  console.log(`    ✓ Load Balancer pricing`);
  return result;
}

// Fetch EKS pricing
async function fetchEKS(region: string): Promise<{ clusterHourly: number }> {
  console.log('  Fetching EKS...');
  let clusterHourly = 0;
  
  const query = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonEKS",
      region: "${region}"
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(query);
    const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
    if (price?.USD) {
      clusterHourly = parseFloat(price.USD);
    }
  } catch (e) {
    // Use default
  }
  
  console.log(`    ✓ EKS pricing`);
  return { clusterHourly };
}

// Fetch Fargate pricing
async function fetchFargate(region: string): Promise<{ vcpuHourly: number; memoryGBHourly: number }> {
  console.log('  Fetching Fargate...');
  let vcpuHourly = 0;
  let memoryGBHourly = 0;
  
  const query = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonECS",
      productFamily: "Compute",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(query);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const usagetype = attrs.usagetype || '';
      const price = product.prices?.[0];
      if (price?.USD) {
        if (usagetype.includes('vCPU') || usagetype.includes('Fargate-vCPU')) {
          vcpuHourly = parseFloat(price.USD);
        } else if (usagetype.includes('GB') || usagetype.includes('Fargate-GB')) {
          memoryGBHourly = parseFloat(price.USD);
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  console.log(`    ✓ Fargate pricing`);
  return { vcpuHourly, memoryGBHourly };
}

// Fetch other service pricing
async function fetchOtherServices(region: string): Promise<Record<string, unknown>> {
  console.log('  Fetching other services...');
  
  const other: Record<string, unknown> = {
    dynamodb: {
      readCapacity: 0,
      writeCapacity: 0,
      onDemandRead: 0,
      onDemandWrite: 0,
      storage: 0,
    },
    s3: {
      standardStorage: 0,
      standardIAStorage: 0,
      glacierStorage: 0,
    },
    apiGateway: {
      rest: 0,
      http: 0,
      websocket: 0,
    },
    sqs: {
      standard: 0,
      fifo: 0,
    },
    sns: {
      publish: 0,
    },
    cloudwatch: {
      metrics: 0,
      alarmStandard: 0,
      alarmHighRes: 0,
      dashboards: 0,
      logsIngestion: 0,
      logsStorage: 0,
    },
    secretsManager: {
      secret: 0,
      apiCalls: 0,
    },
    kms: {
      key: 0,
      requests: 0,
    },
    stepFunctions: {
      standard: 0,
      express: 0,
    },
    route53: {
      hostedZone: 0,
      queries: 0,
    },
    vpcEndpoint: {
      hourly: 0,
      dataProcessed: 0,
    },
    cognito: {
      mau: 0,
    },
    eventBridge: {
      customEvents: 0,
    },
    kinesis: {
      shardHourly: 0,
      payloadUnit: 0,
    },
    efs: {
      standard: 0,
      ia: 0,
    },
    ecr: {
      storage: 0,
    },
    waf: {
      webACL: 0,
      rule: 0,
      requests: 0,
    },
    glue: {
      dpuHour: 0,
    },
    athena: {
      dataScanned: 0,
    },
  };
  
  // Fetch DynamoDB
  const dynamoQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonDynamoDB",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(dynamoQuery);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const group = attrs.group || '';
      const price = product.prices?.[0];
      if (price?.USD) {
        const db = other.dynamodb as Record<string, number>;
        if (group.includes('DDB-ReadUnits')) {
          db.readCapacity = parseFloat(price.USD);
        } else if (group.includes('DDB-WriteUnits')) {
          db.writeCapacity = parseFloat(price.USD);
        } else if (group.includes('PayPerRequest') && group.includes('Read')) {
          db.onDemandRead = parseFloat(price.USD) * 1000000;
        } else if (group.includes('PayPerRequest') && group.includes('Write')) {
          db.onDemandWrite = parseFloat(price.USD) * 1000000;
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  // Fetch S3
  const s3Query = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonS3",
      productFamily: "Storage",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit startUsageAmount }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(s3Query);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const storageClass = attrs.storageClass || '';
      const price = product.prices?.find(p => p.unit === 'GB-Mo' && (!p.startUsageAmount || p.startUsageAmount === '0'));
      if (price?.USD) {
        const s3 = other.s3 as Record<string, number>;
        if (storageClass.includes('General Purpose')) {
          s3.standardStorage = parseFloat(price.USD);
        } else if (storageClass.includes('Infrequent Access')) {
          s3.standardIAStorage = parseFloat(price.USD);
        } else if (storageClass.includes('Glacier')) {
          s3.glacierStorage = parseFloat(price.USD);
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  // Fetch API Gateway
  const apiGwQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonApiGateway",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit startUsageAmount }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(apiGwQuery);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const usagetype = attrs.usagetype || '';
      const price = product.prices?.find(p => !p.startUsageAmount || p.startUsageAmount === '0');
      if (price?.USD) {
        const apigw = other.apiGateway as Record<string, number>;
        const pricePerMillion = parseFloat(price.USD) * 1000000;
        if (usagetype.includes('HTTP')) {
          apigw.http = pricePerMillion;
        } else if (usagetype.includes('WebSocket')) {
          apigw.websocket = pricePerMillion;
        } else if (usagetype.includes('ApiGatewayRequest')) {
          apigw.rest = pricePerMillion;
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  console.log(`    ✓ Other services`);
  return other;
}

// Fetch OpenSearch/Elasticsearch instances
async function fetchOpenSearch(region: string): Promise<Record<string, number>> {
  console.log('  Fetching OpenSearch...');
  const instances: Record<string, number> = {};
  
  const instanceTypes = [
    't3.small.search', 't3.medium.search',
    'm5.large.search', 'm5.xlarge.search', 'm5.2xlarge.search', 'm5.4xlarge.search',
    'm6g.large.search', 'm6g.xlarge.search', 'm6g.2xlarge.search',
    'r5.large.search', 'r5.xlarge.search', 'r5.2xlarge.search', 'r5.4xlarge.search',
    'r6g.large.search', 'r6g.xlarge.search', 'r6g.2xlarge.search',
    'c5.large.search', 'c5.xlarge.search', 'c5.2xlarge.search',
    'c6g.large.search', 'c6g.xlarge.search', 'c6g.2xlarge.search',
  ];
  
  for (const instanceType of instanceTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonES",
        productFamily: "Amazon OpenSearch Service Instance",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${instanceType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        instances[instanceType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  console.log(`    ✓ ${Object.keys(instances).length} OpenSearch instance types`);
  return instances;
}

// Fetch DocumentDB instances
async function fetchDocumentDB(region: string): Promise<{ instances: Record<string, number>; storage: number }> {
  console.log('  Fetching DocumentDB...');
  const instances: Record<string, number> = {};
  let storage = 0;
  
  const instanceTypes = [
    'db.t3.medium', 'db.t4g.medium',
    'db.r5.large', 'db.r5.xlarge', 'db.r5.2xlarge', 'db.r5.4xlarge', 'db.r5.8xlarge',
    'db.r6g.large', 'db.r6g.xlarge', 'db.r6g.2xlarge', 'db.r6g.4xlarge',
  ];
  
  for (const instanceType of instanceTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonDocDB",
        productFamily: "Database Instance",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${instanceType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        instances[instanceType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  // Storage
  const storageQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonDocDB",
      productFamily: "Database Storage",
      region: "${region}"
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(storageQuery);
    const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'GB-Mo');
    if (price?.USD) {
      storage = parseFloat(price.USD);
    }
  } catch (e) {
    // Use default
  }
  
  console.log(`    ✓ ${Object.keys(instances).length} DocumentDB instance types`);
  return { instances, storage };
}

// Fetch Neptune instances
async function fetchNeptune(region: string): Promise<{ instances: Record<string, number>; storage: number }> {
  console.log('  Fetching Neptune...');
  const instances: Record<string, number> = {};
  let storage = 0;
  
  const instanceTypes = [
    'db.t3.medium', 'db.t4g.medium',
    'db.r5.large', 'db.r5.xlarge', 'db.r5.2xlarge', 'db.r5.4xlarge', 'db.r5.8xlarge', 'db.r5.12xlarge',
    'db.r6g.large', 'db.r6g.xlarge', 'db.r6g.2xlarge', 'db.r6g.4xlarge', 'db.r6g.8xlarge',
    'db.serverless',
  ];
  
  for (const instanceType of instanceTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonNeptune",
        productFamily: "Database Instance",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${instanceType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        instances[instanceType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  console.log(`    ✓ ${Object.keys(instances).length} Neptune instance types`);
  return { instances, storage };
}

// Fetch Redshift instances
async function fetchRedshift(region: string): Promise<{ instances: Record<string, number> }> {
  console.log('  Fetching Redshift...');
  const instances: Record<string, number> = {};
  
  const nodeTypes = [
    'dc2.large', 'dc2.8xlarge',
    'ds2.xlarge', 'ds2.8xlarge',
    'ra3.xlplus', 'ra3.4xlarge', 'ra3.16xlarge',
  ];
  
  for (const nodeType of nodeTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonRedshift",
        productFamily: "Compute Instance",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${nodeType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        instances[nodeType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  console.log(`    ✓ ${Object.keys(instances).length} Redshift node types`);
  return { instances };
}

// Fetch Kinesis pricing
async function fetchKinesis(region: string): Promise<{ shardHourly: number; payloadUnit: number }> {
  console.log('  Fetching Kinesis...');
  let shardHourly = 0;
  let payloadUnit = 0;
  
  const shardQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonKinesis",
      productFamily: "Kinesis Streams",
      region: "${region}",
      attributeFilters: [{key: "usagetype", valueRegex: "/ShardHour/"}]
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(shardQuery);
    const price = response.data?.products?.[0]?.prices?.[0];
    if (price?.USD) {
      shardHourly = parseFloat(price.USD);
    }
  } catch (e) {
    // Use default
  }
  
  console.log('    ✓ Kinesis pricing');
  return { shardHourly, payloadUnit };
}

// Fetch MSK (Kafka) pricing
async function fetchMSK(region: string): Promise<{ instanceHourly: Record<string, number>; storage: number }> {
  console.log('  Fetching MSK...');
  const instanceHourly: Record<string, number> = {};
  const storage = 0;
  
  const instanceTypes = [
    'kafka.t3.small',
    'kafka.m5.large', 'kafka.m5.xlarge', 'kafka.m5.2xlarge', 'kafka.m5.4xlarge', 'kafka.m5.8xlarge', 'kafka.m5.12xlarge',
  ];
  
  for (const instanceType of instanceTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonMSK",
        productFamily: "Managed Streaming for Apache Kafka (MSK)",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${instanceType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        instanceHourly[instanceType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  console.log(`    ✓ ${Object.keys(instanceHourly).length} MSK instance types`);
  return { instanceHourly, storage };
}

// Fetch MQ (ActiveMQ/RabbitMQ) pricing
async function fetchMQ(region: string): Promise<{ instanceHourly: Record<string, number>; storage: number }> {
  console.log('  Fetching Amazon MQ...');
  const instanceHourly: Record<string, number> = {};
  const storage = 0;
  
  const instanceTypes = [
    'mq.t2.micro', 'mq.t3.micro',
    'mq.m5.large', 'mq.m5.xlarge', 'mq.m5.2xlarge', 'mq.m5.4xlarge',
  ];
  
  for (const instanceType of instanceTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AmazonMQ",
        productFamily: "Broker Instances",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${instanceType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        instanceHourly[instanceType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  console.log(`    ✓ ${Object.keys(instanceHourly).length} MQ instance types`);
  return { instanceHourly, storage };
}

// Fetch CloudWatch pricing
async function fetchCloudWatch(region: string): Promise<{
  alarmStandard: number;
  alarmHighRes: number;
  dashboards: number;
  logsIngestion: number;
  logsStorage: number;
}> {
  console.log('  Fetching CloudWatch...');
  let alarmStandard = 0;
  let alarmHighRes = 0;
  let dashboards = 0;
  let logsIngestion = 0;
  let logsStorage = 0;
  
  // Alarm pricing
  const alarmQuery = `{
    products(filter: {
      vendorName: "aws",
      service: "AmazonCloudWatch",
      productFamily: "Alarm",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(alarmQuery);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const price = product.prices?.[0];
      if (price?.USD) {
        if (attrs['alarmType'] === 'Standard') {
          alarmStandard = parseFloat(price.USD);
        } else if (attrs['alarmType'] === 'High Resolution') {
          alarmHighRes = parseFloat(price.USD);
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  console.log('    ✓ CloudWatch pricing');
  return { alarmStandard, alarmHighRes, dashboards, logsIngestion, logsStorage };
}

// Fetch WAF pricing
async function fetchWAF(region: string): Promise<{ webACL: number; rule: number; requests: number }> {
  console.log('  Fetching WAF...');
  let webACL = 0;
  let rule = 0;
  let requests = 0;
  
  const query = `{
    products(filter: {
      vendorName: "aws",
      service: "awswaf",
      productFamily: "Web Application Firewall",
      region: "${region}"
    }) {
      attributes { key value }
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(query);
    for (const product of response.data?.products || []) {
      const attrs = attributesToObject(product.attributes);
      const price = product.prices?.[0];
      if (price?.USD) {
        const usagetype = attrs['usagetype'] || '';
        if (usagetype.includes('WebACL')) {
          webACL = parseFloat(price.USD);
        } else if (usagetype.includes('Rule')) {
          rule = parseFloat(price.USD);
        } else if (usagetype.includes('Request')) {
          requests = parseFloat(price.USD);
        }
      }
    }
  } catch (e) {
    // Use defaults
  }
  
  console.log('    ✓ WAF pricing');
  return { webACL, rule, requests };
}

// Fetch Glue pricing
async function fetchGlue(region: string): Promise<{ dpuHour: number }> {
  console.log('  Fetching Glue...');
  let dpuHour = 0;
  
  const query = `{
    products(filter: {
      vendorName: "aws",
      service: "AWSGlue",
      productFamily: "AWS Glue",
      region: "${region}",
      attributeFilters: [{key: "usagetype", valueRegex: "/DPU-Hour/"}]
    }) {
      prices(filter: {purchaseOption: "on_demand"}) { USD unit }
    }
  }`;
  
  try {
    const response = await queryPricingAPI(query);
    const price = response.data?.products?.[0]?.prices?.[0];
    if (price?.USD) {
      dpuHour = parseFloat(price.USD);
    }
  } catch (e) {
    // Use default
  }
  
  console.log('    ✓ Glue pricing');
  return { dpuHour };
}

// Fetch DMS pricing
async function fetchDMS(region: string): Promise<{ instances: Record<string, number> }> {
  console.log('  Fetching DMS...');
  const instances: Record<string, number> = {};
  
  const instanceTypes = [
    'dms.t2.micro', 'dms.t2.small', 'dms.t2.medium', 'dms.t2.large',
    'dms.t3.micro', 'dms.t3.small', 'dms.t3.medium', 'dms.t3.large',
    'dms.c5.large', 'dms.c5.xlarge', 'dms.c5.2xlarge', 'dms.c5.4xlarge',
    'dms.r5.large', 'dms.r5.xlarge', 'dms.r5.2xlarge', 'dms.r5.4xlarge',
  ];
  
  for (const instanceType of instanceTypes) {
    const query = `{
      products(filter: {
        vendorName: "aws",
        service: "AWSDatabaseMigrationSvc",
        productFamily: "Database Migration",
        region: "${region}",
        attributeFilters: [{key: "instanceType", value: "${instanceType}"}]
      }) {
        prices(filter: {purchaseOption: "on_demand"}) { USD unit }
      }
    }`;
    
    try {
      const response = await queryPricingAPI(query);
      const price = response.data?.products?.[0]?.prices?.find(p => p.unit === 'Hrs');
      if (price?.USD) {
        instances[instanceType] = parseFloat(price.USD);
      }
    } catch (e) {
      // Skip
    }
    
    await new Promise(r => setTimeout(r, 20));
  }
  
  console.log(`    ✓ ${Object.keys(instances).length} DMS instance types`);
  return { instances };
}

// Main pricing data structure
interface AWSpricingData {
  region: string;
  lastUpdated: string;
  [key: string]: any; // Allow any structure for generation script flexibility
}

async function fetchAllPricingForRegion(region: string): Promise<AWSpricingData> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Fetching pricing for: ${region}`);
  console.log('='.repeat(60));
  
  const ec2 = await fetchEC2Instances(region);
  const ebs = await fetchEBSVolumes(region);
  const rds = await fetchRDSInstances(region);
  const elasticache = await fetchElastiCache(region);
  const lambda = await fetchLambda(region);
  const natGateway = await fetchNATGateway(region);
  const loadBalancer = await fetchLoadBalancers(region);
  const eks = await fetchEKS(region);
  const fargate = await fetchFargate(region);
  const opensearch = await fetchOpenSearch(region);
  const documentdb = await fetchDocumentDB(region);
  const neptune = await fetchNeptune(region);
  const redshift = await fetchRedshift(region);
  const fetchedKinesis = await fetchKinesis(region);
  const msk = await fetchMSK(region);
  const mq = await fetchMQ(region);
  const fetchedCloudwatch = await fetchCloudWatch(region);
  const fetchedWaf = await fetchWAF(region);
  const fetchedGlue = await fetchGlue(region);
  const dms = await fetchDMS(region);
  const other = await fetchOtherServices(region);
  
  // Flatten other services to top-level
  const dynamodb = other.dynamodb as any;
  const s3 = other.s3 as any;
  const apiGateway = other.apiGateway as any;
  const sqs = other.sqs as any;
  const sns = other.sns as any;
  const cloudwatch = other.cloudwatch as any;
  const secretsManager = other.secretsManager as any;
  const kms = other.kms as any;
  const stepFunctions = other.stepFunctions as any;
  const route53 = other.route53 as any;
  const vpcEndpoint = other.vpcEndpoint as any;
  const eventbridge = other.eventBridge as any;
  const kinesis = other.kinesis as any;
  const efs = other.efs as any;
  const ecr = other.ecr as any;
  const waf = other.waf as any;
  const glue = other.glue as any;
  const athena = other.athena as any;
  
  // Extract Aurora from RDS
  const auroraInstances: Record<string, number> = {};
  if (rds.instances['aurora-mysql']) {
    Object.assign(auroraInstances, rds.instances['aurora-mysql']);
    delete rds.instances['aurora-mysql'];
  }
  if (rds.instances['aurora-postgresql']) {
    Object.assign(auroraInstances, rds.instances['aurora-postgresql']);
    delete rds.instances['aurora-postgresql'];
  }
  
  const aurora = {
    instances: auroraInstances,
    storage: 0.10, // Default
    ioRequests: 0.20,
    backtrackChanges: 0.012
  };

  // Filter out promoted services from other
  const otherRemaining: Record<string, unknown> = { ...other };
  ['dynamodb', 's3', 'apiGateway', 'sqs', 'sns', 'cloudwatch', 'secretsManager', 'kms', 'stepFunctions', 'route53', 'vpcEndpoint', 'eventBridge', 'kinesis', 'efs', 'ecr', 'waf', 'glue', 'athena'].forEach(k => delete otherRemaining[k]);

  return {
    region,
    lastUpdated: new Date().toISOString(),
    ec2: { instances: ec2, hosts: {} },
    ebs: { ...ebs, snapshots: 0.05 },
    rds,
    aurora,
    elasticache: { nodes: elasticache },
    dynamodb,
    neptune,
    documentdb,
    redshift,
    natGateway,
    loadBalancer,
    vpcEndpoint,
    vpnConnection: { hourly: 0.05, transitGatewayAttachment: 0.05, clientVpn: { endpointHourly: 0.05, connectionHourly: 0.05 } },
    transitGateway: { hourly: 0.05, dataProcessed: 0.02, peering: 0.05 },
    trafficMirror: { sessionHourly: 0.15 },
    directConnect: { portHours: {}, dataTransfer: 0.02 },
    globalAccelerator: { hourly: 0.025, dataTransfer: 0.015 },
    eks,
    ecs: { fargateVcpuHourly: fargate.vcpuHourly, fargateMemoryGBHourly: fargate.memoryGBHourly },
    ecr,
    lambda,
    apiGateway,
    stepFunctions,
    s3: { ...s3, requests: { put: 0.005, get: 0.0004, lifecycle: 0.01 } }, // Add requests default
    efs: { ...efs, provisionedThroughput: 6.00 },
    fsx: { lustre: 0.14, windows: 0.23, ontap: 0.25, openzfs: 0.09 },
    backup: { storage: 0.05, restoreStorage: 0.02 },
    opensearch: { instances: opensearch, storage: 0.135, ultrawarmStorage: 0.024 },
    elasticsearch: { instances: {} },
    kinesis: { ...kinesis, extendedRetention: 0.02, enhancedFanout: 0.015 },
    kinesisFirehose: { dataIngested: 0.029, formatConversion: 0.018 },
    glue: { ...glue, crawlerDpuHour: 0.44, catalogStorage: 1.00, catalogRequests: 1.00 },
    athena,
    sqs,
    sns: { ...sns, deliveries: { http: 0.60, email: 2.00, sms: 0.75, lambda: 0.00, sqs: 0.00 } },
    eventbridge: { ...eventbridge, partnerEvents: 1.00, archiveProcessed: 0.10, schemaDiscovery: 0.10 },
    mq,
    msk,
    directoryService: { simpleAD: { small: 0.05, large: 0.15 }, microsoftAD: { standard: 0.12, enterprise: 0.40 } },
    mwaa: { environment: { 'mw1.small': 0.49, 'mw1.medium': 0.99, 'mw1.large': 1.99 } },
    kinesisAnalytics: { kpuHourly: 0.11, storage: 0.10 },
    ssm: { parameter: { standard: 0, advanced: 0.05, apiCalls: 0.05 }, activation: { standard: 0, advanced: 0.00695 } },
    secretsManager,
    kms,
    acm: { privateCertificate: 0.75 },
    waf,
    guardDuty: { events: 4.00, s3Events: 0.80, eksEvents: 1.60 },
    macie: { bucketEvaluated: 0.10, dataScanned: 1.00 },
    cloudwatch: { ...cloudwatch, alarmAnomaly: 0.30, alarmComposite: 0.50, logsInsightsQueries: 0.005, contributorInsightsRules: 0.50, contributorInsightsEvents: 0.02 },
    cloudtrail: { managementEvents: 2.00, dataEvents: 0.10, insightsEvents: 0.35 },
    config: { configItems: 0.003, rules: 1.00, conformancePackRules: 0.001 },
    codebuild: { linuxSmall: 0.005, linuxMedium: 0.01, linuxLarge: 0.02, linux2xlarge: 0.04, armLarge: 0.015, gpuLarge: 0.18, windowsMedium: 0.02, windowsLarge: 0.04 },
    codepipeline: { activePipeline: 1.00, trialPipelines: 0 },
    cloudfront: { dataTransfer: {}, requests: { http: 0.0075, https: 0.01 }, invalidations: 0.005, ssl: 600.00, originShield: 0.0090, realtimeLogs: 0.01, functions: 0.10 },
    route53: { ...route53, healthChecks: { basic: 0.50, https: 0.75, string: 1.00, fast: 1.00 }, resolverEndpoint: 0.125, resolverQueries: 0.40 },
    sagemaker: { notebookInstances: {}, trainingInstances: {}, endpointInstances: {} },
    transferFamily: { protocols: 0.30, dataProcessed: 0.04 },
    dms,
    iot: { connectivityMinutes: 0.08, messages: 1.00, ruleEngineActions: 0.15 },
    lightsail: { instances: {} },
    beanstalk: {},
    fargate,
    other: otherRemaining,
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Infracost Cloud Pricing API - AWS Pricing Fetcher');
  console.log('='.repeat(60));
  console.log(`API Key: ${INFRACOST_API_KEY.substring(0, 15)}...`);
  console.log(`Regions: ${REGIONS.join(', ')}`);
  
  const allPricing: Record<string, AWSpricingData> = {};
  
  for (const region of REGIONS) {
    allPricing[region] = await fetchAllPricingForRegion(region);
  }
  
  // Save to file
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  
  const outputPath = path.join(dataDir, 'aws-pricing.json');
  fs.writeFileSync(outputPath, JSON.stringify(allPricing, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  for (const [region, pricing] of Object.entries(allPricing)) {
    console.log(`\n${region}:`);
    console.log(`  EC2 Instance Types:     ${Object.keys(pricing.ec2.instances).length}`);
    console.log(`  EBS Volume Types:       ${Object.keys(pricing.ebs.volumes).length}`);
    
    const rdsInstances = pricing.rds.instances as Record<string, Record<string, number>>;
    console.log(`  RDS Engines:            ${Object.keys(rdsInstances).length}`);
    const totalRds = Object.values(rdsInstances).reduce((s: number, e: Record<string, number>) => s + Object.keys(e).length, 0);
    console.log(`  RDS Instance Types:     ${totalRds}`);
    
    console.log(`  ElastiCache Nodes:      ${Object.keys(pricing.elasticache.nodes).length}`);
    console.log(`  OpenSearch Instances:   ${Object.keys(pricing.opensearch.instances).length}`);
    console.log(`  DocumentDB Instances:   ${Object.keys(pricing.documentdb.instances).length}`);
    console.log(`  Neptune Instances:      ${Object.keys(pricing.neptune.instances).length}`);
    console.log(`  Redshift Node Types:    ${Object.keys(pricing.redshift.instances).length}`);
    console.log(`  MSK Instance Types:     ${Object.keys(pricing.msk.instanceHourly).length}`);
    console.log(`  MQ Instance Types:      ${Object.keys(pricing.mq.instanceHourly).length}`);
    console.log(`  DMS Instance Types:     ${Object.keys(pricing.dms.instances).length}`);
  }
  
  console.log(`\n✓ Pricing data saved to: ${outputPath}`);
  console.log('✅ Complete!');
}

main().catch(console.error);
