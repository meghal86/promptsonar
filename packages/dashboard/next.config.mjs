import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The repository scanner loads tree-sitter parsers from .wasm asset files at
// runtime. On serverless (Vercel) Next's file tracing bundles the JS but not
// these assets, so the scan fails in the cloud. Force-include the .wasm files
// (and the built CLI/core) into the scan API functions. Globs cover both a
// hoisted root node_modules and a local one.
const SCAN_ASSET_INCLUDES = [
  '../../node_modules/web-tree-sitter/*.wasm',
  '../../node_modules/tree-sitter-wasms/out/*.wasm',
  './node_modules/web-tree-sitter/*.wasm',
  './node_modules/tree-sitter-wasms/out/*.wasm',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Trace from the monorepo root so hoisted node_modules assets are found.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/api/repository': SCAN_ASSET_INCLUDES,
    '/api/repository/batch': SCAN_ASSET_INCLUDES,
    '/api/repository/fix': SCAN_ASSET_INCLUDES,
    '/api/playground': SCAN_ASSET_INCLUDES,
  },
  // The repository scanner uses tree-sitter wasm parsers and filesystem glob
  // walking; these must load from node_modules at runtime, not be bundled.
  serverExternalPackages: [
    '@promptsonar/cli',
    '@promptsonar/core',
    'web-tree-sitter',
    'tree-sitter-wasms',
    'fast-glob',
    'ignore',
  ],
  async redirects() {
    const redirects = [
      {
        source: '/overview',
        destination: '/projects',
        permanent: false,
      },
      {
        source: '/settings',
        destination: '/settings/billing',
        permanent: false,
      },
      // repository-v2 is the canonical repository surface (real scan engine +
      // scalable execution-flow graph + ported explorer UX). The earlier
      // /repository and /repository-explorer screens are retired and always
      // redirect here.
      {
        source: '/repository',
        destination: '/repository-v2',
        permanent: false,
      },
      {
        source: '/repository-explorer',
        destination: '/repository-v2',
        permanent: false,
      },
    ];
    if (process.env.NEXT_PUBLIC_PROMPTSONAR_PLAYGROUND_V4 !== 'false') {
      redirects.push({
        source: '/playground',
        destination: '/playground-v4',
        permanent: false,
      });
    }
    return redirects;
  },
};

export default nextConfig;
