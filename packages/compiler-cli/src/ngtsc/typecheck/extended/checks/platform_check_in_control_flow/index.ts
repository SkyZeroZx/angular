/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  AST,
  PropertyRead,
  RecursiveAstVisitor,
  SafePropertyRead,
  TmplAstForLoopBlock,
  TmplAstIfBlockBranch,
  TmplAstNode,
  TmplAstSwitchBlock,
  TmplAstSwitchBlockCase,
} from '@angular/compiler';
import ts from 'typescript';

import {ErrorCode, ExtendedTemplateDiagnosticName} from '../../../../diagnostics';
import {NgTemplateDiagnostic, SymbolKind} from '../../../api';
import {
  TemplateCheckFactory,
  TemplateCheckWithVisitor,
  TemplateContext,
  formatExtendedError,
} from '../../api';

const PLATFORM_CHECK_NAMES: ReadonlySet<string> = new Set([
  'isPlatformBrowser',
  'isPlatformServer',
]);

const COMMON_PACKAGE_PATH_FRAGMENT = '@angular/common';

/**
 * Detects usage of `isPlatformBrowser` or `isPlatformServer` (from `@angular/common`)
 * inside the condition of a control flow block (`@if`, `@switch`, `@for`).
 *
 * While this pattern hydrates correctly, it causes a brief flash of the server-rendered
 * branch followed by a re-render of the client branch once hydration completes,
 * resulting in a poor user experience.
 */
class PlatformCheckInControlFlowCheck extends TemplateCheckWithVisitor<ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW> {
  override code = ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW as const;

  override visitNode(
    ctx: TemplateContext<ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW>,
    component: ts.ClassDeclaration,
    node: TmplAstNode | AST,
  ): NgTemplateDiagnostic<ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW>[] {
    const expression = getControlFlowExpression(node);
    if (expression === null) {
      return [];
    }

    const visitor = new PropertyReadFinder();
    expression.visit(visitor);

    return visitor.propertyReads.flatMap((receiver) =>
      buildDiagnosticForReceiver(ctx, component, receiver),
    );
  }
}

/** Returns the condition expression of a control flow block, or `null` if `node` isn't one. */
function getControlFlowExpression(node: TmplAstNode | AST): AST | null {
  if (node instanceof TmplAstIfBlockBranch) {
    return node.expression;
  }
  if (node instanceof TmplAstSwitchBlock) {
    return node.expression;
  }
  if (node instanceof TmplAstSwitchBlockCase) {
    return node.expression;
  }
  if (node instanceof TmplAstForLoopBlock) {
    return node.expression;
  }
  return null;
}

/** Recursive AST visitor that collects every `PropertyRead` / `SafePropertyRead` it sees. */
class PropertyReadFinder extends RecursiveAstVisitor {
  readonly propertyReads: Array<PropertyRead | SafePropertyRead> = [];

  override visitPropertyRead(ast: PropertyRead, context: unknown): unknown {
    this.propertyReads.push(ast);
    return super.visitPropertyRead(ast, context);
  }

  override visitSafePropertyRead(ast: SafePropertyRead, context: unknown): unknown {
    this.propertyReads.push(ast);
    return super.visitSafePropertyRead(ast, context);
  }
}

/**
 * Builds a diagnostic for the given `PropertyRead` / `SafePropertyRead` if its symbol
 * resolves to one of the platform-check exports of `@angular/common`.
 */
function buildDiagnosticForReceiver(
  ctx: TemplateContext<ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW>,
  component: ts.ClassDeclaration,
  receiver: PropertyRead | SafePropertyRead,
): NgTemplateDiagnostic<ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW>[] {
  const symbol = ctx.templateTypeChecker.getSymbolOfNode(receiver, component);

  if (symbol === null || symbol.kind !== SymbolKind.Expression) {
    return [];
  }

  const tsSymbol = ctx.templateTypeChecker.getTsSymbolOfSymbol(symbol);
  if (tsSymbol === null) {
    return [];
  }

  const platformCheckName = resolveImportedPlatformCheckName(tsSymbol, ctx.typeChecker);
  if (platformCheckName === null) {
    return [];
  }

  const templateMapping = ctx.templateTypeChecker.getSourceMappingAtTcbLocation(
    symbol.tcbLocation,
  )!;
  const errorString = formatExtendedError(
    ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW,
    `Using ${platformCheckName} inside a control flow block (\`@if\`, \`@switch\`, \`@for\`) ` +
      `causes a flash of the server-rendered branch when used with hydration. ` +
      `Consider moving platform-specific logic outside of control flow ` +
      `(for example using \`afterNextRender\`) so the markup is consistent ` +
      `between server and client.`,
  );
  return [ctx.makeTemplateDiagnostic(templateMapping.span, errorString)];
}

/**
 * Walks a `ts.Symbol` (and the initializer of any class property declarations it points to)
 * to determine whether it ultimately resolves to the `isPlatformBrowser` /
 * `isPlatformServer` exports of `@angular/common`. Returns the canonical export name on a
 * match, or `null` when there is no match.
 */
function resolveImportedPlatformCheckName(
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): string | null {
  const visited = new Set<ts.Symbol>();
  let current: ts.Symbol | undefined = symbol;

  while (current !== undefined && !visited.has(current)) {
    visited.add(current);

    // If the current symbol is an alias (e.g. an import), unwrap it.
    if (current.flags & ts.SymbolFlags.Alias) {
      const aliased = typeChecker.getAliasedSymbol(current);
      if (aliased === current) {
        break;
      }
      current = aliased;
      continue;
    }

    // Direct match: a function declaration named `isPlatformBrowser` / `isPlatformServer`
    // declared in `@angular/common`.
    if (PLATFORM_CHECK_NAMES.has(current.getName()) && isFromAngularCommon(current)) {
      return current.getName();
    }

    // Class property whose initializer references a platform check. This covers the two
    // common patterns:
    //   `isPlatformBrowser = isPlatformBrowser;` (re-exposing the function for templates)
    //   `isBrowser = isPlatformBrowser(inject(PLATFORM_ID));` (storing the boolean result)
    // Methods and accessors are intentionally not unwrapped, so user-defined
    // `isPlatformBrowser(...)` methods are not flagged.
    const valueDeclaration = current.valueDeclaration;
    if (valueDeclaration !== undefined && ts.isPropertyDeclaration(valueDeclaration)) {
      const next = resolveSymbolFromInitializer(valueDeclaration.initializer, typeChecker);
      if (next !== undefined && !visited.has(next)) {
        current = next;
        continue;
      }
    }

    break;
  }

  return null;
}

/**
 * Returns the `ts.Symbol` referenced by a property declaration's initializer when the
 * initializer is a simple identifier or a call expression whose callee is an identifier
 * (or property access). Used to follow class-field aliases of platform checks.
 */
function resolveSymbolFromInitializer(
  initializer: ts.Expression | undefined,
  typeChecker: ts.TypeChecker,
): ts.Symbol | undefined {
  if (initializer === undefined) {
    return undefined;
  }

  if (ts.isIdentifier(initializer)) {
    return typeChecker.getSymbolAtLocation(initializer);
  }

  if (ts.isCallExpression(initializer)) {
    const callee = initializer.expression;

    if (ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee)) {
      return typeChecker.getSymbolAtLocation(callee);
    }
  }
  return undefined;
}

/** Returns whether any declaration of `symbol` lives inside the `@angular/common` package. */
function isFromAngularCommon(symbol: ts.Symbol): boolean {
  const declarations = symbol.getDeclarations();

  if (declarations === undefined) {
    return false;
  }

  return declarations.some((declaration) =>
    declaration.getSourceFile().fileName.includes(COMMON_PACKAGE_PATH_FRAGMENT),
  );
}

export const factory: TemplateCheckFactory<
  ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW,
  ExtendedTemplateDiagnosticName.PLATFORM_CHECK_IN_CONTROL_FLOW
> = {
  code: ErrorCode.PLATFORM_CHECK_IN_CONTROL_FLOW,
  name: ExtendedTemplateDiagnosticName.PLATFORM_CHECK_IN_CONTROL_FLOW,
  create: () => new PlatformCheckInControlFlowCheck(),
};
