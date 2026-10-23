/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // O app desktop abre em 127.0.0.1; sem isto o modo dev bloqueia o recarregamento.
  allowedDevOrigins: ['127.0.0.1'],
  // Pacotes nativos (bindings .node) não podem ser bundlados pelo Turbopack:
  // sem isto o build falha em ambiente limpo ao coletar page data
  // ("Failed to load external module sharp-<hash>").
  serverExternalPackages: ['sharp', 'onnxruntime-node', 'better-sqlite3', 'openvino-node'],
  outputFileTracingIncludes: {
    '/api/translate/extract': ['./models/**/*'],
    '/api/ocr-image/queue': ['./models/**/*'],
    '/api/sections/**/*': ['./models/**/*'],
  },
  outputFileTracingExcludes: {
    '*': ['./artifacts/**/*', './desktop/node_modules/**/*', './.git/**/*', './.env*', './storage/**/*'],
  },
  experimental: {
    proxyClientMaxBodySize: '2gb',
  },
  turbopack: {},
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    // Handle pdf.js worker
    config.resolve.alias.canvas = false
    return config
  },
}

export default nextConfig
