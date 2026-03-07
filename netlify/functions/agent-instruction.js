const { getStore: _getStore } = require('@netlify/blobs');
const Anthropic = require('@anthropic-ai/sdk');

function getStore(name) {
    return _getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
}

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
            const message = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 300,
                system: persona.system,
                messages: conversations[agent]
            });
            const reply = message.content[0]?.text || 'Consigne prise en compte.';

            // Ajouter la réponse à l'historique et sauvegarder
            conversations[agent].push({ role: 'assistant', content: reply });
            await store.setJSON('agent-conversations', conversations);

            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, reply, agent: persona.name, history: conversations[agent] }) };
        } catch (err) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
