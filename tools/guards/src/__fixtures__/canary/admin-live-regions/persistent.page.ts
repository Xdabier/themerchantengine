export const template = `
  <form>
    <p class="text-status-error" role="alert">
      @if (error()) {
        {{ error() }}
      }
    </p>
    <div role="status" aria-live="polite">@if (saved()) { Saved }</div>
    @if (loaded()) {
      <section>
        <p role="status">Nested below a plain element, not first: allowed</p>
      </section>
    }
    @if (open()) {
      <app-dialog role="dialog" aria-modal="true"></app-dialog>
    }
  </form>
`;
