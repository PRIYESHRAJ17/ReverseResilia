/**
 * ReverseResilia Zero-Shot Domain Intent Classifier & Guardrail Engine
 * Strictly classifies user queries into IN_DOMAIN (Supply Chain / Logistics / CP-SAT),
 * GREETING (casual pleasantries), or OUT_OF_DOMAIN (refused).
 * 
 * DEFAULT POLICY: Closed-World Assumption (Any query lacking supply chain semantics is rejected).
 */

export type DomainClassification = 'IN_DOMAIN' | 'GREETING' | 'OUT_OF_DOMAIN';

export interface ClassificationResult {
  classification: DomainClassification;
  intent: string;
  confidence: number;
  detectedEntities: string[];
  refusalReason?: string;
}

// 1. Casual Greetings & Pleasantries
const GREETINGS_REGEX = /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|sup|yo|who\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+this|help(\s+me)?)[!?.]*$/i;

// 2. Comprehensive Out-of-Domain Categories (Blacklist reinforcement)
const OUT_OF_DOMAIN_PATTERNS: Array<{ category: string; regex: RegExp }> = [
  {
    category: 'Food & Culinary',
    regex: /\b(paneer|ice\s*cream|chocolate|candy|sweet|dessert|pizza|burger|biryani|samosa|curry|roti|dosa|rice|tea|coffee|recipe|cook|cooking|baking|restaurant|food|snack|dish|lunch|dinner|breakfast|milk|butter|cheese|fruit|apple|banana|mango|vegetable|kitchen|snack)\b/i
  },
  {
    category: 'Gaming & Esports',
    regex: /\b(game|gaming|gamer|esports|gta|fortnite|minecraft|valorant|pubg|playstation|ps4|ps5|xbox|nintendo|roblox|steam|gameplay|fps|rpg)\b/i
  },
  {
    category: 'Festivals & Holidays',
    regex: /\b(diwali|deepavali|holi|eid|ramadan|christmas|easter|halloween|thanksgiving|navratri|durga\s*puja|pongal|onam|festival|holiday|firecracker|puja)\b/i
  },
  {
    category: 'Entertainment & Media',
    regex: /\b(movie|cinema|film|actor|actress|hollywood|bollywood|netflix|series|season|trailer|song|music|singer|album|concert|celebrity|oscar)\b/i
  },
  {
    category: 'Sports',
    regex: /\b(cricket|ipl|bcci|virat|dhoni|rohit|football|soccer|fifa|messi|ronaldo|tennis|badminton|nba|basketball|olympics|world\s*cup|match|score)\b/i
  },
  {
    category: 'Politics & News',
    regex: /\b(president|prime\s*minister|modi|biden|trump|election|vote|parliament|congress|bjp|government|politics|politician|war|treaty)\b/i
  },
  {
    category: 'General Trivia & Chit-chat',
    regex: /\b(poem|poetry|love|girlfriend|boyfriend|joke|humor|astrology|horoscope|capital\s+of|distance\s+to|tallest|highest|who\s+invented|who\s+discovered)\b/i
  }
];

// 3. Positive Supply Chain Semantics Dictionary
const SUPPLY_CHAIN_LEXICON = [
  // Entities
  'supply chain', 'supply', 'logistics', 'dispatch', 'routing', 'route', 'road', 'network',
  'warehouse', 'warehouses', 'depot', 'depots', 'hub', 'hubs', 'facility', 'dock',
  'order', 'orders', 'customer', 'customers', 'consignment', 'shipment', 'package', 'packages',
  'box', 'parcel', 'freight', 'cargo', 'sku', 'inventory', 'stock', 'units', 'pallet',
  'truck', 'trucks', 'vehicle', 'vehicles', 'van', 'fleet', 'driver', 'carrier', 'courier', '3pl',
  'lane', 'lanes', 'corridor', 'highway', 'expressway', 'traffic', 'speed', 'distance', 'km',
  // Operations & Performance
  'deadline', 'deadlines', 'sla', 'sla_min', 'cutoff', 'cut-off', 'due', 'transit', 'travel',
  'delay', 'delayed', 'late', 'on-time', 'otif', 'delivery', 'deliver', 'fulfilled', 'unfulfilled',
  'backlog', 'lead time', 'capacity', 'throughput', 'overtime', 'shift', 'dock limit',
  // Disruptions & Resilience
  'disrupt', 'disrupted', 'disruption', 'outage', 'failure', 'sever', 'severed', 'blocked',
  'closure', 'breakdown', 'accident', 'flood', 'flooded', 'strike', 'detour', 'reroute',
  'recovery', 'recover', 'natural recovery', 'contingency', 'resilience', 'bottleneck',
  'plan a', 'plan b', 'plan-a', 'plan-b', 'stage a', 'stage b', 'stage c', 'tradeoff', 'trade-off', 'comparator',
  // Mathematical Optimization & Constraints
  'cp-sat', 'cp_sat', 'cpsat', 'highs', 'solver', 'optimizer', 'optimization', 'constraint',
  'constraints', 'bound', 'bounds', 'feasible', 'infeasible', 'infeasibility', 'minkowski',
  'integrality', 'binary', 'slack', 'objective', 'lexicographic', 'linear programming', 'milp',
  // Economics & Finance
  'budget', 'cost', 'costs', 'price', 'pricing', 'inr', 'rupees', 'spend', 'spending',
  'expense', 'intervention', 'interventions', 'package_inr', 'savings', 'roi', 'diminishing returns',
  'sensitivity', 'sweet spot', 'sweet-spot',
  // Topography & Regional Hubs
  'bengaluru', 'bangalore', 'mumbai', 'delhi', 'chennai', 'guwahati',
  'peenya', 'nelamangala', 'whitefield', 'bommasandra', 'electronic city', 'yelahanka',
  'w1', 'w2', 'w3', 'w4', 'o01', 'o02', 'o03', 'o04', 'o05', 'o06', 'o07', 'o08', 'o09', 'o10',
  'pincode', 'pin', 'osm', 'openstreetmap',
  // Zero-Trust & Audit
  'verifier', 'verify', 'audit', '10-point', 'zero-trust', 'proof', 'hash', 'sha256', 'provenance',
  'certificate', 'checks', 'compliance', 'evidence',
  // Slang & Colloquial Supply Chain
  'truck stuck', 'order stuck', 'peenya down', 'wh down', 'save money', 'cut cost',
  'deliver fast', 'quick delivery', 'urgent order', 'priority shipment', 'cant deliver',
  'why dropped', 'why failed', 'how to recover', 'which warehouse', 'which depot'
];

export class DomainGuardrailService {
  /**
   * Evaluates any user query against the ReverseResilia domain boundary.
   */
  public classify(rawQuery: string): ClassificationResult {
    const q = rawQuery.trim().toLowerCase();

    if (!q) {
      return {
        classification: 'OUT_OF_DOMAIN',
        intent: 'EMPTY',
        confidence: 1.0,
        detectedEntities: [],
        refusalReason: 'Empty query.'
      };
    }

    // 1. Check if it's a polite casual greeting
    if (GREETINGS_REGEX.test(q)) {
      return {
        classification: 'GREETING',
        intent: 'GREETING',
        confidence: 0.98,
        detectedEntities: ['greeting']
      };
    }

    // 2. Check for explicit Out-of-Domain categories
    for (const item of OUT_OF_DOMAIN_PATTERNS) {
      if (item.regex.test(q)) {
        // Only override if there is an overwhelming, explicit supply chain context
        // E.g. "We are shipping ice cream in refrigerated trucks with 2-hour SLA"
        const hasStrongLogisticsContext = (q.includes('truck') || q.includes('refrigerated') || q.includes('warehouse')) && (q.includes('deadline') || q.includes('route') || q.includes('dispatch'));
        if (!hasStrongLogisticsContext) {
          return {
            classification: 'OUT_OF_DOMAIN',
            intent: `OUT_OF_DOMAIN_${item.category.toUpperCase().replace(/\s+/g, '_')}`,
            confidence: 0.99,
            detectedEntities: [item.category],
            refusalReason: `Detected off-topic category: ${item.category}.`
          };
        }
      }
    }

    // 3. Extract positive supply chain features
    const matchedTerms: string[] = [];
    for (const term of SUPPLY_CHAIN_LEXICON) {
      // Word boundary or substring match for multi-word phrases
      if (term.includes(' ')) {
        if (q.includes(term)) matchedTerms.push(term);
      } else {
        const wordRegex = new RegExp(`\\b${term}\\b`, 'i');
        if (wordRegex.test(q)) matchedTerms.push(term);
      }
    }

    // Check specific patterns like order codes (O01..O99, W1..W9)
    if (/\b[ow]\d{1,3}\b/i.test(q)) {
      matchedTerms.push('hub_or_order_id');
    }
    // Check pincodes
    if (/\b560\d{3}\b/i.test(q)) {
      matchedTerms.push('bengaluru_pincode');
    }

    // 4. Strict Decision Rule:
    // If NO supply chain features are found, REJECT by default (Closed-World Domain Assumption)
    if (matchedTerms.length === 0) {
      return {
        classification: 'OUT_OF_DOMAIN',
        intent: 'UNRECOGNIZED_NON_LOGISTICS',
        confidence: 0.95,
        detectedEntities: [],
        refusalReason: 'Query does not contain supply chain, logistics, network, or optimization terms.'
      };
    }

    // 5. In-Domain Acceptance
    return {
      classification: 'IN_DOMAIN',
      intent: 'SUPPLY_CHAIN_OPERATIONS',
      confidence: Math.min(1.0, 0.7 + matchedTerms.length * 0.1),
      detectedEntities: matchedTerms
    };
  }

  /**
   * Formulates the standard, domain-enforced rejection message.
   */
  public getRefusalMessage(): string {
    return `⚠ OUT-OF-DOMAIN QUERY DETECTED: I am the ReverseResilia Dispatch Copilot, specialized exclusively in supply chain optimization, CP-SAT constraints, and regional logistics dispatch. I cannot answer queries regarding unrelated topics (such as culinary dishes, gaming, movies, festivals, or general trivia). Please ask an operational or supply chain question.`;
  }
}

export const domainGuardrail = new DomainGuardrailService();
