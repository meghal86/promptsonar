/** @type {import('next').NextConfig} */
const nextConfig = {
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
