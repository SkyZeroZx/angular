# Programmatic Rendering

Use a normal template when the component type is known. Use `@defer` when the goal is only lazy
loading. Render programmatically when the component type is chosen at runtime:

- Use `NgComponentOutlet` when the choice belongs in the template.
- Use `ViewContainerRef.createComponent` when TypeScript must control creation, order, or removal.
- Use `NgTemplateOutlet`, not these APIs, to render a `TemplateRef` fragment.

## NgComponentOutlet

Import `NgComponentOutlet` from `@angular/common` and pass the component type. Provide inputs with
`ngComponentOutletInputs`:

```ts
import {NgComponentOutlet} from '@angular/common';
import {Component, signal} from '@angular/core';

@Component({
  imports: [NgComponentOutlet],
  template: `
    <ng-container
      [ngComponentOutlet]="greetingComponent"
      [ngComponentOutletInputs]="greetingInputs()"
    />
  `,
})
export class ProfileView {
  readonly greetingComponent = UserGreeting;
  readonly greetingInputs = signal({username: 'ngAwesome', role: 'admin'});
}
```

The outlet owns replacement and destruction. Export it as `#outlet="ngComponentOutlet"` to access
`componentInstance`, which is `null` before rendering. Use `ngComponentOutletInjector` for a custom
injector and `ngComponentOutletContent` for content created through Angular rendering APIs; native
DOM nodes used as projected content are unsupported during hydration.

## ViewContainerRef

`ViewContainerRef.createComponent` inserts the component at the container's location and returns
its `ComponentRef`. Configure bindings during creation instead of wiring them manually:

```ts
import {
  Component,
  ViewContainerRef,
  inputBinding,
  outputBinding,
  signal,
  twoWayBinding,
  viewChild,
} from '@angular/core';

@Component({
  template: `
    <button (click)="showWarning()">Show warning</button>
    <ng-container #container />
  `,
})
export class WarningHost {
  private readonly container = viewChild.required('container', {read: ViewContainerRef});
  readonly canClose = signal(true);
  readonly isExpanded = signal(true);

  showWarning() {
    const container = this.container();
    container.clear();
    return container.createComponent(AppWarning, {
      bindings: [
        inputBinding('canClose', this.canClose),
        twoWayBinding('isExpanded', this.isExpanded),
        outputBinding<boolean>('close', (confirmed) => {
          if (confirmed) container.clear();
        }),
      ],
    });
  }
}
```

- `inputBinding` tracks a value-producing function, `outputBinding` registers a listener, and
  `twoWayBinding` connects a model to a writable signal.
- Do not call `setInput` for an input configured with `inputBinding` or `twoWayBinding`.
- Use the `directives` creation option when the dynamic host needs host directives.
- Use `clear()` or `remove()` to destroy container-owned views. Use standalone `createComponent`
  only for UI outside the current view hierarchy, where attachment and cleanup are explicit.
- If `@defer` cannot express a lazy-loading requirement, dynamically import the component before
  passing its type to either API.
