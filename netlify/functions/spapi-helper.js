/**
 * SP-API Helper — Amazon Selling Partner API
 * Prêt pour connexion quand Amazon approuve l'accès.
 *
 * Variables d'environnement nécessaires :
 *   SP_CLIENT_ID       — LWA App Client ID
 *   SP_CLIENT_SECRET   — LWA App Client Secret
 *   SP_REFRESH_TOKEN   — Refresh Token du compte vendeur
 *   SP_MARKETPLACE_ID  — FR: A13V1IB3VIYZZH | DE: A1PA6795UKMFR9 (défaut)
 */

const fetch = require('node-fetch');

const MARKETPLACES = {
    FR: 'A13V1IB3VIYZZH',
    DE: 'A1PA6795UKMFR9',
    IT: 'APJ6JRA9NG5V4',
    ES: 'A1RKKUPIHCS9HS',
};

// ─── Vérifier si SP-API est configurée ──────────────────────────────────
function isSPAPIAvailable() {
    return !!(process.env.SP_CLIENT_ID && process.env.SP_CLIENT_SECRET && process.env.SP_REFRESH_TOKEN);
}

// ─── Obtenir un access token LWA ─────────────────────────────────────────
async function getLWAToken() {
    const resp = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: process.env.SP_REFRESH_TOKEN,
            client_id:     process.env.SP_CLIENT_ID,
            client_secret: process.env.SP_CLIENT_SECRET,
        })
    });
    const data = await resp.json();
    if (!data.access_token) throw new Error('LWA token failed: ' + JSON.stringify(data));
    return data.access_token;
}

// ─── Appel générique SP-API ───────────────────────────────────────────────
async function spRequest(path, params = {}) {
    const token       = await getLWAToken();
    const marketplace = process.env.SP_MARKETPLACE_ID || MARKETPLACES.DE;
    const url         = new URL('https://sellingpartnerapi-eu.amazon.com' + path);
    url.searchParams.set('marketplaceIds', marketplace);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const resp = await fetch(url.toString(), {
        headers: {
            'x-amz-access-token': token,
            'Content-Type': 'application/json',
        }
    });
    if (!resp.ok) throw new Error(`SP-API ${path} → ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

// ─── Inventaire FBA réel ─────────────────────────────────────────────────
async function getFBAInventory() {
    const data = await spRequest('/fba/inventory/v1/summaries', {
        details:      'true',
        granularityType: 'Marketplace',
        granularityId:   process.env.SP_MARKETPLACE_ID || MARKETPLACES.DE,
    });
    return (data.payload?.inventorySummaries || []).map(item => ({
        asin:           item.asin,
        fnsku:          item.fnsku,
        title:          item.productName,
        condition:      item.condition,
        available:      item.inventoryDetails?.fulfillableQuantity || 0,
        inbound:        item.inventoryDetails?.inboundWorkingQuantity || 0,
        reserved:       item.inventoryDetails?.reservedQuantity?.totalReservedQuantity || 0,
        total:          item.totalQuantity || 0,
    }));
}

// ─── Vérifier l'éligibilité (gating) d'un ASIN ───────────────────────────
async function checkGating(asin) {
    try {
        const data = await spRequest(`/listings/2021-08-01/restrictions`, {
            asin,
            conditionType: 'new_new',
        });
        const restrictions = data.restrictions || [];
        if (!restrictions.length) return { eligible: true };
        return {
            eligible: false,
            reason:   restrictions[0]?.reasons?.[0]?.message || 'Gated',
            approvalLink: restrictions[0]?.reasons?.[0]?.approvalLink || null,
        };
    } catch {
        return { eligible: null, error: 'SP-API unavailable' };
    }
}

// ─── Ventes des 30 derniers jours (vélocité) ─────────────────────────────
async function getSalesVelocity() {
    try {
        const end   = new Date().toISOString().split('T')[0];
        const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const data  = await spRequest('/sales/v1/orderMetrics', {
            interval:       `${start}T00:00:00-07:00--${end}T23:59:59-07:00`,
            granularity:    'Total',
            granularityTimeZone: 'Europe/Paris',
        });
        return data.payload || [];
    } catch { return []; }
}

module.exports = { isSPAPIAvailable, getFBAInventory, checkGating, getSalesVelocity, MARKETPLACES };
