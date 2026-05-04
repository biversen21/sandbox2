import nextConfig from "eslint-config-next";

const config = [
  { ignores: ["app/generated/**"] },
  ...nextConfig,
];

export default config;
