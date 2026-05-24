import { supabase } from './supabase';

export interface TierLimits {
  plan: 'free' | 'pro' | 'team' | 'delinquent';
  maxProjects: number;
  maxScansPerMonth: number;
  allowSbom: boolean;
  allowPolicies: boolean;
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    plan: 'free',
    maxProjects: 3,
    maxScansPerMonth: 50,
    allowSbom: false,
    allowPolicies: false,
  },
  pro: {
    plan: 'pro',
    maxProjects: Infinity,
    maxScansPerMonth: Infinity,
    allowSbom: true,
    allowPolicies: true,
  },
  team: {
    plan: 'team',
    maxProjects: Infinity,
    maxScansPerMonth: Infinity,
    allowSbom: true,
    allowPolicies: true,
  },
  delinquent: {
    plan: 'delinquent',
    maxProjects: 0,
    maxScansPerMonth: 0,
    allowSbom: false,
    allowPolicies: false,
  }
};

/**
 * Retrieves the current subscription tier and limits for an organization.
 */
export async function getOrgTier(orgId: string): Promise<TierLimits> {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('plan')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error || !data) {
      // Default to free tier
      return TIER_LIMITS.free;
    }

    const plan = (data.plan || 'free').toLowerCase();
    return TIER_LIMITS[plan] || TIER_LIMITS.free;
  } catch (err) {
    console.error(`[Billing] Error fetching subscription tier: ${err}`);
    return TIER_LIMITS.free;
  }
}

/**
 * Checks if an organization has exceeded its limits for a specific action.
 * Returns { allowed: boolean, reason?: string }
 */
export async function checkUsageLimit(
  orgId: string,
  action: 'scan' | 'project' | 'sbom' | 'policy'
): Promise<{ allowed: boolean; reason?: string }> {
  const limits = await getOrgTier(orgId);

  if (limits.plan === 'delinquent') {
    return {
      allowed: false,
      reason: 'Your account payment is delinquent. Please update your billing settings to restore access.',
    };
  }

  switch (action) {
    case 'project': {
      // Count existing projects
      const { count, error } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);

      if (error) {
        return { allowed: false, reason: 'Failed to evaluate project usage limits.' };
      }

      const currentCount = count || 0;
      if (currentCount >= limits.maxProjects) {
        return {
          allowed: false,
          reason: `Project limit reached. Free tier allows a maximum of ${limits.maxProjects} projects. Upgrade to Pro or Team for unlimited projects.`,
        };
      }
      break;
    }

    case 'scan': {
      // Fetch or initialize monthly scan count
      const { data: usageData, error: usageError } = await supabase
        .from('usage')
        .select('scans_this_month')
        .eq('org_id', orgId)
        .maybeSingle();

      if (usageError) {
        return { allowed: false, reason: 'Failed to evaluate scan usage limits.' };
      }

      const scansThisMonth = usageData?.scans_this_month || 0;
      if (scansThisMonth >= limits.maxScansPerMonth) {
        return {
          allowed: false,
          reason: `Monthly scan limit reached. Free tier allows a maximum of ${limits.maxScansPerMonth} scans per month. Upgrade to Pro for unlimited scans.`,
        };
      }
      break;
    }

    case 'sbom': {
      if (!limits.allowSbom) {
        return {
          allowed: false,
          reason: 'CycloneDX SBOM generation and exports are exclusive to Pro and Team plans. Please upgrade to unlock.',
        };
      }
      break;
    }

    case 'policy': {
      if (!limits.allowPolicies) {
        return {
          allowed: false,
          reason: 'Governance policy files (DSL yaml checking) are exclusive to Pro and Team plans. Please upgrade to unlock.',
        };
      }
      break;
    }
  }

  return { allowed: true };
}

/**
 * Tracks usage by incrementing the monthly scan count for an organization.
 */
export async function incrementScanUsage(orgId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('usage')
      .select('id, scans_this_month')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      await supabase
        .from('usage')
        .update({ scans_this_month: (data.scans_this_month || 0) + 1 })
        .eq('id', data.id);
    } else {
      await supabase
        .from('usage')
        .insert({ org_id: orgId, scans_this_month: 1 });
    }
  } catch (err) {
    console.error(`[Billing] Failed to increment scan usage: ${err}`);
  }
}
