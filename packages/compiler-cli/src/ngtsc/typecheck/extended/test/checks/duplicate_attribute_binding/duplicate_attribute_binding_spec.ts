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
import {getClass, setup} from '../../../../testing';
import {factory as duplicateAttributeBindingFactory} from '../../../checks/duplicate_attribute_binding';
import {ExtendedTemplateCheckerImpl} from '../../../src/extended_template_checker';

runInEachFileSystem(() => {
  describe('DuplicateAttributeBindingCheck', () => {
    it('binds the error code to its extended template diagnostic name', () => {
      expect(duplicateAttributeBindingFactory.code).toBe(ErrorCode.DUPLICATE_ATTRIBUTE_BINDING);
      expect(duplicateAttributeBindingFactory.name).toBe(
        ExtendedTemplateDiagnosticName.DUPLICATE_ATTRIBUTE_BINDING,
      );
    });

    it('should detect duplicate attribute bindings with [attr.id] and [id]', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div [attr.id]="dynamicId" [id]="'Custom latest'"></div>`,
          },
          source: 'export class TestCmp { dynamicId = "dynamicId"; }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(1);
      expect(diags[0].category).toBe(ts.DiagnosticCategory.Warning);
      expect(diags[0].code).toBe(ngErrorCode(ErrorCode.DUPLICATE_ATTRIBUTE_BINDING));
      expect(diags[0].messageText).toContain(
        "multiple bindings targeting the same HTML attribute or class 'id'",
      );
    });

    it('should detect duplicate class bindings', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div [attr.class]="'custom-class'" [class.primary]="'red'"></div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(1);
      expect(diags[0].category).toBe(ts.DiagnosticCategory.Warning);
      expect(diags[0].code).toBe(ngErrorCode(ErrorCode.DUPLICATE_ATTRIBUTE_BINDING));
      expect(diags[0].messageText).toContain(
        "multiple bindings targeting the same HTML attribute or class 'class'",
      );
    });

    it('should detect multiple duplicates on the same element', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div
                        [attr.class]="'custom-class'"
                        [class.primary]="'red'"
                        [attr.id]="'dynamicId'"
                        [id]="'Custom latest'">
                        </div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(2); // One for 'class' and one for 'id'
      expect(diags[0].category).toBe(ts.DiagnosticCategory.Warning);
      expect(diags[1].category).toBe(ts.DiagnosticCategory.Warning);
      expect(diags[0].code).toBe(ngErrorCode(ErrorCode.DUPLICATE_ATTRIBUTE_BINDING));
      expect(diags[1].code).toBe(ngErrorCode(ErrorCode.DUPLICATE_ATTRIBUTE_BINDING));
    });

    it('should not detect duplicates for style bindings', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div [style.width]="'100px'" [style.width.px]="'200'"></div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(0);
    });

    it('should not produce diagnostics for unique bindings', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div [id]="'id'" [class]="'class'" [title]="'title'"></div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(0);
    });

    it('should not flag [class] and [class.foo] as duplicates (valid Angular pattern)', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div [class]="'base-class'" [class.active]="true"></div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(0);
    });

    it('should detect static attributes conflicting with dynamic attribute bindings', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div id="AAA" [attr.id]="'BBBB'">Static</div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(1);
      expect(diags[0].category).toBe(ts.DiagnosticCategory.Warning);
      expect(diags[0].code).toBe(ngErrorCode(ErrorCode.DUPLICATE_ATTRIBUTE_BINDING));
      expect(diags[0].messageText).toContain(
        "multiple bindings targeting the same HTML attribute or class 'id'",
      );
    });

    it('should detect static class attributes conflicting with dynamic attribute bindings', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div class="static-class" [attr.class]="'dynamic-class'">Static</div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(1);
      expect(diags[0].category).toBe(ts.DiagnosticCategory.Warning);
      expect(diags[0].code).toBe(ngErrorCode(ErrorCode.DUPLICATE_ATTRIBUTE_BINDING));
      expect(diags[0].messageText).toContain(
        "multiple bindings targeting the same HTML attribute or class 'class'",
      );
    });

    it('should not flag static attributes with different dynamic bindings', () => {
      const fileName = absoluteFrom('/main.ts');
      const {program, templateTypeChecker} = setup([
        {
          fileName,
          templates: {
            'TestCmp': `<div id="static-id" [attr.data-id]="'dynamic'">Valid</div>`,
          },
          source: 'export class TestCmp { }',
        },
      ]);
      const sf = getSourceFileOrError(program, fileName);
      const component = getClass(sf, 'TestCmp');
      const extendedTemplateChecker = new ExtendedTemplateCheckerImpl(
        templateTypeChecker,
        program.getTypeChecker(),
        [duplicateAttributeBindingFactory],
        {} /* options */,
      );
      const diags = extendedTemplateChecker.getDiagnosticsForComponent(component);
      expect(diags.length).toBe(0);
    });
  });
});
