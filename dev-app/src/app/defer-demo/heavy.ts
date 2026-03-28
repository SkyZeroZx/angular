import {Component} from '@angular/core';

@Component({
  selector: 'app-heavy',
  standalone: true,
  template: `
    <div style="padding: 16px; background: #e8f5e9; border-radius: 8px; margin-top: 8px;">
      <h3 style="margin: 0 0 8px;">✅ Heavy component loaded!</h3>
      <p style="margin: 0;">This component was lazily loaded via <code>&#64;defer</code>.</p>
      <p style="margin: 4px 0 0; font-size: 12px; color: #666;">
        Loaded at: {{ now }}
      </p>
    </div>
  `,
})
export class HeavyComponent {
  now = new Date().toLocaleTimeString();
}
