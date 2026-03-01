const fetch = require('node-fetch');

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const dealUrl = (event.queryStringParameters || {}).url;
    if (!dealUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing url parameter' }) };
    }

    // Mapping domaines Pepper → base URL
    const pepperDomains = {
        'dealabs.com': 'https://www.dealabs.com',
        'mydealz.de': 'https://www.mydealz.de',
        'chollometro.com': 'https://www.chollometro.com',
        'pepper.it': 'https://www.pepper.it'
    };

    let baseUrl = null;
    for (const [domain, base] of Object.entries(pepperDomains)) {
        if (dealUrl.includes(domain)) {
            baseUrl = base;
            break;
        }
    }
    if (!baseUrl) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL must be from a Pepper network site' }) };
    }

    try {
        // Extraire le thread ID depuis l'URL (dernier nombre dans le path)
        const threadIdMatch = dealUrl.match(/(\d{5,})(?:\?|$|#)/);
        const threadIdFallback = dealUrl.match(/(\d{5,})/g);
        const threadId = threadIdMatch ? threadIdMatch[1] : (threadIdFallback ? threadIdFallback[threadIdFallback.length - 1] : null);

        if (!threadId) {
            return { statusCode: 200, headers, body: JSON.stringify({ asin: null, error: 'No thread ID found in URL' }) };
        }

        let asin = null;
        let merchantUrl = null;

        // Methode 1 : Suivre la redirection visit/threadmain/{threadId}
        const visitUrl = baseUrl + '/visit/threadmain/' + threadId;
        console.log('[resolve-pepper] Visit URL: ' + visitUrl);

        try {
            const resp = await fetch(visitUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html',
                    'Referer': dealUrl
                },
                redirect: 'manual',
                timeout: 8000
            });

            let location = resp.headers.get('location');
            console.log('[resolve-pepper] Redirect 1: ' + location);

            // Suivre jusqu'a 5 redirections pour trouver l'URL finale Amazon
            let hops = 0;
            while (location && hops < 5) {
                // Chercher ASIN dans l'URL courante
                const asinMatch = location.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
                if (asinMatch) {
                    asin = asinMatch[1].toUpperCase();
                    merchantUrl = location;
                    break;
                }

                // Si c'est une URL Amazon mais sans ASIN visible, suivre encore
                if (location.match(/amazon\.(fr|de|com|co\.uk|it|es)/i)) {
                    merchantUrl = location;
                    // Essayer de suivre pour obtenir l'URL finale
                    try {
                        const nextResp = await fetch(location, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                            redirect: 'manual',
                            timeout: 5000
                        });
                        const nextLoc = nextResp.headers.get('location');
                        if (nextLoc) {
                            const m = nextLoc.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
                            if (m) {
                                asin = m[1].toUpperCase();
                                merchantUrl = nextLoc;
                            }
                            location = nextLoc;
                        } else {
                            // Pas de redirect, lire le body pour chercher l'ASIN
                            const body = await nextResp.text();
                            const bodyMatch = body.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
                            if (bodyMatch) {
                                asin = bodyMatch[1].toUpperCase();
                            }
                            break;
                        }
                    } catch (e) {
                        break;
                    }
                } else {
                    // Pas Amazon, suivre le redirect
                    try {
                        const nextResp = await fetch(location, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                            redirect: 'manual',
                            timeout: 5000
                        });
                        location = nextResp.headers.get('location');
                        console.log('[resolve-pepper] Redirect ' + (hops + 2) + ': ' + location);
                    } catch (e) {
                        break;
                    }
                }
                hops++;
            }
        } catch (e) {
            console.log('[resolve-pepper] Visit redirect failed: ' + e.message);
        }

        // Methode 2 fallback : Fetcher la page et chercher dans __INITIAL_STATE__ / __RESPONSE_DATA__
        if (!asin) {
            try {
                const pageResp = await fetch(dealUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html'
                    },
                    redirect: 'follow',
                    timeout: 8000
                });
                const html = await pageResp.text();

                // Chercher ASIN directement dans le HTML (parfois dans les commentaires, scripts, etc.)
                const htmlAsinMatch = html.match(/\/dp\/([A-Z0-9]{10})/i);
                if (htmlAsinMatch) {
                    asin = htmlAsinMatch[1].toUpperCase();
                }

                // Chercher dans linkCloaked patterns
                if (!asin) {
                    const cloakMatch = html.match(/linkCloaked[^"]*":\s*"([^"]+)"/g);
                    if (cloakMatch) {
                        for (const m of cloakMatch) {
                            const urlMatch = m.match(/"(https?:\/\/[^"]+)"/);
                            if (urlMatch && urlMatch[1].includes('/visit/')) {
                                // On a deja essaye avec threadmain, pas besoin de re-fetcher
                                break;
                            }
                        }
                    }
                }

                // Chercher un pattern B0XXXXXXXXX dans le texte
                if (!asin) {
                    const b0Match = html.match(/\b(B0[A-Z0-9]{8})\b/g);
                    if (b0Match) {
                        asin = b0Match[0];
                    }
                }
            } catch (e) {
                console.log('[resolve-pepper] Page fetch fallback failed: ' + e.message);
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ asin, merchantUrl, threadId })
        };

    } catch (e) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: e.message })
        };
    }
};
