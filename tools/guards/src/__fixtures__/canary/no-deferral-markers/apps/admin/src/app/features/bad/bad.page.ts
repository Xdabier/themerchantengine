// Canary fixture. Never imported by application code.
export class BadPage {
  // TODO: wire the real service once the endpoint lands.
  // Phase 9 will replace this stubbed reader with the paginated one.
  load(): unknown[] {
    return [];
  }
}
