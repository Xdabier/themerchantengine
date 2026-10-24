/**
 * Terminal output for the stepper: a banner, step headers, notes, and a
 * 24-bit colour swatch for the palette preview. Plain ANSI, no library, and
 * every escape is dropped when the output is not a terminal so a CI log stays
 * readable.
 */
export interface Output {
  write(text: string): void;
  readonly isTTY: boolean;
}

export const stdoutOutput: Output = {
  write: (text) => process.stdout.write(text),
  get isTTY() {
    return Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
  },
};

const ESC = '[';

export function paint(out: Output, code: string, text: string): string {
  return out.isTTY ? `${ESC}${code}m${text}${ESC}0m` : text;
}

export const ui = {
  banner(out: Output, version: string): void {
    out.write(
      `\n${paint(out, '1', 'themerchantengine')} setup ${paint(out, '2', `v${version}`)}\n\n`,
    );
  },
  step(out: Output, index: number, total: number, title: string): void {
    out.write(`\n${paint(out, '1;36', `[${index}/${total}] ${title}`)}\n`);
  },
  note(out: Output, text: string): void {
    out.write(`  ${text}\n`);
  },
  ok(out: Output, text: string): void {
    out.write(`  ${paint(out, '32', 'ok')}  ${text}\n`);
  },
  warn(out: Output, text: string): void {
    out.write(`  ${paint(out, '33', '!')}   ${text}\n`);
  },
  fail(out: Output, text: string): void {
    out.write(`  ${paint(out, '31', 'x')}   ${text}\n`);
  },
  /** A block of colour with its hex beside it; a plain hex when colour cannot be shown. */
  swatch(out: Output, hex: string, label: string): string {
    const rgb = hexToRgb(hex);
    const block = out.isTTY ? `${ESC}48;2;${rgb.r};${rgb.g};${rgb.b}m      ${ESC}0m` : '';
    return `${block} ${hex}  ${label}`;
  },
};

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}
