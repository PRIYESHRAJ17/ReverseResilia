/**
 * ReverseResilia API Client
 * Clean, modular HTTP client interface to backend endpoints.
 */

const BASE_URL = '/api';

export const apiClient = {
  async getHealth() {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
    return res.json();
  },

  async getCities() {
    const res = await fetch(`${BASE_URL}/cities`);
    if (!res.ok) throw new Error(`Failed to fetch cities: ${res.statusText}`);
    return res.json();
  },

  async getNetwork(cityId) {
    const res = await fetch(`${BASE_URL}/network/${cityId}`);
    if (!res.ok) throw new Error(`Failed to load network for ${cityId}: ${res.statusText}`);
    return res.json();
  },

  async validateNetwork(networkData) {
    const res = await fetch(`${BASE_URL}/network/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(networkData),
    });
    if (!res.ok) throw new Error(`Validation request failed: ${res.statusText}`);
    return res.json();
  },

  async calculateImpact(network, disruption) {
    const res = await fetch(`${BASE_URL}/scenarios/impact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network, disruption }),
    });
    if (!res.ok) throw new Error(`Impact calculation failed: ${res.statusText}`);
    return res.json();
  },

  async calculateMaxNaturalRecovery(network, disruption = null, priorityPolicy = 'HARD') {
    const res = await fetch(`${BASE_URL}/recovery/max-service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network, disruption, priority_policy: priorityPolicy }),
    });
    if (!res.ok) throw new Error(`Natural recovery calculation failed: ${res.statusText}`);
    return res.json();
  },

  async optimizeRecovery({
    network,
    disruption = null,
    targetServicePercentage = 100.0,
    budgetInr = null,
    allowedInterventionIds = null,
    priorityPolicy = 'HARD',
    timeoutSeconds = 10.0,
  }) {
    const res = await fetch(`${BASE_URL}/recovery/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        network,
        disruption,
        target_service_percentage: targetServicePercentage,
        budget_inr: budgetInr,
        allowed_intervention_ids: allowedInterventionIds,
        priority_policy: priorityPolicy,
        timeout_seconds: timeoutSeconds,
      }),
    });
    if (!res.ok) throw new Error(`Recovery optimization failed: ${res.statusText}`);
    return res.json();
  },

  async verifyRecoveryPlan(network, plan, disruption = null, priorityPolicy = 'HARD') {
    const res = await fetch(`${BASE_URL}/recovery/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        network,
        plan,
        disruption,
        priority_policy: priorityPolicy,
      }),
    });
    if (!res.ok) throw new Error(`Independent verification failed: ${res.statusText}`);
    return res.json();
  },

  async compareScenarios(network, disruption, plan) {
    const res = await fetch(`${BASE_URL}/scenarios/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network, disruption, plan }),
    });
    if (!res.ok) throw new Error(`Scenario comparison failed: ${res.statusText}`);
    return res.json();
  },

  getExportUrl(runId) {
    return `${BASE_URL}/runs/${runId}/export`;
  },
};
