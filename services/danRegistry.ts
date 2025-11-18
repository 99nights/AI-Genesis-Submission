import { v4 as uuidv4 } from 'uuid';
import supabase from './supabaseClient';
import {
  activeShopId,
  activeNamespace,
} from './qdrant/core';
import {
  ENABLE_DAN_EXPERIMENT,
  DAN_KEY_SALT,
  DAN_REALTIME_CHANNEL,
} from '../config';
import type {
  DanContext,
  DanEventInput,
  DanEventRecord,
  DanKeyMaterial,
  DanShareScope,
} from '../types';

type StoredDanKeyMaterial = DanKeyMaterial & { privateKey: string };

const KEY_STORAGE_KEY = 'dan:keypairs:v1';
const EVENT_BUFFER_KEY = 'dan:event-buffer:v1';

const getLocalStorage = (): Storage | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage as Storage;
  }
  return null;
};

const tryReadJson = <T>(key: string, fallback: T): T => {
  const store = getLocalStorage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const tryWriteJson = (key: string, value: unknown) => {
  const store = getLocalStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
};

const bufferToHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const getSubtleCrypto = (): SubtleCrypto | null => {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (candidate && candidate.subtle) {
    return candidate.subtle;
  }
  return null;
};

const sha256 = async (value: string): Promise<string> => {
  const subtle = getSubtleCrypto();
  if (!subtle) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return `fallback-${Math.abs(hash).toString(16)}`;
  }
  const encoded = new TextEncoder().encode(value);
  const digest = await subtle.digest('SHA-256', encoded);
  return bufferToHex(digest);
};

export const hashDanPayload = async (input: unknown): Promise<string> => {
  const serialized =
    typeof input === 'string' ? input : JSON.stringify(input ?? {});
  return sha256(serialized);
};

const deriveKeyPair = async (shopId: string): Promise<StoredDanKeyMaterial> => {
  const material = `${shopId}:${activeNamespace || 'global'}:${DAN_KEY_SALT}`;
  const privateKey = await sha256(`${material}:private`);
  const publicKey = await sha256(`${privateKey}:public`);
  const fingerprint = publicKey.slice(0, 16);
  return {
    publicKey,
    fingerprint,
    derivedAt: new Date().toISOString(),
    privateKey,
  };
};

const readStoredKeys = (): Record<string, StoredDanKeyMaterial> =>
  tryReadJson<Record<string, StoredDanKeyMaterial>>(KEY_STORAGE_KEY, {});

const writeStoredKeys = (keys: Record<string, StoredDanKeyMaterial>) =>
  tryWriteJson(KEY_STORAGE_KEY, keys);

const getStoredKeyForShop = (shopId: string): StoredDanKeyMaterial | null => {
  const keys = readStoredKeys();
  return keys[shopId] || null;
};

const persistKeyForShop = (shopId: string, key: StoredDanKeyMaterial) => {
  const next = readStoredKeys();
  next[shopId] = key;
  writeStoredKeys(next);
};

const registerKeyWithControlPlane = async (
  shopId: string,
  key: StoredDanKeyMaterial,
) => {
  if (!supabase) return false;
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('dan_keys')
      .upsert(
        {
          shop_id: shopId,
          namespace: activeNamespace,
          public_key: key.publicKey,
          fingerprint: key.fingerprint,
          capability_scope: ['local', 'dan'],
          last_seen_at: now,
        },
        { onConflict: 'shop_id' },
      );
    if (error) {
      console.warn('[DAN] Failed to register key with control plane', error);
      return false;
    }
    persistKeyForShop(shopId, { ...key, lastRegisteredAt: now });
    return true;
  } catch (err) {
    console.warn('[DAN] Error registering key', err);
    return false;
  }
};

const ensureKeyPair = async (): Promise<StoredDanKeyMaterial | null> => {
  const shopId = activeShopId;
  if (!shopId || !ENABLE_DAN_EXPERIMENT) return null;
  let key = getStoredKeyForShop(shopId);
  if (!key) {
    key = await deriveKeyPair(shopId);
    persistKeyForShop(shopId, key);
  }
  if (supabase) {
    await registerKeyWithControlPlane(shopId, key);
  }
  return key;
};

const flushBufferedEvents = async () => {
  if (!supabase) return;
  const buffered = tryReadJson<DanEventRecord[]>(EVENT_BUFFER_KEY, []);
  if (!buffered.length) return;
  try {
    const insertPayload = buffered.map(event => ({
      event_id: event.eventId,
      shop_id: event.shopId,
      namespace: event.namespace,
      event_type: event.eventType,
      payload: event.payload,
      share_scope: event.shareScope,
      vector_context: event.vectorContext,
      proofs: event.proofs,
      actor_public_key: event.actor.publicKey,
      actor_fingerprint: event.actor.fingerprint,
      actor_signature: event.actor.signature,
      created_at: event.createdAt,
    }));
    const { error } = await supabase.from('dan_events').insert(insertPayload);
    if (!error) {
      tryWriteJson(EVENT_BUFFER_KEY, []);
    }
  } catch (err) {
    console.warn('[DAN] Failed to flush buffered events', err);
  }
};

export const resolveShareScope = (
  scopes?: DanShareScope[],
): DanShareScope[] => {
  const set = new Set<DanShareScope>(['local']);
  (scopes || []).forEach(scope => {
    if (scope) set.add(scope);
  });
  return Array.from(set);
};

export const shareScopeIncludesDan = (scopes?: DanShareScope[]): boolean =>
  resolveShareScope(scopes).includes('dan');

export const isDanFeatureEnabled = () => ENABLE_DAN_EXPERIMENT;

export const getDanContext = async (): Promise<DanContext> => {
  const shopId = activeShopId || null;
  const namespace = activeNamespace || null;
  if (!shopId) {
    return {
      enabled: false,
      shopId: null,
      namespace,
      capabilityScope: ['local'],
      reason: 'no-shop',
    };
  }
  if (!ENABLE_DAN_EXPERIMENT) {
    return {
      enabled: false,
      shopId,
      namespace,
      capabilityScope: ['local'],
      reason: 'flag-disabled',
    };
  }
  const key = await ensureKeyPair();
  if (!key) {
    return {
      enabled: false,
      shopId,
      namespace,
      capabilityScope: ['local'],
      reason: 'missing-supabase',
    };
  }
  return {
    enabled: true,
    shopId,
    namespace,
    publicKey: key.publicKey,
    fingerprint: key.fingerprint,
    capabilityScope: ['local', 'dan'],
    lastRegisteredAt: key.lastRegisteredAt || key.derivedAt,
    reason: 'ok',
  };
};

const bufferEventLocally = (event: DanEventRecord) => {
  const buffered = tryReadJson<DanEventRecord[]>(EVENT_BUFFER_KEY, []);
  buffered.push(event);
  tryWriteJson(EVENT_BUFFER_KEY, buffered);
};

export const publishDanEvent = async (
  input: DanEventInput,
): Promise<DanEventRecord | null> => {
  if (!ENABLE_DAN_EXPERIMENT) return null;
  const shopId = activeShopId;
  if (!shopId) return null;

  const key = await ensureKeyPair();
  if (!key) return null;

  const shareScope = resolveShareScope(input.shareScope);
  const payloadClone = JSON.parse(JSON.stringify(input.payload || {}));
  const baseHash = await hashDanPayload(payloadClone);
  const signature = await sha256(`${key.privateKey}:${baseHash}`);

  const record: DanEventRecord = {
    eventId: uuidv4(),
    eventType: input.eventType,
    shopId,
    namespace: activeNamespace || null,
    payload: payloadClone,
    shareScope,
    vectorContext: input.vectorContext || null,
    proofs: {
      ...(input.proofs || {}),
      hash: baseHash,
    },
    actor: {
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      signature,
    },
    createdAt: new Date().toISOString(),
  };

  await flushBufferedEvents();

  if (!supabase) {
    bufferEventLocally(record);
    return record;
  }

  try {
    const { error } = await supabase.from('dan_events').insert({
      event_id: record.eventId,
      shop_id: record.shopId,
      namespace: record.namespace,
      event_type: record.eventType,
      payload: record.payload,
      share_scope: record.shareScope,
      vector_context: record.vectorContext,
      proofs: record.proofs,
      actor_public_key: record.actor.publicKey,
      actor_fingerprint: record.actor.fingerprint,
      actor_signature: record.actor.signature,
      created_at: record.createdAt,
    });
    if (error) {
      console.warn('[DAN] Failed to send event to Supabase, buffering', error);
      bufferEventLocally(record);
    }
  } catch (err) {
    console.warn('[DAN] Error publishing event, buffering instead', err);
    bufferEventLocally(record);
  }

  return record;
};

export type DanRealtimeHandler = (event: DanEventRecord) => void;

export const subscribeToDanEvents = (handler: DanRealtimeHandler) => {
  if (!supabase || !ENABLE_DAN_EXPERIMENT) {
    console.warn('[DAN] Realtime not available. Supabase client missing or DAN disabled.');
    return () => {};
  }
  const channel = supabase
    .channel(DAN_REALTIME_CHANNEL)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dan_events' },
      (payload) => {
        const row = payload.new as any;
        const record: DanEventRecord = {
          eventId: row.event_id,
          eventType: row.event_type,
          shopId: row.shop_id,
          namespace: row.namespace,
          payload: row.payload,
          shareScope: row.share_scope || ['local'],
          vectorContext: row.vector_context || null,
          proofs: row.proofs,
          actor: {
            publicKey: row.actor_public_key,
            fingerprint: row.actor_fingerprint,
            signature: row.actor_signature,
          },
          createdAt: row.created_at,
        };
        handler(record);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        flushBufferedEvents();
      }
    });

  return () => {
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
};

