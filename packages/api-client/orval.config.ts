import { defineConfig } from 'orval';

export default defineConfig({
  classloom: {
    input: { target: './openapi.json' },
    output: {
      mode: 'tags-split',
      target: './src/generated/endpoints',
      schemas: './src/generated/model',
      client: 'react-query',
      httpClient: 'axios',
      clean: true,
      override: {
        mutator: { path: './src/fetcher.ts', name: 'apiFetch' },
        query: { useSuspenseQuery: false },
      },
    },
  },
});
