import { Component } from '@angular/core';
import { IndexedDbStorage, MemoryStorage, STORAGE, WorkspaceView } from '@noteboard/ui-workspace';

/** The web app: the shared workspace, keeping boards in this browser's IndexedDB. */
@Component({
  selector: 'nb-root',
  imports: [WorkspaceView],
  template: '<nb-workspace />',
  providers: [{ provide: STORAGE, useFactory: () => (typeof indexedDB !== 'undefined' ? new IndexedDbStorage('local') : new MemoryStorage()) }],
})
export class App {}
