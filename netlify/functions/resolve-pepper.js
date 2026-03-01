const fetch = require('node-fetch');
const cheerio = require('cheerio');

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

    // Verifier que c'est bien un site Pepper
    const allowedDomains = ['dealabs.com', 'mydealz.de', 'chollometro.com', 'pepper.it', 'pepper.pl', 'hotukdeals.com'];
    const isDealSite = allowedDomains.some(d => dealUrl.includes(d));
    if (!isDealSite) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL must be from a Pepper network site' }) };
    }

    try {
        // 1. Fetcher la page du deal
        const resp = await fetch(dealUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
            },
            redirect: 'follow',
            timeout: 8000
        });

        const html = await resp.text();
        const $ = cheerio.load(html);

        let asin = null;
        let merchantUrl = null;

        // Methode 1 : Chercher des liens Amazon dans la page
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (href.match(/amazon\.(fr|de|com|co\.uk|it|es)/i)) {
                const asinMatch = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
                if (asinMatch) {
                    asin = asinMatch[1].toUpperCase();
                    merchantUrl = href;
                    return false; // break
                }
            }
        });

        // Methode 2 : Chercher /dp/ASIN dans tout le HTML
        if (!asin) {
            const dpMatches = html.match(/\/dp\/([A-Z0-9]{10})/gi);
            if (dpMatches) {
                for (const m of dpMatches) {
                    const asinMatch = m.match(/\/dp\/([A-Z0-9]{10})/i);
                    if (asinMatch) {
                        asin = asinMatch[1].toUpperCase();
                        break;
                    }
                }
            }
        }

        // Methode 3 : Chercher dans les donnees structurees JSON-LD
        if (!asin) {
            $('script[type="application/ld+json"]').each((i, el) => {
                try {
                    const jsonStr = $(el).html();
                    const asinMatch = jsonStr.match(/\/dp\/([A-Z0-9]{10})/i);
                    if (asinMatch) {
                        asin = asinMatch[1].toUpperCase();
                        return false;
                    }
                } catch (e) {}
            });
        }

        // Methode 4 : Chercher dans les attributs data-* (Pepper utilise souvent data-merchant-url, etc.)
        if (!asin) {
            $('[data-merchant-url], [data-url]').each((i, el) => {
                const url = $(el).attr('data-merchant-url') || $(el).attr('data-url') || '';
                if (url.match(/amazon\.(fr|de|com|co\.uk|it|es)/i)) {
                    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
                    if (asinMatch) {
                        asin = asinMatch[1].toUpperCase();
                        merchantUrl = url;
                        return false;
                    }
                }
            });
        }

        // Methode 5 : Chercher le lien "Voir le deal" / "Go to deal" et suivre la redirection
        if (!asin) {
            let visitUrl = null;
            // Selecteurs courants Pepper
            $('a.cept-dealBtn, a[data-t="dealLink"], a[href*="/visit/"], a.threadItemCard-action--link').each((i, el) => {
                const href = $(el).attr('href');
                if (href) {
                    visitUrl = href;
                    return false;
                }
            });

            if (visitUrl) {
                // Rendre l'URL absolue
                if (visitUrl.startsWith('/')) {
                    try {
                        const urlObj = new URL(dealUrl);
                        visitUrl = urlObj.origin + visitUrl;
                    } catch (e) {}
                }

                try {
                    // Suivre la redirection (1 seul niveau)
                    const redirectResp = await fetch(visitUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        },
                        redirect: 'manual',
                        timeout: 5000
                    });
                    const location = redirectResp.headers.get('location');
                    if (location) {
                        merchantUrl = location;
                        const asinMatch = location.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
                        if (asinMatch) {
                            asin = asinMatch[1].toUpperCase();
                        }

                        // Si 1er redirect n'a pas l'ASIN, essayer un 2e niveau
                        if (!asin && location.match(/amazon/i)) {
                            try {
                                const rr2 = await fetch(location, {
                                    headers: { 'User-Agent': 'Mozilla/5.0' },
                                    redirect: 'manual',
                                    timeout: 5000
                                });
                                const loc2 = rr2.headers.get('location');
                                if (loc2) {
                                    const m2 = loc2.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
                                    if (m2) {
                                        asin = m2[1].toUpperCase();
                                        merchantUrl = loc2;
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                } catch (e) {
                    // Timeout ou erreur reseau
                }
            }
        }

        // Methode 6 : Chercher un pattern BXXXXXXXXX (ASIN) dans le texte visible
        if (!asin) {
            const bodyText = $('body').text();
            const asinPattern = bodyText.match(/\b(B0[A-Z0-9]{8})\b/g);
            if (asinPattern && asinPattern.length > 0) {
                asin = asinPattern[0];
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ asin, merchantUrl })
        };

    } catch (e) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: e.message })
        };
    }
};
