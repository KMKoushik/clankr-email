declare module 'cloudflare:workers' {
  export interface CloudflareEnv {
    APP_DB: D1Database
  }

  export const env: CloudflareEnv
}
