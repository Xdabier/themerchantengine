import type { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Validators that stop a section from being saved while it points at an entity
 * that no longer exists.
 *
 * AD14: the section editors took raw pasted ids, so a category or product
 * deleted after the section was configured left a dead reference that surfaced
 * only on the storefront, and after plan B phase B2 stopped substituting pool
 * content for it, only as an empty rail. The editor is where that belongs.
 *
 * Both emit the same `deadId` error key, so the two editors render one message.
 * They differ in what they can know, which is not cosmetic:
 *
 *  - Categories arrive as a whole tree in one request, so the editor holds the
 *    complete set of live ids and can ask "is this one of them".
 *  - Products cannot be enumerated, so the editor resolves only the configured
 *    ids and learns which of those came back empty. Asking "is this live" of a
 *    set built that way would wrongly condemn every id picked after load, since
 *    a fresh pick was never in the resolved batch.
 */

/** Invalid when the id is absent from a set that holds every live id. */
export function unknownIdValidator(live: () => ReadonlySet<string> | null) {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string' || value.length === 0) return null;
    const known = live();
    // Null means the lookup has not settled, or failed. Neither is evidence
    // that anything is dead, so a slow or broken lookup cannot flash a false
    // failure at the operator or block an unrelated save.
    if (known === null) return null;
    return known.has(value) ? null : { deadId: { id: value } };
  };
}

/** Invalid only for an id a lookup positively reported as gone. */
export function deadIdValidator(dead: () => ReadonlySet<string> | null) {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string' || value.length === 0) return null;
    const known = dead();
    if (known === null) return null;
    return known.has(value) ? { deadId: { id: value } } : null;
  };
}
