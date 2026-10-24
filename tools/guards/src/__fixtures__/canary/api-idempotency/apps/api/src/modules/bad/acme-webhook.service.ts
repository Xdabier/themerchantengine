// Canary fixture. Never registered in a Nest module.
export class AcmeWebhookService {
  handle(event: { id: string }): void {
    void event;
  }
}
