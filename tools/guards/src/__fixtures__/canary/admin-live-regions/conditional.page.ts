export const template = `
  <form>
    @if (error()) {
      <p class="text-status-error" role="alert">{{ error() }}</p>
    }
    @if (saved()) {
      <p
        class="text-status-success"
        role="status"
      >
        Saved
      </p>
    } @else if (pending()) {
      <p role="status">Saving</p>
    } @else {
      <span>Idle</span>
      <div role="alert">not first, not flagged</div>
    }
    @switch (state()) {
      @case ('empty') {

        <div class="empty" role='status'>Nothing yet</div>
      }
      @default {
        <div role="alert">Unknown state</div>
      }
    }
    @if (truncated()) {
      <p class="tabular text-xs" aria-live="polite">More results</p>
    }
    @if (failed()) {
      <div
        aria-live='assertive'
      >Failed</div>
    }
  </form>
`;
