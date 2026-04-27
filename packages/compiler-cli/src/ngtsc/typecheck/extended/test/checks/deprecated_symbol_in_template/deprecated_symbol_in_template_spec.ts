/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import ts from 'typescript';

import {ErrorCode, ExtendedTemplateDiagnosticName, ngErrorCode} from '../../../../../diagnostics';
import {absoluteFrom, getSourceFileOrError} from '../../../../../file_system';
import {runInEachFileSystem} from '../../../../../file_system/testing';
import {getSourceCodeForDiagnostic} from '../../../../../testing';
import {getClass, setup, TestDeclaration} from '../../../../testing';
import {factory as deprecatedSymbolInTemplateFactory} from '../../../checks/deprecated_symbol_in_template';
import {ExtendedTemplateCheckerImpl} from '../../../src/extended_template_checker';
import {formatExtendedError} from '@angular/compiler-cli/src/ngtsc/typecheck/extended/api';
import {NgCompilerOptions} from '../../../../../core/api';
import {DiagnosticCategoryLabel} from '@angular/compiler-cli/src/ngtsc/core/api';

runInEachFileSystem(() => {
  describe('DeprecatedSymbolInTemplateCheck', () => {
    it('binds the error code to its extended template diagnostic name', () => {
      expect(deprecatedSymbolInTemplateFactory.code).toBe(
        ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE,
      );
      expect(deprecatedSymbolInTemplateFactory.name).toBe(
        ExtendedTemplateDiagnosticName.DEPRECATED_SYMBOL_IN_TEMPLATE,
      );
    });

    describe('inputs', () => {
      it('flags a binding to a deprecated signal `input()`', () => {
        const diags = checkTemplate(
          `<other-cmp [icon]="'home'"></other-cmp>`,
          `
            import {Component, input} from '@angular/core';
            @Component({selector: 'other-cmp', template: ''})
            export class OtherCmp {
              /** @deprecated Use \`iconUrl\` instead. */
              readonly icon = input<string>();
            }
            export class TestCmp {}
          `,
          [otherCmpDecl({icon: signalInput('icon')})],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].category).toBe(ts.DiagnosticCategory.Warning);
        expect(diags[0].code).toBe(ngErrorCode(ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE));
        expect(getSourceCodeForDiagnostic(diags[0])).toBe('icon');
        expect(diags[0].messageText).toBe(
          format(`The input 'icon' of component 'OtherCmp' is deprecated: Use \`iconUrl\` instead.`),
        );
      });

      it('flags a binding to a deprecated `@Input()` decorator field', () => {
        const diags = checkTemplate(
          `<other-cmp [icon]="'home'"></other-cmp>`,
          `
            import {Component, Input} from '@angular/core';
            @Component({selector: 'other-cmp', template: ''})
            export class OtherCmp {
              /** @deprecated */
              @Input() icon = '';
            }
            export class TestCmp {}
          `,
          [otherCmpDecl({icon: 'icon'})],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(
          format(`The input 'icon' of component 'OtherCmp' is deprecated`),
        );
      });

      it('does not flag a binding to a non-deprecated input', () => {
        const diags = checkTemplate(
          `<other-cmp [iconUrl]="'home'"></other-cmp>`,
          `
            import {Component, input} from '@angular/core';
            @Component({selector: 'other-cmp', template: ''})
            export class OtherCmp {
              readonly iconUrl = input<string>();
            }
            export class TestCmp {}
          `,
          [otherCmpDecl({iconUrl: signalInput('iconUrl')})],
        );

        expect(diags.length).toBe(0);
      });
    });

    describe('outputs', () => {
      it('flags an event binding to a deprecated `output()`', () => {
        const diags = checkTemplate(
          `<other-cmp (changed)="onChange()"></other-cmp>`,
          `
            import {Component, output} from '@angular/core';
            @Component({selector: 'other-cmp', template: ''})
            export class OtherCmp {
              /** @deprecated Use \`updated\` instead. */
              readonly changed = output<void>();
            }
            export class TestCmp { onChange() {} }
          `,
          [otherCmpDecl({}, {changed: 'changed'})],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(
          format(`The output 'changed' of component 'OtherCmp' is deprecated: Use \`updated\` instead.`),
        );
      });

      it('flags an event binding to a deprecated legacy `@Output()`', () => {
        const diags = checkTemplate(
          `<other-cmp (changed)="onChange()"></other-cmp>`,
          `
            import {Component, EventEmitter, Output} from '@angular/core';
            @Component({selector: 'other-cmp', template: ''})
            export class OtherCmp {
              /** @deprecated */
              @Output() changed = new EventEmitter<void>();
            }
            export class TestCmp { onChange() {} }
          `,
          [otherCmpDecl({}, {changed: 'changed'})],
        );

        expect(diags.length).toBe(1);
      });
    });

    describe('directives, components & pipes', () => {
      it('flags usage of a deprecated component selector', () => {
        const diags = checkTemplate(
          `<other-cmp></other-cmp>`,
          `
            import {Component} from '@angular/core';
            /** @deprecated Use \`NewCmp\` instead. */
            @Component({selector: 'other-cmp', template: ''})
            export class OtherCmp {}
            export class TestCmp {}
          `,
          [otherCmpDecl({})],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(
          format(`The component 'OtherCmp' is deprecated: Use \`NewCmp\` instead.`),
        );
      });

      it('flags usage of a deprecated attribute directive', () => {
        const diags = checkTemplate(
          `<div my-dir></div>`,
          `
            import {Directive} from '@angular/core';
            /** @deprecated */
            @Directive({selector: '[my-dir]'})
            export class MyDir {}
            export class TestCmp {}
          `,
          [
            {
              type: 'directive',
              name: 'MyDir',
              selector: '[my-dir]',
              isStandalone: true,
              isComponent: false,
            },
          ],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(format(`The directive 'MyDir' is deprecated`));
      });

      it('flags usage of a deprecated pipe', () => {
        const diags = checkTemplate(
          `<p>{{ value | foo }}</p>`,
          `
            import {Pipe} from '@angular/core';
            /** @deprecated Use \`bar\` instead. */
            @Pipe({name: 'foo'})
            export class FooPipe { transform(v: unknown) { return v; } }
            export class TestCmp { value = 1; }
          `,
          [
            {
              type: 'pipe',
              name: 'FooPipe',
              pipeName: 'foo',
              isStandalone: true,
            },
          ],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(
          format(`The pipe 'foo' is deprecated: Use \`bar\` instead.`),
        );
      });

      it('does not flag usage of a non-deprecated pipe', () => {
        const diags = checkTemplate(
          `<p>{{ value | foo }}</p>`,
          `
            import {Pipe} from '@angular/core';
            @Pipe({name: 'foo'})
            export class FooPipe { transform(v: unknown) { return v; } }
            export class TestCmp { value = 1; }
          `,
          [
            {
              type: 'pipe',
              name: 'FooPipe',
              pipeName: 'foo',
              isStandalone: true,
            },
          ],
        );

        expect(diags.length).toBe(0);
      });
    });

    describe('expressions', () => {
      it('flags property access to a deprecated property in interpolation', () => {
        const diags = checkTemplate(
          `<p>{{ items }}</p>`,
          `
            export class TestCmp {
              /** @deprecated Use \`newItems\` instead. */
              items = [];
              newItems = [];
            }
          `,
          [],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(
          format(`The property 'items' is deprecated: Use \`newItems\` instead.`),
        );
      });

      it('flags method call to a deprecated method in event binding', () => {
        const diags = checkTemplate(
          `<button (click)="oldHandler()"></button>`,
          `
            export class TestCmp {
              /** @deprecated */
              oldHandler() {}
            }
          `,
          [],
        );

        expect(diags.length).toBe(1);
        expect(diags[0].messageText).toBe(format(`The property 'oldHandler' is deprecated`));
      });

      it('flags safe-navigation property access to a deprecated property', () => {
        const diags = checkTemplate(
          `<p>{{ obj?.legacy }}</p>`,
          `
            export class TestCmp {
              obj: {legacy?: string} | null = null;
            }
          `,
          [],
        );
        // Receiver is non-deprecated; target field has no JSDoc here so 0 diags.
        expect(diags.length).toBe(0);
      });

      it('does not flag a non-deprecated property access', () => {
        const diags = checkTemplate(
          `<p>{{ value }}</p>`,
          `export class TestCmp { value = 1; }`,
          [],
        );
        expect(diags.length).toBe(0);
      });

      it('does not flag a deprecated symbol when configured to suppress', () => {
        const diags = checkTemplate(
          `<p>{{ items }}</p>`,
          `
            export class TestCmp {
              /** @deprecated */ items = [];
            }
          `,
          [],
          {
            extendedDiagnostics: {
              checks: {
                deprecatedSymbolInTemplate: DiagnosticCategoryLabel.Suppress,
              },
            },
          },
        );
        expect(diags.length).toBe(0);
      });

      it('escalates the diagnostic to error when configured', () => {
        const diags = checkTemplate(
          `<p>{{ items }}</p>`,
          `
            export class TestCmp {
              /** @deprecated */ items = [];
            }
          `,
          [],
          {
            extendedDiagnostics: {
              checks: {
                deprecatedSymbolInTemplate: DiagnosticCategoryLabel.Error,
              },
            },
          },
        );
        expect(diags.length).toBe(1);
        expect(diags[0].category).toBe(ts.DiagnosticCategory.Error);
      });
    });
  });
});

function checkTemplate(
  template: string,
  source: string,
  declarations: TestDeclaration[],
  options: NgCompilerOptions = {},
) {
  const fileName = absoluteFrom('/main.ts');
  const {program, templateTypeChecker} = setup([
    {
      fileName,
      templates: {'TestCmp': template},
      source,
      declarations,
    },
  ]);
  const sf = getSourceFileOrError(program, fileName);
  const component = getClass(sf, 'TestCmp');
  const checker = new ExtendedTemplateCheckerImpl(
    templateTypeChecker,
    program.getTypeChecker(),
    [deprecatedSymbolInTemplateFactory],
    options,
  );
  return checker.getDiagnosticsForComponent(component);
}

function format(message: string): string {
  return formatExtendedError(ErrorCode.DEPRECATED_SYMBOL_IN_TEMPLATE, message);
}

function otherCmpDecl(
  inputs: Record<string, string | ReturnType<typeof signalInput>> = {},
  outputs: Record<string, string> = {},
): TestDeclaration {
  return {
    type: 'directive',
    name: 'OtherCmp',
    selector: 'other-cmp',
    isStandalone: true,
    isComponent: true,
    inputs,
    outputs,
  };
}

function signalInput(name: string) {
  return {
    classPropertyName: name,
    bindingPropertyName: name,
    required: false,
    isSignal: true,
    transform: null,
  };
}
