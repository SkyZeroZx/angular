# Templates

Angular compiles templates instead of evaluating arbitrary HTML. Keep bindings declarative, read
changing state from signals, and move non-trivial calculations into `computed`.

## Bindings

```angular-html
<h1>{{ title() }}</h1>
<button [disabled]="saving()" [attr.data-state]="state()" [aria-label]="actionLabel()">Save</button>
<section [class.selected]="selected()" [style.width.px]="width()">...</section>
```

- Use interpolation for text and `[property]` for DOM properties and component or directive
  inputs.
- Use `[attr.name]` only when there is no corresponding DOM property, including SVG attributes.
  A `null` value removes the attribute.
- Bind ARIA attributes directly, such as `[aria-label]`.
- Use `[class.name]` and `[style.property.unit]` for individual values. When binding a class array,
  class object, or style object, replace the array or object instead of mutating it because Angular
  compares its identity.

## Events

```angular-html
<button (click)="select(item)">Select</button>
<input (keyup.enter)="search($event)" />
<input (keydown.code.alt.shiftleft)="selectPrevious($event)" />
```

- `$event` is the native or directive event value; type the receiving method accordingly.
- Use key and modifier filters instead of reimplementing them inside the handler.
- Call `event.preventDefault()` explicitly when replacing native browser behavior.

## Two-way binding

Use `[()]` when both sides intentionally share ownership of a value. A child component exposes a
two-way binding with `model`:

```ts
export class Counter {
  count = model(0);
}
```

```angular-html
<app-counter [(count)]="count" />
```

For native form controls, `[(ngModel)]` requires `FormsModule`. Follow the form strategy already
used by the application instead of introducing `ngModel` only for convenience.

## Variables

```angular-html
@let user = currentUser();

@if (user) {
  <user-avatar [photo]="user.photo" />
}

<input #query />
<button (click)="search(query.value)">Search</button>
```

- `@let` tracks its expression but cannot be reassigned. Declare one variable at a time and end
  the declaration with `;`.
- `@let` is not hoisted. Both `@let` and `#ref` are scoped to their view. Plain DOM elements do
  not create views; control flow blocks and template fragments do.
- A template reference can point to a DOM element, component, `TemplateRef`, or a directive
  selected with its `exportAs` name.

## Template fragments

`<ng-template>` declares content without rendering it. Render a fragment declaratively with
`NgTemplateOutlet`, usually on an `<ng-container>`:

```angular-html
<ng-template #row let-item="item">
  <span>{{ item.name }}</span>
</ng-template>

<ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{item: selectedItem()}" />
```

Import `NgTemplateOutlet` in the component. Fragment bindings use the component context where the
fragment is declared. By default, the embedded view also uses the declaration injector rather
than the outlet injector. `<ng-container>` does not create a DOM element; do not put DOM property,
attribute, style, or event bindings on it.

## Expressions

- Template expressions run in the component context plus the current template variables. Use
  `this.` only to disambiguate a class member shadowed by a template variable.
- Do not generate declarations, arrow functions, `new`, destructuring, or references to globals
  such as `Math` or `Date`. Expose required values or helpers from the component.
- Keep bindings free of side effects. Event statements may assign values but cannot use pipes.
- In Angular 22 and newer, optional chaining follows JavaScript semantics and returns `undefined`.
  Do not generate the temporary `$safeNavigationMigration` helper.
