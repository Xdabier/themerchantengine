import { GEO_FAQ_TEMPLATES } from './geo.constants';

describe('GEO_FAQ_TEMPLATES', () => {
  it.each(GEO_FAQ_TEMPLATES.map((t, i) => [i, t] as const))(
    'template %i carries copy for every shipped locale',
    (_i, template) => {
      for (const locale of ['default', 'ar', 'fr', 'en']) {
        expect(template.question[locale as 'default']).toBeTruthy();
        expect(template.answer[locale as 'default']).toBeTruthy();
      }
    },
  );

  it('writes the Arabic copy without Latin letters', () => {
    for (const t of GEO_FAQ_TEMPLATES) {
      expect(t.question.ar).not.toMatch(/[A-Za-z]/);
      expect(t.answer.ar).not.toMatch(/[A-Za-z]/);
    }
  });
});
