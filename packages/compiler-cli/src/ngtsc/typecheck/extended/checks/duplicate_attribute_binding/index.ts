/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  AST,
  BindingType,
  TmplAstBoundAttribute,
  TmplAstElement,
  TmplAstNode,
  TmplAstTextAttribute,
} from '@angular/compiler';
import ts from 'typescript';

import {ErrorCode, ExtendedTemplateDiagnosticName} from '../../../../diagnostics';
import {NgTemplateDiagnostic} from '../../../api';
import {TemplateCheckFactory, TemplateCheckWithVisitor, TemplateContext} from '../../api';

/**
 * Ensures that multiple bindings do not target the same HTML attribute or class.
 * Only the last binding will take effect, which may lead to unexpected behavior.
 *
 * Detects conflicts between:
 * - Static HTML attributes and [attr.X] bindings (e.g., id="static" and [attr.id]="dynamic")
 * - [attr.id] and [id] (both target the 'id' attribute)
 * - [attr.class] and any class binding like [class] or [class.foo]
 *
 * Does NOT flag [class] and [class.foo] as conflicting (they work together).
 */
class DuplicateAttributeBindingCheck extends TemplateCheckWithVisitor<ErrorCode.DUPLICATE_ATTRIBUTE_BINDING> {
  override code = ErrorCode.DUPLICATE_ATTRIBUTE_BINDING as const;

  override visitNode(
    ctx: TemplateContext<ErrorCode.DUPLICATE_ATTRIBUTE_BINDING>,
    component: ts.ClassDeclaration,
    node: TmplAstNode | AST,
  ): NgTemplateDiagnostic<ErrorCode.DUPLICATE_ATTRIBUTE_BINDING>[] {
    // We need to work with TmplAstElement to get all its inputs and attributes
    if (!(node instanceof TmplAstElement)) {
      return [];
    }

    const diagnostics: NgTemplateDiagnostic<ErrorCode.DUPLICATE_ATTRIBUTE_BINDING>[] = [];

    // Build maps of different binding types
    const attrBindings = new Map<string, TmplAstBoundAttribute[]>();
    const propBindings = new Map<string, TmplAstBoundAttribute[]>();
    const classBindings: TmplAstBoundAttribute[] = [];
    const staticAttributes = new Map<string, TmplAstTextAttribute[]>();

    // Categorize all dynamic bindings from inputs
    if (node.inputs) {
      for (const input of node.inputs) {
        switch (input.type) {
          case BindingType.Attribute:
            // For attribute bindings, the name is already the attribute name (no 'attr.' prefix)
            const attrName = input.name;
            if (!attrBindings.has(attrName)) {
              attrBindings.set(attrName, []);
            }
            attrBindings.get(attrName)!.push(input);
            break;

          case BindingType.Property:
            if (!propBindings.has(input.name)) {
              propBindings.set(input.name, []);
            }
            propBindings.get(input.name)!.push(input);
            break;

          case BindingType.Class:
            classBindings.push(input);
            break;
        }
      }
    }

    // Categorize all static attributes
    if (node.attributes) {
      for (const attr of node.attributes) {
        if (!staticAttributes.has(attr.name)) {
          staticAttributes.set(attr.name, []);
        }
        staticAttributes.get(attr.name)!.push(attr);
      }
    }

    // Check for conflicts between static attributes and [attr.X] bindings
    for (const [staticAttrName, staticAttrs] of staticAttributes) {
      const attrBindingsForSameName = attrBindings.get(staticAttrName);
      if (attrBindingsForSameName) {
        // Found conflict: both static attribute and [attr.X] exist for the same attribute
        // Report the static attribute as conflicting (it will be overridden)
        for (const staticAttr of staticAttrs) {
          const errorMessage = `This element has multiple bindings targeting the same HTML attribute or class '${staticAttrName}'. Only the last binding will take effect, which may lead to unexpected behavior.`;
          diagnostics.push(ctx.makeTemplateDiagnostic(staticAttr.sourceSpan, errorMessage));
        }
      }
    }

    // Check for conflicts between [attr.X] and [X]
    for (const [attrName, attrs] of attrBindings) {
      const props = propBindings.get(attrName);
      if (props) {
        // Found conflict: both [attr.X] and [X] exist
        const allBindings = [...attrs, ...props].sort(
          (a, b) => a.sourceSpan.start.offset - b.sourceSpan.start.offset,
        );

        // Report all but the last binding
        for (let i = 0; i < allBindings.length - 1; i++) {
          const binding = allBindings[i];
          const errorMessage = `This element has multiple bindings targeting the same HTML attribute or class '${attrName}'. Only the last binding will take effect, which may lead to unexpected behavior.`;
          diagnostics.push(ctx.makeTemplateDiagnostic(binding.sourceSpan, errorMessage));
        }
      }
    }

    // Check for conflicts between [attr.class] and any class bindings
    const attrClassBindings = attrBindings.get('class');
    if (attrClassBindings && classBindings.length > 0) {
      const allClassBindings = [...attrClassBindings, ...classBindings].sort(
        (a, b) => a.sourceSpan.start.offset - b.sourceSpan.start.offset,
      );

      // Report all but the last binding
      for (let i = 0; i < allClassBindings.length - 1; i++) {
        const binding = allClassBindings[i];
        const errorMessage = `This element has multiple bindings targeting the same HTML attribute or class 'class'. Only the last binding will take effect, which may lead to unexpected behavior.`;
        diagnostics.push(ctx.makeTemplateDiagnostic(binding.sourceSpan, errorMessage));
      }
    }

    // Check for duplicate property bindings (e.g., multiple [id])
    for (const [propName, props] of propBindings) {
      if (props.length > 1) {
        props.sort((a, b) => a.sourceSpan.start.offset - b.sourceSpan.start.offset);

        // Report all but the last binding
        for (let i = 0; i < props.length - 1; i++) {
          const binding = props[i];
          const errorMessage = `This element has multiple bindings targeting the same HTML attribute or class '${propName}'. Only the last binding will take effect, which may lead to unexpected behavior.`;
          diagnostics.push(ctx.makeTemplateDiagnostic(binding.sourceSpan, errorMessage));
        }
      }
    }

    // Check for duplicate attribute bindings (e.g., multiple [attr.id])
    for (const [attrName, attrs] of attrBindings) {
      if (attrs.length > 1) {
        attrs.sort((a, b) => a.sourceSpan.start.offset - b.sourceSpan.start.offset);

        // Report all but the last binding
        for (let i = 0; i < attrs.length - 1; i++) {
          const binding = attrs[i];
          const errorMessage = `This element has multiple bindings targeting the same HTML attribute or class '${attrName}'. Only the last binding will take effect, which may lead to unexpected behavior.`;
          diagnostics.push(ctx.makeTemplateDiagnostic(binding.sourceSpan, errorMessage));
        }
      }
    }

    return diagnostics;
  }
}

export const factory: TemplateCheckFactory<
  ErrorCode.DUPLICATE_ATTRIBUTE_BINDING,
  ExtendedTemplateDiagnosticName.DUPLICATE_ATTRIBUTE_BINDING
> = {
  code: ErrorCode.DUPLICATE_ATTRIBUTE_BINDING,
  name: ExtendedTemplateDiagnosticName.DUPLICATE_ATTRIBUTE_BINDING,
  create: () => new DuplicateAttributeBindingCheck(),
};
