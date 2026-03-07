exports.handler = async (event) => {
    const p = (event.queryStringParameters || {}).p;
    const PASS = process.env.DASHBOARD_PASSWORD;

    if (!PASS) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: false, error: 'DASHBOARD_PASSWORD non défini dans les variables Netlify' })
        };
    }

    if (p && p === PASS) {
        const token = Buffer.from(Date.now() + ':' + Math.random()).toString('base64');
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok: true, token })
        };
    }

    return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Mot de passe incorrect' })
    };
};
