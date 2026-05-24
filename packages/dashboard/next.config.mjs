/** @type {import('next').NextConfig} */
const nextConfig = {
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
