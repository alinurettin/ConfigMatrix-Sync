// ConfigMatrix-Sync v2.0.0 - Dynamic Feature Flag & Multi-Dimensional Configuration Matrix
const crypto = require('crypto');

class MurmurRollout {
  /**
   * Deterministic 0.00% to 100.00% bucket calculation using SHA-256 32-bit truncation
   */
  static computeBucket(flagKey, entityId) {
    const hash = crypto.createHash('sha256').update(`${flagKey}:${entityId}`).digest();
    const val32 = hash.readUInt32BE(0);
    const bucketPercent = Number(((val32 % 10000) / 100).toFixed(2));
    return bucketPercent; // [0.00, 99.99]
  }

  static isUserInRollout(flagKey, entityId, rolloutPercentage) {
    if (rolloutPercentage >= 100) return true;
    if (rolloutPercentage <= 0) return false;
    const bucket = MurmurRollout.computeBucket(flagKey, entityId);
    return bucket < rolloutPercentage;
  }
}

class RuleEvaluator {
  static evaluateCondition(attributeValue, operator, targetValue) {
    if (attributeValue === undefined || attributeValue === null) {
      return operator === 'NOT_EQUALS' || operator === 'NOT_IN';
    }

    switch (operator) {
      case 'EQUALS':
        return String(attributeValue) === String(targetValue);
      case 'NOT_EQUALS':
        return String(attributeValue) !== String(targetValue);
      case 'IN':
        return Array.isArray(targetValue)
          ? targetValue.map(String).includes(String(attributeValue))
          : false;
      case 'NOT_IN':
        return Array.isArray(targetValue)
          ? !targetValue.map(String).includes(String(attributeValue))
          : true;
      case 'CONTAINS':
        return String(attributeValue).includes(String(targetValue));
      case 'GREATER_THAN':
        return Number(attributeValue) > Number(targetValue);
      case 'LESS_THAN':
        return Number(attributeValue) < Number(targetValue);
      case 'REGEX':
        try {
          return new RegExp(String(targetValue)).test(String(attributeValue));
        } catch (e) {
          return false;
        }
      default:
        return false;
    }
  }

  static evaluateRule(rule, context) {
    // rule: { conditions: [{ attribute, operator, value }], matchAll: true }
    if (!rule || !Array.isArray(rule.conditions) || rule.conditions.length === 0) return true;
    const matchAll = rule.matchAll !== false;

    for (const cond of rule.conditions) {
      const attrVal = context[cond.attribute];
      const match = RuleEvaluator.evaluateCondition(attrVal, cond.operator, cond.value);
      if (matchAll && !match) return false;
      if (!matchAll && match) return true;
    }
    return matchAll;
  }
}

class FeatureFlag {
  constructor(key, options = {}) {
    this.key = key;
    this.description = options.description || '';
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.rolloutPercentage = options.rolloutPercentage !== undefined ? options.rolloutPercentage : 100; // 0 to 100
    this.defaultValue = options.defaultValue !== undefined ? options.defaultValue : false;
    this.rules = options.rules || []; // [{ ruleId, conditions, value }]
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  evaluate(context = {}) {
    if (!this.enabled) {
      return {
        key: this.key,
        enabled: false,
        value: this.defaultValue,
        reason: 'FLAG_DISABLED'
      };
    }

    // 1. Evaluate Targeted Rules (e.g. internal employees, beta users, specific countries)
    for (const r of this.rules) {
      if (RuleEvaluator.evaluateRule(r, context)) {
        return {
          key: this.key,
          enabled: true,
          value: r.value !== undefined ? r.value : true,
          reason: `RULE_MATCH:${r.ruleId || 'custom'}`
        };
      }
    }

    // 2. Fractional Canary Percentage Rollout
    const entityId = context.userId || context.deviceId || context.ip || 'anonymous';
    const inRollout = MurmurRollout.isUserInRollout(this.key, entityId, this.rolloutPercentage);
    const bucket = MurmurRollout.computeBucket(this.key, entityId);

    return {
      key: this.key,
      enabled: inRollout,
      value: inRollout ? (this.defaultValue === false ? true : this.defaultValue) : false,
      reason: inRollout ? `PERCENTAGE_ROLLOUT_MATCH (${bucket}% < ${this.rolloutPercentage}%)` : `PERCENTAGE_ROLLOUT_EXCLUDED (${bucket}% >= ${this.rolloutPercentage}%)`,
      bucket
    };
  }
}

class ConfigMatrixEngine {
  constructor() {
    this.flags = new Map(); // key -> FeatureFlag
    this.subscribers = new Set(); // SSE client response objects
  }

  registerFlag(key, options = {}) {
    const flag = new FeatureFlag(key, options);
    this.flags.set(key, flag);
    this.broadcast({ event: 'FLAG_CREATED', key, flag });
    return flag;
  }

  updateFlag(key, updates = {}) {
    if (!this.flags.has(key)) throw new Error(`Flag "${key}" not found`);
    const flag = this.flags.get(key);
    if (updates.enabled !== undefined) flag.enabled = updates.enabled;
    if (updates.rolloutPercentage !== undefined) flag.rolloutPercentage = updates.rolloutPercentage;
    if (updates.defaultValue !== undefined) flag.defaultValue = updates.defaultValue;
    if (updates.rules !== undefined) flag.rules = updates.rules;
    flag.updatedAt = Date.now();

    this.broadcast({ event: 'FLAG_UPDATED', key, flag });
    return flag;
  }

  deleteFlag(key) {
    const deleted = this.flags.delete(key);
    if (deleted) this.broadcast({ event: 'FLAG_DELETED', key });
    return deleted;
  }

  evaluateAll(context = {}) {
    const results = {};
    for (const flag of this.flags.values()) {
      results[flag.key] = flag.evaluate(context);
    }
    return results;
  }

  subscribe(res) {
    this.subscribers.add(res);
    res.on('close', () => this.subscribers.delete(res));
  }

  broadcast(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.subscribers) {
      try {
        client.write(message);
      } catch (e) {
        this.subscribers.delete(client);
      }
    }
  }

  getMetrics() {
    let active = 0;
    let disabled = 0;
    for (const f of this.flags.values()) {
      if (f.enabled) active++;
      else disabled++;
    }
    return {
      totalFlags: this.flags.size,
      activeFlags: active,
      disabledFlags: disabled,
      activeSseConnections: this.subscribers.size
    };
  }

  reset() {
    this.flags.clear();
  }
}

module.exports = {
  MurmurRollout,
  RuleEvaluator,
  FeatureFlag,
  ConfigMatrixEngine
};
