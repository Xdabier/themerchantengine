import { getLocaleDefinition, registryLocaleCodes } from '@common/locale';

export interface SearchTextConfig {
  config: string;
  /** Mirrors the trigger: accents are stripped for ltr text only. */
  unaccent: boolean;
}

/**
 * Text-search configurations the query side probes: the distinct config of every
 * registry locale, plus `simple` for the tags segment. It mirrors the segments
 * `prisma/search_fts_setup.sql` is generated with.
 */
export function searchTextConfigs(): SearchTextConfig[] {
  const byConfig = new Map<string, boolean>();
  for (const code of registryLocaleCodes()) {
    const definition = getLocaleDefinition(code);
    if (!definition) continue;
    const unaccent = definition.direction === 'ltr';
    byConfig.set(
      definition.textSearchConfig,
      (byConfig.get(definition.textSearchConfig) ?? false) || unaccent,
    );
  }
  byConfig.set('simple', true);
  return [...byConfig].map(([config, unaccent]) => ({ config, unaccent }));
}
