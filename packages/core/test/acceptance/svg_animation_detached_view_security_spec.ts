/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  Component,
  NO_ERRORS_SCHEMA,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';

describe('SVG animation validation for detached embedded views', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does not revalidate a MathML view after it is inserted under SVG', () => {
    const unsafeValue = 'javascript:globalThis.__angularDetachedViewXss = 1';

    @Component({
      schemas: [NO_ERRORS_SCHEMA],
      template: `
        <math>
          <ng-template #payload let-value>
            <set attributeName="href" [attr.to]="value"></set>
          </ng-template>
        </math>

        <svg>
          <a id="target" href="#">
            <ng-container #slot></ng-container>
            <text>click</text>
          </a>
        </svg>
      `,
    })
    class TestCmp {
      @ViewChild('payload', {read: TemplateRef})
      payload!: TemplateRef<{$implicit: string}>;

      @ViewChild('slot', {read: ViewContainerRef})
      slot!: ViewContainerRef;
    }

    const fixture = TestBed.createComponent(TestCmp);
    fixture.detectChanges();

    const view = fixture.componentInstance.payload.createEmbeddedView({
      $implicit: unsafeValue,
    });

    // The binding is committed while the element is detached and therefore has no SVG ancestor.
    expect(() => view.detectChanges()).not.toThrow();
    const detachedSet = view.rootNodes[0] as Element;
    expect(detachedSet.closest('svg')).toBeNull();
    expect(detachedSet.getAttribute('to')).toBe(unsafeValue);

    // insert() moves the existing nodes without re-running the binding instruction. A later change
    // detection pass also skips the validator because the binding value is unchanged.
    fixture.componentInstance.slot.insert(view);
    expect(() => fixture.detectChanges()).not.toThrow();

    const insertedSet = fixture.nativeElement.querySelector('set') as Element;
    expect(insertedSet.closest('svg')).not.toBeNull();
    expect(insertedSet.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    expect(insertedSet.getAttribute('attributeName')).toBe('href');
    expect(insertedSet.getAttribute('to')).toBe(unsafeValue);
    expect(fixture.nativeElement.innerHTML).toContain(`to="${unsafeValue}"`);
  });
});
