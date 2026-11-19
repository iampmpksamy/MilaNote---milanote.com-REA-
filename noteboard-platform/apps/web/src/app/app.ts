import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The web app. With a Noteboard server behind it (the Homelab Edition) it signs people in and saves
 * their boards to their account; served as plain files it keeps boards in this browser.
 */
@Component({
  selector: 'nb-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
