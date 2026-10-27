import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { DropzoneComponent, type DropzoneFileRejection } from './dropzone.component';

expect.extend(toHaveNoViolations);

@Component({
  standalone: true,
  imports: [DropzoneComponent],
  template: `
    <app-dropzone
      [maxSizeBytes]="maxSize()"
      [accept]="accept()"
      [multiple]="multiple()"
      [busy]="busy()"
      (filesAdded)="added.push($event)"
      (filesRejected)="rejected.push($event)"
    />
  `,
})
class Host {
  readonly maxSize: WritableSignal<number> = signal(1024);
  readonly accept: WritableSignal<string> = signal('image/png,image/jpeg');
  readonly multiple: WritableSignal<boolean> = signal(true);
  readonly busy: WritableSignal<boolean> = signal(false);
  readonly added: File[][] = [];
  readonly rejected: DropzoneFileRejection[][] = [];
}

function makeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

function dispatchDrop(target: HTMLElement, files: File[]): void {
  // jsdom lacks DataTransfer. Build a minimal FileList-ish stand-in with
  // the only two fields the dropzone reads (`files` + `types`).
  const fileList = Object.assign(files, {
    item: (i: number) => files[i] ?? null,
  }) as unknown as FileList;
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: fileList, types: ['Files'] },
  });
  target.dispatchEvent(event);
}

describe('DropzoneComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function trigger(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid=dropzone-trigger]') as HTMLElement;
  }

  it('accepts files within the MIME allow-list', () => {
    dispatchDrop(trigger(), [makeFile('a.png', 'image/png', 100)]);
    expect(host.added).toHaveLength(1);
    expect(host.added[0]).toHaveLength(1);
  });

  it('rejects files with a blocked MIME type', () => {
    dispatchDrop(trigger(), [makeFile('a.gif', 'image/gif', 100)]);
    expect(host.rejected).toHaveLength(1);
    expect(host.rejected[0][0].reason).toBe('mime');
  });

  it('rejects files larger than the size cap', () => {
    dispatchDrop(trigger(), [makeFile('a.png', 'image/png', 2048)]);
    expect(host.rejected[0][0].reason).toBe('size');
  });

  it('drops extra files when multiple is false', () => {
    host.multiple.set(false);
    fixture.detectChanges();
    dispatchDrop(trigger(), [
      makeFile('a.png', 'image/png', 100),
      makeFile('b.png', 'image/png', 100),
    ]);
    expect(host.added[0]).toHaveLength(1);
  });

  it('does not accept files while busy', () => {
    host.busy.set(true);
    fixture.detectChanges();
    dispatchDrop(trigger(), [makeFile('a.png', 'image/png', 100)]);
    expect(host.added).toHaveLength(0);
  });

  it('has no axe violations', async () => {
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
