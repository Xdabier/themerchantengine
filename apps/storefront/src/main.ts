import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { exposeEngineFingerprint } from '@common/fingerprint';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

exposeEngineFingerprint(document, window, 'storefront');

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
