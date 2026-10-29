import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initSentry } from './app/core/sentry';
import { exposeEngineFingerprint } from '@common/fingerprint';

initSentry();
exposeEngineFingerprint(document, window, 'admin');

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
