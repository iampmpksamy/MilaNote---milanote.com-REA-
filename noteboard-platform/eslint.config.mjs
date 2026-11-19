import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
      "ignores": [
        "**/dist",
        // native projects: generated Android/iOS/Tauri code and the web bundle copied into them
        "apps/mobile/android/**",
        "apps/mobile/ios/**",
        "apps/desktop/src-tauri/**",
        "**/vite.config.*.timestamp*",
        "**/vitest.config.*.timestamp*"
      ]
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // apps (web today; desktop, mobile and admin later) may use any shared library
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:ui', 'type:model', 'type:util'] },
            // the shared Angular workspace builds on the model and the geometry
            { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:model', 'type:util'] },
            // the model and the geometry stand alone, so the server can use them too
            { sourceTag: 'type:model', onlyDependOnLibsWithTags: [] },
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: [] },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
