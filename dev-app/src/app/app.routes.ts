import {Routes} from '@angular/router';

export const routes: Routes = [
  {
    path: 'defer-demo',
    loadComponent: () => import('./defer-demo/defer-demo'),
  },
  {path: '', redirectTo: 'defer-demo', pathMatch: 'full'},
];
