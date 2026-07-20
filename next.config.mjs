/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/tailor-wa",
        destination:
          "https://api.whatsapp.com/send?phone=918147497006&text=Hi%2C%20I%20want%20to%20join%20as%20a%20partner%20tailor%20with%20Draep.",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
