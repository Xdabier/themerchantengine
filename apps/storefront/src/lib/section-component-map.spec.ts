import { describe, expect, it } from 'vitest';
import { SECTION_TYPES } from '@storefront-types';
import { SECTION_COMPONENT_MAP } from './section-component-map';

/**
 * Phase B8 restored `PROMOTIONAL_BANNER`. The admin sells the type, the API
 * accepts it and the storefront schema parses it, so silently dropping the row
 * before dispatch made it a dead knob: an operator could configure a banner
 * that never appeared and got no error either. The rebuilt surface is
 * agent_docs/storefront/brand-tokens.md compliant, which §5.3 allows: it forbids a lifestyle scene,
 * not a banner.
 */
const RENDERED_TYPES = SECTION_TYPES;

describe('SECTION_COMPONENT_MAP', () => {
  it('binds every rendered SectionType to a component', () => {
    for (const type of RENDERED_TYPES) {
      expect(SECTION_COMPONENT_MAP[type]).toBeDefined();
      expect(typeof SECTION_COMPONENT_MAP[type]).toBe('function');
    }
  });

  it('contains exactly the rendered types, no extras', () => {
    expect(Object.keys(SECTION_COMPONENT_MAP).sort()).toEqual([...RENDERED_TYPES].sort());
  });

  it('binds a component to PROMOTIONAL_BANNER so no operator row is dropped', () => {
    expect(Object.keys(SECTION_COMPONENT_MAP)).toContain('PROMOTIONAL_BANNER');
  });

  it('binds distinct components per type', () => {
    const components = Object.values(SECTION_COMPONENT_MAP);
    const distinct = new Set(components);
    expect(distinct.size).toBe(components.length);
  });
});
