/**
 * Storage entry point.
 * Picks PostgreSQL when DATABASE_URL is set, otherwise the local JSON store.
 * The selected instance is cached for the lifetime of the process.
 */

import type { Store } from "../types";
import { getLocalStore } from "./local-store";
import { getPostgresStore, isPostgresConfigured, seedPostgresIfEmpty } from "./postgres-store";

let cached: Store | null = null;

export function isPostgres(): boolean {
  return isPostgresConfigured();
}

export function getStore(): Store {
  if (!cached) {
    cached = isPostgres() ? getPostgresStore() : getLocalStore();
  }
  return cached;
}

/** Idempotent initial seed for both backends. Call it once during startup. */
export async function seedIfEmpty(): Promise<void> {
  if (isPostgres()) {
    await seedPostgresIfEmpty();
    return;
  }
  await getLocalStore().seed();
}
