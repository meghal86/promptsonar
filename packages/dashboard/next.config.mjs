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
    return [
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
    ];
  },
};

export default nextConfig;
