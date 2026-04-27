/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  AST,
  BindingPipe,
  ParseSourceSpan,
  PropertyRead,
  SafePropertyRead,
  TmplAstBoundAttribute,
  TmplAstBoundEvent,
  TmplAstComponent,
  TmplAstDirective,
  TmplAstElement,
  TmplAstNode,
  TmplAstTemplate,
} from '@angular/compiler';
import ts from 'typescript';

import {ErrorCode, ExtendedTemplateDiagnosticName} from '../../../../diagnostics';
import {
  BindingSymbol,
  DirectiveSymbol,
  ElementSymbol,
  NgTemplateDiagnostic,
  SymbolKind,
  TemplateSymbol,
  TypeCheckableDirectiveMeta,
} from '../../../api';
import {
  TemplateCheckFactory,
  TemplateCheckWithVisitor,
  TemplateContext,
  formatExtendedError,
} from '../../api';

/**
 * Ensures that templates do not reference symbols that have been marked as `@deprecated`
 * via JSDoc, including:
 *  - Bindings to `@deprecated` inputs / outputs / models.
 *  - Usages of `@deprecated` directives, components, or pipes.
 *  - Property or method access in template expressions targeting a `@deprecated` member.
 */
class DeprecatedSymbolInTemplateCheck extends TemplateCheckWithVisitor<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE> {
  override code = ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE as const;

  /**
   * Tracks `(symbol, span.start)` pairs already reported within a single component run
   * to avoid duplicate diagnostics for the same usage.
   */
  private reported = new Map<object, Set<number>>();

  override run(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    template: TmplAstNode[],
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    this.reported = new Map<object, Set<number>>();
    return super.run(ctx, component, template);
  }

  override visitNode(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    node: TmplAstNode | AST,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    if (node instanceof TmplAstElement || node instanceof TmplAstTemplate) {
      return this.checkDirectivesOnElement(ctx, component, node);
    }
    if (node instanceof TmplAstComponent || node instanceof TmplAstDirective) {
      return this.checkSelectorlessReference(ctx, component, node);
    }
    if (node instanceof TmplAstBoundAttribute) {
      return this.checkBoundAttribute(ctx, component, node);
    }
    if (node instanceof TmplAstBoundEvent) {
      return this.checkBoundEvent(ctx, component, node);
    }
    if (node instanceof BindingPipe) {
      return this.checkPipe(ctx, component, node);
    }
    if (node instanceof PropertyRead || node instanceof SafePropertyRead) {
      return this.checkPropertyRead(ctx, component, node);
    }
    return [];
  }

  private checkDirectivesOnElement(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    node: TmplAstElement | TmplAstTemplate,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    const directives = ctx.templateTypeChecker.getDirectivesOfNode(component, node);
    if (directives === null || directives.length === 0) return [];
    const span = node.startSourceSpan ?? node.sourceSpan;
    const diagnostics: NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] = [];
    for (const dir of directives) {
      const diag = this.diagnosticForDeprecatedDirective(ctx, dir, span);
      if (diag !== null) diagnostics.push(diag);
    }
    return diagnostics;
  }

  private checkSelectorlessReference(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    node: TmplAstComponent | TmplAstDirective,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    const symbol = ctx.templateTypeChecker.getSymbolOfNode(node, component);
    if (
      symbol === null ||
      (symbol.kind !== SymbolKind.SelectorlessComponent &&
        symbol.kind !== SymbolKind.SelectorlessDirective)
    ) {
      return [];
    }
    const span = node.startSourceSpan ?? node.sourceSpan;
    const diagnostics: NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] = [];
    for (const dir of symbol.directives) {
      const tsSymbol = ctx.templateTypeChecker.getTsSymbolOfSymbol(dir);
      const message = getDeprecationFromTsSymbol(tsSymbol);
      if (message === null) continue;
      const kind = dir.isComponent ? 'component' : 'directive';
      const diag = this.emit(
        ctx,
        tsSymbol!,
        span,
        `The ${kind} '${dir.ref.name}' is deprecated${formatMessage(message)}`,
      );
      if (diag !== null) diagnostics.push(diag);
    }
    return diagnostics;
  }

  private diagnosticForDeprecatedDirective(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    dir: TypeCheckableDirectiveMeta,
    span: ParseSourceSpan,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE> | null {
    const classNode = dir.ref.node as ts.Node;
    if (!ts.isClassDeclaration(classNode)) return null;
    const message = getDeprecationFromNode(classNode);
    if (message === null) return null;
    const className = classNode.name?.text ?? '<anonymous>';
    const kind = dir.isComponent ? 'component' : 'directive';
    return this.emit(
      ctx,
      classNode,
      span,
      `The ${kind} '${className}' is deprecated${formatMessage(message)}`,
    );
  }

  private checkBoundAttribute(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    node: TmplAstBoundAttribute,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    const symbol = ctx.templateTypeChecker.getSymbolOfNode(node, component);
    if (symbol === null || symbol.kind !== SymbolKind.Input) return [];
    return this.diagnosticsForBindings(ctx, symbol.bindings, node, 'input');
  }

  private checkBoundEvent(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    node: TmplAstBoundEvent,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    const symbol = ctx.templateTypeChecker.getSymbolOfNode(node, component);
    if (symbol === null || symbol.kind !== SymbolKind.Output) return [];
    return this.diagnosticsForBindings(ctx, symbol.bindings, node, 'output');
  }

  private diagnosticsForBindings(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    bindings: ReadonlyArray<BindingSymbol>,
    node: TmplAstBoundAttribute | TmplAstBoundEvent,
    memberKind: 'input' | 'output',
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    const span = node.keySpan ?? node.sourceSpan;
    const diagnostics: NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] = [];
    for (const binding of bindings) {
      const tsSymbol = ctx.templateTypeChecker.getTsSymbolOfSymbol(binding);
      const message = getDeprecationFromTsSymbol(tsSymbol);
      if (message === null) continue;
      const owner = describeBindingOwner(binding.target);
      const diag = this.emit(
        ctx,
        tsSymbol!,
        span,
        `The ${memberKind} '${node.name}'${owner ? ` of ${owner}` : ''} is deprecated${formatMessage(message)}`,
      );
      if (diag !== null) diagnostics.push(diag);
    }
    return diagnostics;
  }

  private checkPipe(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    node: BindingPipe,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    const symbol = ctx.templateTypeChecker.getSymbolOfNode(node, component);
    if (symbol === null || symbol.kind !== SymbolKind.Pipe) return [];
    const tsSymbol = ctx.templateTypeChecker.getTsSymbolOfSymbol(symbol.classSymbol);
    const message = getDeprecationFromTsSymbol(tsSymbol);
    if (message === null) return [];
    const span = ctx.templateTypeChecker.getSourceMappingAtTcbLocation(symbol.tcbLocation)?.span;
    if (!span) return [];
    const diag = this.emit(
      ctx,
      tsSymbol!,
      span,
      `The pipe '${node.name}' is deprecated${formatMessage(message)}`,
    );
    return diag !== null ? [diag] : [];
  }

  private checkPropertyRead(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    component: ts.ClassDeclaration,
    node: PropertyRead | SafePropertyRead,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>[] {
    const symbol = ctx.templateTypeChecker.getSymbolOfNode(node, component);
    if (symbol === null || symbol.kind !== SymbolKind.Expression) return [];
    const tsSymbol = ctx.templateTypeChecker.getTsSymbolOfSymbol(symbol);
    const message = getDeprecationFromTsSymbol(tsSymbol);
    if (message === null) return [];
    const span = ctx.templateTypeChecker.getSourceMappingAtTcbLocation(symbol.tcbLocation)?.span;
    if (!span) return [];
    const diag = this.emit(
      ctx,
      tsSymbol!,
      span,
      `The property '${node.name}' is deprecated${formatMessage(message)}`,
    );
    return diag !== null ? [diag] : [];
  }

  private emit(
    ctx: TemplateContext<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE>,
    key: object,
    span: ParseSourceSpan,
    message: string,
  ): NgTemplateDiagnostic<ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE> | null {
    let spans = this.reported.get(key);
    if (spans === undefined) {
      spans = new Set<number>();
      this.reported.set(key, spans);
    }
    if (spans.has(span.start.offset)) return null;
    spans.add(span.start.offset);
    return ctx.makeTemplateDiagnostic(
      span,
      formatExtendedError(ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE, message),
    );
  }
}

/** Describes the owner class of a binding, e.g. `component 'MyComponent'`. */
function describeBindingOwner(
  target: DirectiveSymbol | ElementSymbol | TemplateSymbol,
): string | null {
  if (target.kind !== SymbolKind.Directive) return null;
  const name = target.ref?.name;
  if (!name) return null;
  return `${target.isComponent ? 'component' : 'directive'} '${name}'`;
}

function formatMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? `: ${trimmed}` : '';
}

/**
 * Returns the deprecation comment text for a `ts.Node` if it has a `@deprecated` JSDoc
 * tag, the empty string if the tag is present without a comment, or `null` otherwise.
 */
function getDeprecationFromNode(node: ts.Node): string | null {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text === 'deprecated') {
      return getJsDocCommentText(tag.comment);
    }
  }
  return null;
}

/** Returns the deprecation message from any of a `ts.Symbol`'s declarations. */
function getDeprecationFromTsSymbol(symbol: ts.Symbol | null | undefined): string | null {
  if (!symbol) return null;
  const decls = symbol.getDeclarations();
  if (!decls) return null;
  for (const decl of decls) {
    const message = getDeprecationFromNode(decl);
    if (message !== null) return message;
  }
  return null;
}

function getJsDocCommentText(
  comment: string | ts.NodeArray<ts.JSDocComment> | undefined,
): string {
  if (comment === undefined) return '';
  if (typeof comment === 'string') return comment;
  return comment.map((part) => part.text).join('');
}

export const factory: TemplateCheckFactory<
  ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE,
  ExtendedTemplateDiagnosticName.DEPRECATED_SYMBOL_IN_TEMPLATE
> = {
  code: ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE,
  name: ExtendedTemplateDiagnosticName.DEPRECATED_SYMBOL_IN_TEMPLATE,
  create: () => new DeprecatedSymbolInTemplateCheck(),
};
