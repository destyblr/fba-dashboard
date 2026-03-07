const { getStore: _getStore } = require('@netlify/blobs');
const Anthropic = require('@anthropic-ai/sdk');

function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

// ── Retailers par défaut (même liste que retailers-save.js) ──────────────────

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
];

async function loadRetailers(catalogStore) {
    try { return (await catalogStore.get('retailers', { type: 'json' })) || DEFAULT_RETAILERS; } catch { return DEFAULT_RETAILERS; }
}

// ── Implémentation des outils ────────────────────────────────────────────────

const DAY_MAP = { lundi:1, mardi:2, mercredi:3, jeudi:4, vendredi:5, samedi:6, dimanche:0, lun:1, mar:2, mer:3, jeu:4, ven:5, sam:6, dim:0 };

function parseDays(daysInput) {
    if (Array.isArray(daysInput)) return daysInput.map(d => typeof d === 'number' ? d : (DAY_MAP[String(d).toLowerCase()] ?? 1));
    if (typeof daysInput === 'string') return daysInput.split(/[,\s]+/).map(d => DAY_MAP[d.toLowerCase().trim()] ?? 1);
    return [1, 4];
}

async function tool_add_retailer({ name, url, category, days, maxProducts, type }) {
    const catalogStore = getStore('oa-catalog');
    let retailers = await loadRetailers(catalogStore);
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const r = { id, name, url: url || '', category: category || 'general', type: type || 'generic', days: parseDays(days || [1,4]), maxProducts: maxProducts || 150, active: true };
    const idx = retailers.findIndex(x => x.id === id);
    if (idx >= 0) retailers[idx] = r; else retailers.push(r);
    await catalogStore.setJSON('retailers', retailers);
    return { ok: true, message: `${name} ajouté aux Sources actives (scan : ${r.days.join(', ')})` };
}

async function tool_toggle_retailer({ id, active }) {
    const catalogStore = getStore('oa-catalog');
    let retailers = await loadRetailers(catalogStore);
    const r = retailers.find(x => x.id === id || x.name.toLowerCase() === id.toLowerCase());
    if (!r) return { ok: false, message: `Retailer "${id}" introuvable` };
    r.active = active !== undefined ? active : !r.active;
    await catalogStore.setJSON('retailers', retailers);
    return { ok: true, message: `${r.name} ${r.active ? 'activé' : 'désactivé'}` };
}

async function tool_update_retailer({ id, days, maxProducts, category }) {
    const catalogStore = getStore('oa-catalog');
    let retailers = await loadRetailers(catalogStore);
    const r = retailers.find(x => x.id === id || x.name.toLowerCase() === id.toLowerCase());
    if (!r) return { ok: false, message: `Retailer "${id}" introuvable` };
    if (days !== undefined) r.days = parseDays(days);
    if (maxProducts !== undefined) r.maxProducts = maxProducts;
    if (category !== undefined) r.category = category;
    await catalogStore.setJSON('retailers', retailers);
    return { ok: true, message: `${r.name} mis à jour` };
}

async function tool_remove_retailer({ id }) {
    const catalogStore = getStore('oa-catalog');
    let retailers = await loadRetailers(catalogStore);
    const before = retailers.length;
    retailers = retailers.filter(x => x.id !== id && x.name.toLowerCase() !== id.toLowerCase());
    await catalogStore.setJSON('retailers', retailers);
    return { ok: true, message: before > retailers.length ? `${id} supprimé` : `"${id}" introuvable` };
}

async function tool_get_pipeline_stats() {
    const catalogStore = getStore('oa-catalog');
    try {
        const raw = await catalogStore.get('raw-products', { type: 'json' }) || [];
        const enriched = await catalogStore.get('enriched-products', { type: 'json' }) || [];
        const withEan = raw.filter(p => p.ean).length;
        return { rawTotal: raw.length, withEan, enrichedTotal: enriched.length, profitable: enriched.filter(p => p.profit > 5).length };
    } catch (e) { return { error: e.message }; }
}

async function tool_get_catalog({ limit = 10 }) {
    const catalogStore = getStore('oa-catalog');
    try {
        const products = await catalogStore.get('enriched-products', { type: 'json' }) || [];
        const top = products.filter(p => p.profit > 0).sort((a, b) => (b.profit || 0) - (a.profit || 0)).slice(0, limit);
        return { count: products.length, top: top.map(p => ({ title: p.title, profit: p.profit, roi: p.roi, retailer: p.retailer, price: p.price })) };
    } catch (e) { return { error: e.message }; }
}

async function tool_send_telegram({ message }) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { ok: false, message: 'Variables Telegram non configurées' };
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
    return resp.ok ? { ok: true, message: 'Message Telegram envoyé' } : { ok: false, message: 'Erreur Telegram' };
}

async function tool_update_criteria({ minProfit, minRoi, maxSellers, maxBsr }) {
    const store = getStore('oa-portfolio');
    let settings = {};
    try { settings = await store.get('user-settings', { type: 'json' }) || {}; } catch {}
    if (minProfit !== undefined) settings.strictMinProfit = minProfit;
    if (minRoi !== undefined) settings.strictMinRoi = minRoi;
    if (maxSellers !== undefined) settings.strictMaxSellers = maxSellers;
    if (maxBsr !== undefined) settings.strictMaxBsr = maxBsr;
    await store.setJSON('user-settings', settings);
    return { ok: true, message: `Critères mis à jour — profit min: ${settings.strictMinProfit}€, ROI min: ${settings.strictMinRoi}%` };
}

const TOOL_HANDLERS = {
    add_retailer: tool_add_retailer,
    toggle_retailer: tool_toggle_retailer,
    update_retailer: tool_update_retailer,
    remove_retailer: tool_remove_retailer,
    get_pipeline_stats: tool_get_pipeline_stats,
    get_catalog: tool_get_catalog,
    send_telegram: tool_send_telegram,
    update_criteria: tool_update_criteria,
};

const LEADER_TOOLS = [
    { name: 'add_retailer', description: 'Ajoute un nouveau retailer/fournisseur à la liste Sources actives', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Nom du retailer' }, url: { type: 'string', description: 'URL du site' }, category: { type: 'string', description: 'Catégorie (beaute, jouets, informatique, etc.)' }, days: { description: 'Jours de scan (noms ou numéros 0=dim, 1=lun...)' }, maxProducts: { type: 'number', description: 'Max produits à scraper' } }, required: ['name'] } },
    { name: 'toggle_retailer', description: 'Active ou désactive un retailer', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'ID ou nom du retailer' }, active: { type: 'boolean', description: 'true=activer, false=désactiver, omis=inverser' } }, required: ['id'] } },
    { name: 'update_retailer', description: 'Modifie les paramètres d\'un retailer (jours, maxProducts, catégorie)', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'ID ou nom du retailer' }, days: { description: 'Nouveaux jours de scan' }, maxProducts: { type: 'number' }, category: { type: 'string' } }, required: ['id'] } },
    { name: 'remove_retailer', description: 'Supprime définitivement un retailer', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'ID ou nom du retailer' } }, required: ['id'] } },
    { name: 'get_pipeline_stats', description: 'Lit les statistiques du pipeline (produits bruts, EAN, enrichis, rentables)', input_schema: { type: 'object', properties: {} } },
    { name: 'get_catalog', description: 'Consulte les meilleurs deals du catalogue enrichi', input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Nombre de deals à retourner (défaut 10)' } } } },
    { name: 'send_telegram', description: 'Envoie un message Telegram à l\'utilisateur', input_schema: { type: 'object', properties: { message: { type: 'string', description: 'Contenu du message' } }, required: ['message'] } },
    { name: 'update_criteria', description: 'Met à jour les critères de rentabilité du sourcing', input_schema: { type: 'object', properties: { minProfit: { type: 'number', description: 'Profit minimum en €' }, minRoi: { type: 'number', description: 'ROI minimum en %' }, maxSellers: { type: 'number' }, maxBsr: { type: 'number' } } } },
];

const AGENT_PERSONAS = {
    catalog: {
        name: 'Agent Catalog',
        system: `Tu es l'Agent Catalog d'un dashboard Amazon FBA OA (Online Arbitrage).
Tu scrapes les retailers français (Fnac, Cdiscount, Boulanger, LDLC, etc.) pour extraire des produits avec leur EAN.
Tu tournes automatiquement selon un planning défini par le Team Leader.
Réponds de façon concise et professionnelle à la consigne de l'utilisateur. Confirme ce que tu vas faire, mentionne des impacts éventuels sur ton planning ou tes paramètres. Max 3 phrases.`
    },
    enricher: {
        name: 'Agent Enricher',
        system: `Tu es l'Agent Enricher d'un dashboard Amazon FBA OA (Online Arbitrage).
Tu prends les produits bruts avec EAN et tu fais des lookups Keepa pour récupérer le prix Amazon, le BSR et l'historique sur DE/FR/IT/ES.
Tu gères une file d'attente Keepa (tokens limités : 1/min, 60 en stock).
Réponds de façon concise et professionnelle à la consigne de l'utilisateur. Confirme ce que tu vas faire, mentionne les contraintes de tokens si pertinent. Max 3 phrases.`
    },
    sourcing: {
        name: 'Agent Sourcing',
        system: `Tu es l'Agent Sourcing d'un dashboard Amazon FBA OA (Online Arbitrage).
Tu analyses les produits enrichis du pipeline, calcules la rentabilité (profit, ROI, FBA fees) et envoies des alertes Telegram pour les deals avec profit > 5€ et ROI > 35%.
Réponds de façon concise et professionnelle à la consigne de l'utilisateur. Confirme ce que tu vas appliquer comme critères ou priorités. Max 3 phrases.`
    },
    leader: {
        name: 'Team Leader',
        system: `Tu es le Team Leader d'un dashboard Amazon FBA OA (Online Arbitrage).
Tu orchestres tous les agents (Catalog, Enricher, Sourcing, Inventaire), ajustes les retailers chaque lundi selon les performances, et envoies des décisions stratégiques via Telegram.
Réponds de façon concise et professionnelle à la consigne de l'utilisateur. Confirme les actions que tu vas prendre, mentionne les agents impactés si pertinent. Max 3 phrases.`
    },
    inventory: {
        name: 'Agent Inventaire',
        system: `Tu es l'Agent Inventaire d'un dashboard Amazon FBA OA (Online Arbitrage).
Tu surveilles les produits en pipeline FBA : délais dépassés, ruptures de stock, capital immobilisé par étape.
Réponds de façon concise et professionnelle à la consigne de l'utilisateur. Confirme ce que tu vas surveiller ou alerter. Max 3 phrases.`
    },
    deals: {
        name: 'Agent Sourcing',
        system: `Tu es l'Agent Sourcing d'un dashboard Amazon FBA OA (Online Arbitrage).
Tu analyses les produits enrichis du pipeline, calcules la rentabilité (profit, ROI, FBA fees) et envoies des alertes Telegram pour les deals avec profit > 5€ et ROI > 35%.
Réponds de façon concise et professionnelle à la consigne de l'utilisateur. Confirme ce que tu vas appliquer comme critères ou priorités. Max 3 phrases.`
    }
};

exports.handler = async (event) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' } };
    }

    const store = getStore('oa-portfolio');

    if (event.httpMethod === 'GET') {
        try {
            const instructions = await store.get('agent-instructions', { type: 'json' }) || {};
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, instructions }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    if (event.httpMethod === 'POST') {
        try {
            const { agent, instruction, action } = JSON.parse(event.body || '{}');
            if (!agent) return { statusCode: 400, headers, body: JSON.stringify({ error: 'agent requis' }) };

            // Charger l'historique de conversation
            let conversations = {};
            try { conversations = await store.get('agent-conversations', { type: 'json' }) || {}; } catch {}
            if (!conversations[agent]) conversations[agent] = [];

            // Action reset : vider l'historique
            if (action === 'reset') {
                conversations[agent] = [];
                await store.setJSON('agent-conversations', conversations);
                return { statusCode: 200, headers, body: JSON.stringify({ ok: true, history: [] }) };
            }

            if (!instruction) return { statusCode: 400, headers, body: JSON.stringify({ error: 'instruction requise' }) };

            // Sauvegarder la consigne (dernière uniquement, pour les agents cron)
            let instructions = {};
            try { instructions = await store.get('agent-instructions', { type: 'json' }) || {}; } catch {}
            instructions[agent] = { text: instruction, ts: new Date().toISOString(), status: 'pending' };
            await store.setJSON('agent-instructions', instructions);

            // Ajouter le message user à l'historique
            conversations[agent].push({ role: 'user', content: instruction });

            // Garder max 20 échanges (40 messages)
            if (conversations[agent].length > 40) conversations[agent] = conversations[agent].slice(-40);

            // Générer une réponse via Claude avec tout l'historique
            const persona = AGENT_PERSONAS[agent] || AGENT_PERSONAS.leader;
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const isLeader = agent === 'leader';
            const tools = isLeader ? LEADER_TOOLS : undefined;
            const actionsPerformed = [];

            // Boucle agentique : Claude peut appeler plusieurs outils
            let currentMessages = [...conversations[agent]];
            let reply = 'Consigne prise en compte.';

            for (let i = 0; i < 5; i++) {
                const params = { model: 'claude-sonnet-4-6', max_tokens: 500, system: persona.system, messages: currentMessages };
                if (tools) params.tools = tools;
                const message = await anthropic.messages.create(params);

                if (message.stop_reason === 'tool_use') {
                    // Exécuter les outils demandés
                    const toolResults = [];
                    for (const block of message.content) {
                        if (block.type === 'tool_use') {
                            const handler = TOOL_HANDLERS[block.name];
                            const result = handler ? await handler(block.input) : { error: 'Outil inconnu' };
                            actionsPerformed.push({ tool: block.name, result });
                            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
                        }
                    }
                    currentMessages = [...currentMessages, { role: 'assistant', content: message.content }, { role: 'user', content: toolResults }];
                } else {
                    reply = message.content.find(b => b.type === 'text')?.text || 'Fait.';
                    currentMessages = [...currentMessages, { role: 'assistant', content: message.content }];
                    break;
                }
            }

            // Sauvegarder seulement les messages text dans l'historique (pas les tool_use)
            conversations[agent].push({ role: 'assistant', content: reply });
            await store.setJSON('agent-conversations', conversations);

            // Loguer dans le journal d'activité si des outils ont été exécutés
            if (actionsPerformed.length > 0) {
                try {
                    const activityStore = getStore('oa-activity');
                    let log = [];
                    try { log = await activityStore.get('log', { type: 'json' }) || []; } catch {}
                    const actionSummary = actionsPerformed.map(a => a.result?.message || a.tool).join(' · ');
                    log.unshift({
                        ts: Date.now(),
                        agent: 'leader',
                        summary: `Instruction manuelle · ${actionSummary}`,
                        stats: { actionsCount: actionsPerformed.length, actions: actionsPerformed.map(a => a.tool) },
                        instruction: instruction.slice(0, 100)
                    });
                    await activityStore.setJSON('log', log.slice(0, 100));
                } catch {}
            }

            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, reply, agent: persona.name, history: conversations[agent], actions: actionsPerformed }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
