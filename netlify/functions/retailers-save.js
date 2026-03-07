const { getStore: _getStore } = require('@netlify/blobs');
function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

const DEFAULT_RETAILERS = [
    { id: 'easypara',           name: 'Easypara',          url: 'https://www.easypara.fr',             type: 'prestashop', category: 'beaute',       days: [1,4],   maxProducts: 200, active: true },
    { id: 'sante-discount',     name: 'Santé Discount',    url: 'https://www.sante-discount.fr',       type: 'prestashop', category: 'beaute',       days: [0,3],   maxProducts: 150, active: true },
    { id: 'aroma-zone',         name: 'Aroma Zone',        url: 'https://www.aroma-zone.com',          type: 'generic',    category: 'beaute',       days: [2,5],   maxProducts: 150, active: true },
    { id: 'pharma-gdd',         name: 'Pharma GDD',        url: 'https://www.pharma-gdd.com',          type: 'prestashop', category: 'beaute',       days: [1,6],   maxProducts: 150, active: true },
    { id: '1001hobbies',        name: '1001Hobbies',       url: 'https://www.1001hobbies.fr',          type: 'prestashop', category: 'jouets',       days: [0,2,5], maxProducts: 200, active: true },
    { id: 'joueclub',           name: 'Joué Club',         url: 'https://www.joueclub.fr',             type: 'prestashop', category: 'jouets',       days: [2,5],   maxProducts: 200, active: true },
    { id: 'kingjouet',          name: 'King Jouet',        url: 'https://www.king-jouet.com',          type: 'generic',    category: 'jouets',       days: [1,4],   maxProducts: 200, active: true },
    { id: 'lagranderecre',      name: 'La Grande Récré',   url: 'https://www.lagranderecre.fr',        type: 'generic',    category: 'jouets',       days: [0,3],   maxProducts: 150, active: true },
    { id: 'maxitoys',           name: 'Maxi Toys',         url: 'https://www.maxitoys.fr',             type: 'prestashop', category: 'jouets',       days: [2,6],   maxProducts: 150, active: true },
    { id: 'oxybul',             name: 'Oxybul',            url: 'https://www.oxybul.com',              type: 'generic',    category: 'jouets',       days: [0,4],   maxProducts: 150, active: true },
    { id: 'picwictoys',         name: 'Picwic Toys',       url: 'https://www.picwictoys.com',          type: 'prestashop', category: 'jouets',       days: [1,5],   maxProducts: 150, active: true },
    { id: 'bureauvallee',       name: 'Bureau Vallée',     url: 'https://www.bureauvallee.fr',         type: 'generic',    category: 'informatique', days: [1,4],   maxProducts: 150, active: true },
    { id: 'topachat',           name: 'Top Achat',         url: 'https://www.topachat.com',            type: 'generic',    category: 'informatique', days: [0,3],   maxProducts: 150, active: true },
    { id: 'materielnet',        name: 'Materiel.net',      url: 'https://www.materiel.net',            type: 'generic',    category: 'informatique', days: [2,5],   maxProducts: 150, active: true },
    { id: 'ldlc',               name: 'LDLC',              url: 'https://www.ldlc.com',                type: 'generic',    category: 'informatique', days: [1,6],   maxProducts: 150, active: true },
    { id: 'zoomalia',           name: 'Zoomalia',          url: 'https://www.zoomalia.com',            type: 'prestashop', category: 'animalerie',   days: [0,3],   maxProducts: 200, active: true },
    { id: 'wanimo',             name: 'Wanimo',            url: 'https://www.wanimo.com',              type: 'prestashop', category: 'animalerie',   days: [2,5],   maxProducts: 150, active: true },
    { id: 'animalis',           name: 'Animalis',          url: 'https://www.animalis.com',            type: 'generic',    category: 'animalerie',   days: [1,4],   maxProducts: 150, active: true },
    { id: 'alicedelice',        name: 'Alice Délice',      url: 'https://www.alicedelice.com',         type: 'prestashop', category: 'cuisine',      days: [0,4],   maxProducts: 150, active: true },
    { id: 'mathon',             name: 'Mathon',            url: 'https://www.mathon.fr',               type: 'prestashop', category: 'cuisine',      days: [2,6],   maxProducts: 150, active: true },
    { id: 'cuisineaddict',      name: 'Cuisine Addict',    url: 'https://www.cuisineaddict.com',       type: 'prestashop', category: 'cuisine',      days: [1,5],   maxProducts: 150, active: true },
    { id: 'meilleurduchef',     name: 'Meilleur du Chef',  url: 'https://www.meilleurduchef.com',      type: 'prestashop', category: 'cuisine',      days: [3,6],   maxProducts: 100, active: true },
    { id: 'probikeshop',        name: 'Probikeshop',       url: 'https://www.probikeshop.fr',          type: 'prestashop', category: 'sport',        days: [0,3],   maxProducts: 150, active: true },
    { id: 'alltricks',          name: 'Alltricks',         url: 'https://www.alltricks.fr',            type: 'generic',    category: 'sport',        days: [2,5],   maxProducts: 150, active: true },
    { id: 'cultura',            name: 'Cultura',           url: 'https://www.cultura.com',             type: 'generic',    category: 'culture',      days: [1,4],   maxProducts: 150, active: true },
    { id: 'aubert',             name: 'Aubert',            url: 'https://www.aubert.com',              type: 'generic',    category: 'bebe',         days: [0,4],   maxProducts: 150, active: true },
    { id: 'bambinou',           name: 'Bambinou',          url: 'https://www.bambinou.com',            type: 'prestashop', category: 'bebe',         days: [2,5],   maxProducts: 100, active: true },
    { id: 'jardindeco',         name: 'Jardindeco',        url: 'https://www.jardindeco.com',          type: 'prestashop', category: 'jardin',       days: [1,5],   maxProducts: 100, active: true },
    { id: 'plantes-et-jardins', name: 'Plantes & Jardins', url: 'https://www.plantes-et-jardins.com', type: 'prestashop', category: 'jardin',       days: [3,6],   maxProducts: 100, active: true },
    { id: 'fnac',               name: 'Fnac',              url: 'https://www.fnac.com',                type: 'generic',    category: 'informatique', days: [1,4],   maxProducts: 150, active: true },
    // ── GRANDS RETAILERS MULTI-CATÉGORIES ───────────────────────────────────
    { id: 'leclerc',            name: 'E.Leclerc',         url: 'https://www.e.leclerc',               type: 'generic',    category: 'multi',        days: [3,6],   maxProducts: 200, active: true },
    { id: 'darty',              name: 'Darty',             url: 'https://www.darty.com',               type: 'generic',    category: 'informatique', days: [0,4],   maxProducts: 150, active: true },
    { id: 'cdiscount',          name: 'Cdiscount',         url: 'https://www.cdiscount.com',           type: 'generic',    category: 'multi',        days: [2,3],   maxProducts: 200, active: true },
    { id: 'boulanger',          name: 'Boulanger',         url: 'https://www.boulanger.com',           type: 'generic',    category: 'informatique', days: [0,3],   maxProducts: 150, active: true },
    { id: 'conforama',          name: 'Conforama',         url: 'https://www.conforama.fr',            type: 'generic',    category: 'maison',       days: [3,6],   maxProducts: 150, active: true },
    { id: 'manomano',           name: 'ManoMano',          url: 'https://www.manomano.fr',             type: 'generic',    category: 'bricolage',    days: [0,6],   maxProducts: 150, active: true },
    { id: 'decathlon',          name: 'Decathlon',         url: 'https://www.decathlon.fr',            type: 'generic',    category: 'sport',        days: [4,6],   maxProducts: 200, active: true },
    { id: 'maisonsdumonde',     name: 'Maisons du Monde',  url: 'https://www.maisonsdumonde.com',      type: 'generic',    category: 'maison',       days: [2,6],   maxProducts: 100, active: true },
    { id: 'natureetdecouvertes',name: 'Nature & Découvertes', url: 'https://www.natureetdecouvertes.com', type: 'generic', category: 'culture',     days: [3,6],   maxProducts: 100, active: true },
];

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' } };
    }

    const store = getStore('oa-catalog');

    if (event.httpMethod === 'GET') {
        try {
            let retailers = await store.get('retailers', { type: 'json' });
            // Auto-restaure si blob absent ou corrompu (< 5 retailers)
            if (!retailers || retailers.length < 5) {
                retailers = DEFAULT_RETAILERS;
                await store.setJSON('retailers', retailers);
            }
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ retailers })
            };
        } catch (err) {
            return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const body = JSON.parse(event.body || '{}');
            let retailers = [];
            try { retailers = await store.get('retailers', { type: 'json' }) ?? []; } catch {}

            if (body.action === 'save') {
                const r = body.retailer;
                if (!r || !r.name || !r.url) return { statusCode: 400, body: 'name and url required' };
                r.id = r.id || r.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
                const idx = retailers.findIndex(x => x.id === r.id);
                if (idx >= 0) retailers[idx] = r;
                else retailers.push(r);
            } else if (body.action === 'delete') {
                retailers = retailers.filter(r => r.id !== body.id);
            } else if (body.action === 'toggle') {
                const r = retailers.find(r => r.id === body.id);
                if (r) r.active = !r.active;
            }

            await store.setJSON('retailers', retailers);
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ ok: true, retailers })
            };
        } catch (err) {
            return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) };
        }
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
};
