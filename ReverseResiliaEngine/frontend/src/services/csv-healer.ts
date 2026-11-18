/**
 * ReverseResilia Fuzzy CSV Healer Service
 * Implements Step 7: Self-Healing In-Browser Semantic CSV Normalizer.
 * Automatically maps non-standard column headers, fixes invalid booleans, 
 * strips currencies, and validates schema before ingestion into the CP-SAT engine.
 */

export interface ColumnMapping {
  rawHeader: string;
  canonicalHeader: string;
  confidence: number;
  transformationType: 'EXACT' | 'FUZZY_SYNONYM' | 'LEVENSHTEIN' | 'DEFAULT';
}

export interface HealedCSVResult {
  originalHeaders: string[];
  canonicalHeaders: string[];
  mappings: ColumnMapping[];
  healedCsvText: string;
  rowCount: number;
  anomaliesFixed: number;
  previewRows: Array<Record<string, any>>;
}

const CANONICAL_FIELD_SYNONYMS: Record<string, string[]> = {
  id: ['id', 'order_id', 'ord_id', 'tracking_no', 'awb', 'shipment_id', 'order', 'tracking'],
  quantity_units: ['qty', 'quantity', 'quantity_units', 'units', 'items', 'count', 'volume', 'pieces', 'stock_units'],
  warehouse_id: ['wh_id', 'warehouse_id', 'warehouse', 'wh', 'depot', 'origin', 'hub', 'source_wh', 'facility'],
  deadline_min: ['deadline_min', 'deadline', 'sla', 'cutoff', 'due_time', 'max_time', 'time_min', 'sla_min', 'sla_minutes'],
  critical: ['critical', 'urgent', 'priority', 'vip', 'rush', 'is_urgent', 'is_critical', 'high_prio', 'is_vip'],
  customer_id: ['customer_id', 'cust_id', 'customer', 'client', 'recipient', 'dest_name', 'receiver', 'account'],
  latitude: ['latitude', 'lat', 'dest_lat', 'y_coord', 'y'],
  longitude: ['longitude', 'lng', 'lon', 'dest_lng', 'dest_lon', 'x_coord', 'x'],
};

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

class CsvHealerService {
  /**
   * Identifies the best canonical field match for a given messy header string.
   */
  public matchHeader(raw: string): { canonical: string; confidence: number; type: ColumnMapping['transformationType'] } {
    const cleaned = raw.toLowerCase().trim().replace(/[\s\-_]+/g, '_');

    // 1. Direct exact or synonym lookup
    for (const [canonical, synonyms] of Object.entries(CANONICAL_FIELD_SYNONYMS)) {
      if (canonical === cleaned) {
        return { canonical, confidence: 1.0, type: 'EXACT' };
      }
      if (synonyms.includes(cleaned)) {
        return { canonical, confidence: 0.95, type: 'FUZZY_SYNONYM' };
      }
    }

    // 2. Levenshtein Distance Match across all synonyms
    let bestCanonical = 'unknown';
    let minDistance = Infinity;

    for (const [canonical, synonyms] of Object.entries(CANONICAL_FIELD_SYNONYMS)) {
      for (const syn of synonyms) {
        const dist = levenshteinDistance(cleaned, syn);
        if (dist < minDistance && dist <= 2) {
          minDistance = dist;
          bestCanonical = canonical;
        }
      }
    }

    if (minDistance <= 2) {
      const confidence = Number((1 - minDistance / Math.max(cleaned.length, 3)).toFixed(2));
      return { canonical: bestCanonical, confidence, type: 'LEVENSHTEIN' };
    }

    return { canonical: cleaned, confidence: 0.5, type: 'DEFAULT' };
  }

  /**
   * Parses and heals raw CSV text with irregular headers or messy formats.
   */
  public healCSV(rawCsvText: string): HealedCSVResult {
    const lines = rawCsvText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length < 2) {
      throw new Error('CSV must contain at least a header row and 1 data row.');
    }

    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const mappings: ColumnMapping[] = rawHeaders.map(raw => {
      const match = this.matchHeader(raw);
      return {
        rawHeader: raw,
        canonicalHeader: match.canonical,
        confidence: match.confidence,
        transformationType: match.type
      };
    });

    let anomaliesFixed = 0;
    const healedRows: Array<Record<string, any>> = [];

    for (let r = 1; r < lines.length; r++) {
      const rawCols = lines[r].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
      const rowObj: Record<string, any> = {};

      mappings.forEach((m, idx) => {
        const rawVal = rawCols[idx] !== undefined ? rawCols[idx] : '';
        const canon = m.canonicalHeader;

        // Healing Rules based on Canonical Schema
        if (canon === 'critical') {
          const valLower = rawVal.toLowerCase();
          if (['yes', 'true', '1', 'y', 't', 'urgent', 'rush', 'crit'].includes(valLower)) {
            rowObj[canon] = true;
          } else {
            rowObj[canon] = false;
          }
          if (rawVal !== 'true' && rawVal !== 'false') anomaliesFixed++;
        } else if (canon === 'quantity_units' || canon === 'deadline_min') {
          const cleanNum = rawVal.replace(/[^\d.-]/g, '');
          const parsed = parseInt(cleanNum, 10);
          rowObj[canon] = isNaN(parsed) ? (canon === 'quantity_units' ? 1 : 60) : parsed;
          if (cleanNum !== rawVal) anomaliesFixed++;
        } else if (canon === 'latitude' || canon === 'longitude') {
          const parsedFloat = parseFloat(rawVal);
          rowObj[canon] = isNaN(parsedFloat) ? 0.0 : parsedFloat;
        } else {
          rowObj[canon] = rawVal;
        }
      });

      healedRows.push(rowObj);
    }

    // Format Canonical CSV text
    const canonicalHeaders = mappings.map(m => m.canonicalHeader);
    const healedLines: string[] = [];
    healedLines.push(canonicalHeaders.join(','));

    healedRows.forEach(row => {
      healedLines.push(canonicalHeaders.map(h => row[h]).join(','));
    });

    return {
      originalHeaders: rawHeaders,
      canonicalHeaders,
      mappings,
      healedCsvText: healedLines.join('\n'),
      rowCount: healedRows.length,
      anomaliesFixed,
      previewRows: healedRows.slice(0, 5)
    };
  }

  /**
   * Generates a sample messy CSV string to immediately demonstrate the feature.
   */
  public generateMessyDemoCSV(): string {
    return [
      'Order_Num,Wh_Depot,Qty,Cust_Name,Urgent,Due_Mins,Lat,Lng',
      'O101,W2,14 units,Flipkart Fulfilment,YES,45m,13.0329,77.5273',
      'O102,W1,8 units,Amazon Hub BLR,no,90m,13.0995,77.3912',
      'O103,W3,22 items,Swiggy Instamart,Y,35 mins,12.9698,77.7499',
      'O104,W1,5,Zepto Central,FALSE,120,13.0450,77.4120',
      'O105,W4,18 units,Blinkit Depot,rush,50m,12.8167,77.6789'
    ].join('\n');
  }
}

export const csvHealer = new CsvHealerService();
