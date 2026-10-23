import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Painel 3D da Mostra (projeto do aluno, build estático em public/maquete). Só leitura pública: ele lê
  // GET /api/devices/esp32-city-01 como qualquer visitante. Ver README "Painel 3D da Mostra".
  async rewrites() {
    return [{ source: "/maquete", destination: "/maquete/index.html" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
