/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ImportManager} from '@angular/compiler-cli/private/migrations';
import ts from 'typescript';
import {
  confirmAsSerializable,
  ProgramInfo,
  projectFile,
  ProjectFile,
  Replacement,
  Serializable,
  TextUpdate,
  TsurgeFunnelMigration,
} from '../../utils/tsurge';
import {applyImportManagerChanges} from '../../utils/tsurge/helpers/apply_import_manager';
import {getImportSpecifier} from '../../utils/typescript/imports';

const PLATFORM_BROWSER = '@angular/platform-browser';
const PROVIDE_CLIENT_HYDRATION = 'provideClientHydration';
const WITH_INCREMENTAL_HYDRATION = 'withIncrementalHydration';
const WITH_NO_INCREMENTAL_HYDRATION = 'withNoIncrementalHydration';
const WITH_EVENT_REPLAY = 'withEventReplay';

export interface CompilationUnitData {
  replacements: Replacement[];
}

/**
 * Prior to v22, `provideClientHydration()` did not include incremental hydration
 * by default. In v22, incremental hydration is enabled by default.
 *
 * This migration:
 * - Adds `withNoIncrementalHydration()` to `provideClientHydration()` calls that
 *   don't already have `withIncrementalHydration()` or `withNoIncrementalHydration()`,
 *   to preserve the previous behavior.
 * - Removes explicit `withIncrementalHydration()` calls since they are now redundant.
 * - Removes `withEventReplay()` when `withIncrementalHydration()` was present, since
 *   incremental hydration automatically enables event replay.
 */
export class ProvideIncrementalHydrationMigration extends TsurgeFunnelMigration<
  CompilationUnitData,
  CompilationUnitData
> {
  constructor(private readonly config: {shouldMigrate?: (file: ProjectFile) => boolean} = {}) {
    super();
  }

  override async analyze(info: ProgramInfo): Promise<Serializable<CompilationUnitData>> {
    const replacements: Replacement[] = [];
    const importManager = new ImportManager();

    for (const sourceFile of info.sourceFiles) {
      const file = projectFile(sourceFile, info);

      if (this.config.shouldMigrate && !this.config.shouldMigrate(file)) {
        continue;
      }

      const walk = (node: ts.Node): void => {
        node.forEachChild(walk);

        if (!ts.isCallExpression(node)) return;
        if (!ts.isIdentifier(node.expression)) return;
        if (node.expression.text !== PROVIDE_CLIENT_HYDRATION) return;

        if (!getImportSpecifier(sourceFile, PLATFORM_BROWSER, PROVIDE_CLIENT_HYDRATION)) {
          return;
        }

        const withIncrementalHydrationArg = findCallArgument(node, WITH_INCREMENTAL_HYDRATION);
        const withNoIncrementalHydrationArg = findCallArgument(node, WITH_NO_INCREMENTAL_HYDRATION);

        if (withIncrementalHydrationArg) {
          const argsToRemove = new Set<ts.Expression>([withIncrementalHydrationArg]);
          const withEventReplayArg = findCallArgument(node, WITH_EVENT_REPLAY);
          if (withEventReplayArg) {
            argsToRemove.add(withEventReplayArg);
          }

          const remainingArgs = node.arguments.filter((arg) => !argsToRemove.has(arg));
          const newArgsText = remainingArgs.map((arg) => arg.getText()).join(', ');

          replacements.push(
            new Replacement(
              file,
              new TextUpdate({
                position: node.arguments.pos,
                end: node.arguments.end,
                toInsert: newArgsText,
              }),
            ),
          );

          importManager.removeImport(sourceFile, WITH_INCREMENTAL_HYDRATION, PLATFORM_BROWSER);
          if (withEventReplayArg) {
            importManager.removeImport(sourceFile, WITH_EVENT_REPLAY, PLATFORM_BROWSER);
          }
        } else if (!withNoIncrementalHydrationArg) {
          replacements.push(
            new Replacement(
              file,
              new TextUpdate({
                position: node.arguments.pos,
                end: node.arguments.pos,
                toInsert: node.arguments.length
                  ? 'withNoIncrementalHydration(), '
                  : 'withNoIncrementalHydration()',
              }),
            ),
          );
          importManager.addImport({
            exportModuleSpecifier: PLATFORM_BROWSER,
            exportSymbolName: WITH_NO_INCREMENTAL_HYDRATION,
            requestedFile: sourceFile,
          });
        }
      };
      sourceFile.forEachChild(walk);
    }

    applyImportManagerChanges(importManager, replacements, info.sourceFiles, info);
    return confirmAsSerializable({replacements});
  }

  override async combine(
    unitA: CompilationUnitData,
    unitB: CompilationUnitData,
  ): Promise<Serializable<CompilationUnitData>> {
    return confirmAsSerializable({
      replacements: [...unitA.replacements, ...unitB.replacements],
    });
  }

  override async globalMeta(data: CompilationUnitData): Promise<Serializable<CompilationUnitData>> {
    return confirmAsSerializable(data);
  }

  override async stats(data: CompilationUnitData) {
    return confirmAsSerializable({});
  }

  override async migrate(data: CompilationUnitData) {
    return {replacements: data.replacements};
  }
}

function findCallArgument(call: ts.CallExpression, name: string): ts.Expression | undefined {
  return call.arguments.find((arg) => {
    return (
      ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === name
    );
  });
}
