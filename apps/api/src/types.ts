import type { D1Like } from './db.js';

export interface OrgMembership {
  organization_id: string;
  role: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  status: string;
  memberships: OrgMembership[];
  isSuperAdmin: boolean;
}

export interface AppEnv {
  DB: D1Like;
  JWT_SECRET: string;
  STORAGE_DRIVER: string;
  STORAGE_LOCAL_DIR: string;
  R2_PUBLIC_BASE_URL?: string;
  RATE_LIMIT_MAX?: number;
  RATE_LIMIT_WINDOW_MS?: number;
  R2?: {
    put(key: string, body: ArrayBuffer, opts?: { contentType?: string }): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream | null; contentType?: string } | null>;
  };
  KV?: { get(k: string): Promise<string | null>; put(k: string, v: string, opts?: { expirationTtl?: number }): Promise<void> };
}

export type AppVars = {
  requestId: string;
  lang: 'en' | 'id';
  user: AuthUser | null;
  db: D1Like;
  env: AppEnv;
};
