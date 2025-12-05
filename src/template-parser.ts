/**
 * CloudFormation Template Parser
 * Parses and normalizes CloudFormation templates from JSON or YAML
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { CloudFormationTemplate, CloudFormationResource } from './types';

export class TemplateParser {
  /**
   * Parse a CloudFormation template from a file path
   */
  static parseFile(filePath: string): CloudFormationTemplate {
    const absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Template file not found: ${absolutePath}`);
    }
    
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return this.parseContent(content, filePath);
  }
  
  /**
   * Parse a CloudFormation template from string content
   */
  static parseContent(content: string, sourceName: string = 'template'): CloudFormationTemplate {
    let template: CloudFormationTemplate;
    
    // Try JSON first
    try {
      template = JSON.parse(content);
    } catch {
      // Try YAML
      try {
        template = yaml.parse(content);
      } catch (yamlError) {
        throw new Error(`Failed to parse template ${sourceName} as JSON or YAML: ${yamlError}`);
      }
    }
    
    // Validate basic structure
    if (!template || typeof template !== 'object') {
      throw new Error(`Invalid template structure in ${sourceName}`);
    }
    
    if (!template.Resources || typeof template.Resources !== 'object') {
      throw new Error(`Template ${sourceName} has no Resources section`);
    }
    
    return template;
  }
  
  /**
   * Extract all resources from a template
   */
  static extractResources(template: CloudFormationTemplate): Map<string, CloudFormationResource> {
    const resources = new Map<string, CloudFormationResource>();
    
    for (const [logicalId, resource] of Object.entries(template.Resources)) {
      if (resource && typeof resource === 'object' && 'Type' in resource) {
        resources.set(logicalId, resource as CloudFormationResource);
      }
    }
    
    return resources;
  }
  
  /**
   * Get resources by type
   */
  static getResourcesByType(template: CloudFormationTemplate, resourceType: string): Map<string, CloudFormationResource> {
    const resources = new Map<string, CloudFormationResource>();
    const allResources = this.extractResources(template);
    
    for (const [logicalId, resource] of allResources) {
      if (resource.Type === resourceType) {
        resources.set(logicalId, resource);
      }
    }
    
    return resources;
  }
  
  /**
   * Get all unique resource types in a template
   */
  static getResourceTypes(template: CloudFormationTemplate): Set<string> {
    const types = new Set<string>();
    const resources = this.extractResources(template);
    
    for (const resource of resources.values()) {
      types.add(resource.Type);
    }
    
    return types;
  }
  
  /**
   * Resolve intrinsic functions where possible (basic resolution)
   * This handles simple cases like Ref to parameters with defaults
   */
  static resolveBasicIntrinsics(
    template: CloudFormationTemplate, 
    value: unknown,
    context: { parameters?: Record<string, unknown> } = {}
  ): unknown {
    if (value === null || value === undefined) {
      return value;
    }
    
    if (typeof value !== 'object') {
      return value;
    }
    
    if (Array.isArray(value)) {
      return value.map(item => this.resolveBasicIntrinsics(template, item, context));
    }
    
    const obj = value as Record<string, unknown>;
    
    // Handle Ref
    if ('Ref' in obj && typeof obj.Ref === 'string') {
      const refName = obj.Ref;
      
      // Check parameters
      if (template.Parameters && template.Parameters[refName]) {
        const param = template.Parameters[refName] as Record<string, unknown>;
        if (context.parameters && context.parameters[refName] !== undefined) {
          return context.parameters[refName];
        }
        if (param.Default !== undefined) {
          return param.Default;
        }
      }
      
      // Return unresolved reference as string
      return `{{Ref:${refName}}}`;
    }
    
    // Handle Fn::GetAtt
    if ('Fn::GetAtt' in obj) {
      const getAtt = obj['Fn::GetAtt'];
      if (Array.isArray(getAtt) && getAtt.length === 2) {
        return `{{GetAtt:${getAtt[0]}.${getAtt[1]}}}`;
      }
    }
    
    // Handle Fn::Sub
    if ('Fn::Sub' in obj) {
      const sub = obj['Fn::Sub'];
      if (typeof sub === 'string') {
        return sub; // Return the template string as-is for estimation
      }
    }
    
    // Handle Fn::If
    if ('Fn::If' in obj) {
      const ifExpr = obj['Fn::If'];
      if (Array.isArray(ifExpr) && ifExpr.length >= 2) {
        // Return the "true" branch value for estimation
        return this.resolveBasicIntrinsics(template, ifExpr[1], context);
      }
    }
    
    // Handle Fn::Select
    if ('Fn::Select' in obj) {
      const selectExpr = obj['Fn::Select'];
      if (Array.isArray(selectExpr) && selectExpr.length === 2) {
        const index = selectExpr[0];
        const list = this.resolveBasicIntrinsics(template, selectExpr[1], context);
        if (typeof index === 'number' && Array.isArray(list)) {
          return list[index];
        }
      }
    }
    
    // Recursively resolve object properties
    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      resolved[key] = this.resolveBasicIntrinsics(template, val, context);
    }
    
    return resolved;
  }
  
  /**
   * Extract a property value from a resource, handling intrinsic functions
   */
  static getPropertyValue(
    template: CloudFormationTemplate,
    resource: CloudFormationResource,
    propertyPath: string,
    defaultValue?: unknown
  ): unknown {
    const properties = resource.Properties || {};
    const parts = propertyPath.split('.');
    let value: unknown = properties;
    
    for (const part of parts) {
      if (value === null || value === undefined || typeof value !== 'object') {
        return defaultValue;
      }
      value = (value as Record<string, unknown>)[part];
    }
    
    if (value === undefined) {
      return defaultValue;
    }
    
    return this.resolveBasicIntrinsics(template, value);
  }
  
  /**
   * Compare two templates and identify resource changes
   */
  static compareTemplates(
    before: CloudFormationTemplate,
    after: CloudFormationTemplate
  ): {
    added: Map<string, CloudFormationResource>;
    removed: Map<string, CloudFormationResource>;
    modified: Map<string, { before: CloudFormationResource; after: CloudFormationResource }>;
    unchanged: Map<string, CloudFormationResource>;
  } {
    const beforeResources = this.extractResources(before);
    const afterResources = this.extractResources(after);
    
    const added = new Map<string, CloudFormationResource>();
    const removed = new Map<string, CloudFormationResource>();
    const modified = new Map<string, { before: CloudFormationResource; after: CloudFormationResource }>();
    const unchanged = new Map<string, CloudFormationResource>();
    
    // Find added and modified resources
    for (const [logicalId, afterResource] of afterResources) {
      const beforeResource = beforeResources.get(logicalId);
      
      if (!beforeResource) {
        added.set(logicalId, afterResource);
      } else if (this.resourcesChanged(beforeResource, afterResource)) {
        modified.set(logicalId, { before: beforeResource, after: afterResource });
      } else {
        unchanged.set(logicalId, afterResource);
      }
    }
    
    // Find removed resources
    for (const [logicalId, beforeResource] of beforeResources) {
      if (!afterResources.has(logicalId)) {
        removed.set(logicalId, beforeResource);
      }
    }
    
    return { added, removed, modified, unchanged };
  }
  
  /**
   * Check if two resources have changed (deep comparison of properties)
   */
  private static resourcesChanged(before: CloudFormationResource, after: CloudFormationResource): boolean {
    // Different types means definitely changed
    if (before.Type !== after.Type) {
      return true;
    }
    
    // Compare properties
    const beforeProps = JSON.stringify(before.Properties || {});
    const afterProps = JSON.stringify(after.Properties || {});
    
    return beforeProps !== afterProps;
  }
}

