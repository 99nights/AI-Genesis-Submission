import { v4 as uuidv4 } from 'uuid';
import { activeShopId, activeShopName } from './qdrant/core';
import { publishDanEvent } from './danRegistry';
import type {
  DanEventType,
  PolicyActionDefinition,
  PolicyConditionRule,
  PolicyDescriptor,
  PolicyRunLog,
} from '../types';

const POLICY_STORAGE_KEY = 'dan:policies:v1';
const POLICY_RUN_STORAGE_KEY = 'dan:policy-runs:v1';

const getLocalStorage = (): Storage | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage as Storage;
  }
  return null;
};

const readJson = <T>(key: string, fallback: T): T => {
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

const writeJson = (key: string, value: unknown) => {
  const store = getLocalStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
};

const getPolicyMap = (): Record<string, PolicyDescriptor[]> =>
  readJson<Record<string, PolicyDescriptor[]>>(POLICY_STORAGE_KEY, {});

const savePolicyMap = (map: Record<string, PolicyDescriptor[]>) =>
  writeJson(POLICY_STORAGE_KEY, map);

const getPolicyRunsMap = (): Record<string, PolicyRunLog[]> =>
  readJson<Record<string, PolicyRunLog[]>>(POLICY_RUN_STORAGE_KEY, {});

const savePolicyRunsMap = (map: Record<string, PolicyRunLog[]>) =>
  writeJson(POLICY_RUN_STORAGE_KEY, map);

export const seedDefaultPolicyForShop = async (
  shopId: string,
  shopName?: string | null,
): Promise<void> => {
  const map = getPolicyMap();
  if (map[shopId]?.length) return;

  const defaultPolicy: PolicyDescriptor = {
    id: uuidv4(),
    shopId,
    name: 'Auto-flag low inventory offers',
    description:
      'Warns when a DAN offer is created with quantity below 10 units so the shop can replenish locally before sharing.',
    eventType: 'inventory.offer.created',
    scope: 'inventory',
    version: '1.0',
    enabled: true,
    conditions: [
      { field: 'quantity', operator: 'lt', value: 10 },
      { field: 'shareScope', operator: 'includes', value: 'dan' },
    ],
    actions: [
      {
        type: 'notify',
        params: {
          message:
            'DAN offer shared while stock is below 10 units. Confirm replenishment or adjust sharing scope.',
        },
      },
      {
        type: 'create_dan_event',
        params: {
          trigger: 'policy.auto-alert',
          shopName: shopName || 'unknown shop',
        },
      },
    ],
    author: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  map[shopId] = [defaultPolicy];
  savePolicyMap(map);
};

export const upsertLocalPolicy = async (policy: PolicyDescriptor) => {
  const map = getPolicyMap();
  const policies = map[policy.shopId] || [];
  const index = policies.findIndex(p => p.id === policy.id);
  if (index >= 0) {
    policies[index] = { ...policy, updatedAt: new Date().toISOString() };
  } else {
    policies.push({ ...policy, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  map[policy.shopId] = policies;
  savePolicyMap(map);
};

export const getPoliciesForShop = async (shopId?: string | null): Promise<PolicyDescriptor[]> => {
  const resolvedShopId = shopId || activeShopId;
  if (!resolvedShopId) return [];
  const map = getPolicyMap();
  return map[resolvedShopId] || [];
};

export const getRecentPolicyRuns = async (
  shopId?: string | null,
  limit: number = 20,
): Promise<PolicyRunLog[]> => {
  const resolvedShopId = shopId || activeShopId;
  if (!resolvedShopId) return [];
  const map = getPolicyRunsMap();
  return (map[resolvedShopId] || []).slice(0, limit);
};

const recordPolicyRun = (run: PolicyRunLog) => {
  const map = getPolicyRunsMap();
  const runs = map[run.shopId] || [];
  runs.unshift(run);
  map[run.shopId] = runs.slice(0, 50);
  savePolicyRunsMap(map);
};

const getValueByPath = (payload: Record<string, any>, path: string): any => {
  return path.split('.').reduce((acc: any, key: string) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return acc[key];
    }
    return undefined;
  }, payload);
};

const evaluateRule = (rule: PolicyConditionRule, payload: Record<string, any>): boolean => {
  const actual = getValueByPath(payload, rule.field);
  const expected = rule.value;
  switch (rule.operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && actual > Number(expected);
    case 'gte':
      return typeof actual === 'number' && actual >= Number(expected);
    case 'lt':
      return typeof actual === 'number' && actual < Number(expected);
    case 'lte':
      return typeof actual === 'number' && actual <= Number(expected);
    case 'includes':
    case 'contains': {
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      if (typeof actual === 'string') {
        return actual.toLowerCase().includes(String(expected).toLowerCase());
      }
      return false;
    }
    default:
      return false;
  }
};

const executeAction = async (
  action: PolicyActionDefinition,
  policy: PolicyDescriptor,
  context: PolicyEventContext,
) => {
  switch (action.type) {
    case 'notify': {
      const message =
        action.params?.message ||
        `Policy "${policy.name}" triggered for event ${context.eventType}`;
      console.info(`[PolicyEngine] ${message}`, {
        policyId: policy.id,
        payload: context.payload,
      });
      break;
    }
    case 'create_dan_event': {
      await publishDanEvent({
        eventType: 'policy.trigger.executed',
        payload: {
          policyId: policy.id,
          policyName: policy.name,
          scope: policy.scope,
          trigger: action.params?.trigger || 'policy.action',
          eventPayload: context.payload,
        },
      });
      break;
    }
    case 'tag_inventory': {
      // Placeholder for future automation (e.g., tagging items via Qdrant)
      console.debug('[PolicyEngine] tag_inventory action queued', {
        policyId: policy.id,
        params: action.params,
      });
      break;
    }
    case 'call_webhook': {
      const url = action.params?.url;
      if (!url || typeof fetch === 'undefined') break;
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            policyId: policy.id,
            policyName: policy.name,
            payload: context.payload,
          }),
        });
      } catch (err) {
        console.warn('[PolicyEngine] call_webhook failed', err);
      }
      break;
    }
    default:
      console.warn('[PolicyEngine] Unknown action type', action.type);
  }
};

export interface PolicyEventContext {
  eventType: DanEventType;
  payload: Record<string, any>;
  proofs?: Record<string, any>;
  eventId?: string;
}

export const evaluatePoliciesForEvent = async (
  context: PolicyEventContext,
): Promise<void> => {
  const shopId =
    context.payload?.shopId || activeShopId || context.payload?.shop?.id || null;
  if (!shopId) return;

  const policies = await getPoliciesForShop(shopId);
  if (!policies.length) {
    await seedDefaultPolicyForShop(shopId, activeShopName);
  }
  const candidatePolicies = await getPoliciesForShop(shopId);
  const matchingPolicies = candidatePolicies.filter(
    policy => policy.enabled && policy.eventType === context.eventType,
  );

  if (!matchingPolicies.length) return;

  for (const policy of matchingPolicies) {
    const allRulesPass = policy.conditions.every(rule => evaluateRule(rule, context.payload));
    const run: PolicyRunLog = {
      id: uuidv4(),
      policyId: policy.id,
      shopId,
      eventType: context.eventType,
      eventPayload: context.payload,
      outcome: allRulesPass ? 'triggered' : 'skipped',
      notes: allRulesPass
        ? `Policy ${policy.name} triggered`
        : 'Condition check failed',
      createdAt: new Date().toISOString(),
    };

    if (allRulesPass) {
      try {
        for (const action of policy.actions) {
          await executeAction(action, policy, context);
        }
      } catch (error: any) {
        run.outcome = 'error';
        run.notes = `Action error: ${error?.message || 'unknown'}`;
      }
    }

    recordPolicyRun(run);
  }
};

