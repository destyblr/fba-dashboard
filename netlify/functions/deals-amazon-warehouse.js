const fetch = require('node-fetch');
const cheerio = require('cheerio');

const DOMAINS = {
  fr: {
    url: 'https://www.amazon.fr/s?i=warehouse-deals&deals-widget=%257B%2522version%2522%253A1%252C%2522viewIndex%2522%253A0%252C%2522presetId%2522%253A%2522deals-collection-all-702C95F8-E206-4849-BCC1-C51ED6EBE00D%2522%252C%2522sorting%2522%253A%2522BY_SCORE%2522%257D',
    base: 'https://www.amazon.fr',
    merchant: 'Amazon Warehouse FR',
  },
  de: {
    url: 'https://www.amazon.de/s?i=warehouse-deals&deals-widget=%257B%2522version%2522%253A1%252C%2522viewIndex%2522%253A0%252C%2522presetId%2522%253A%2522deals-collection-all-702C95F8-E206-4849-BCC1-C51ED6EBE00D%2522%252C%2522sorting%2522%253A%2522BY_SCORE%2522%257D',
    base: 'https://www.amazon.de',
    merchant: 'Amazon Warehouse DE',
  },
};

function parsePrice(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^\d,\.]/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

exports.handler = async (event) => {
  const domain = (event.queryStringParameters && event.queryStringParameters.domain) || 'fr';
  const config = DOMAINS[domain] || DOMAINS.fr;
  const deals = [];

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': domain === 'de' ? 'de-DE,de;q=0.9' : 'fr-FR,fr;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  try {
    const res = await fetch(config.url, { headers: HEADERS, timeout: 12000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Amazon search result items
    $('[data-component-type="s-search-result"], .s-result-item[data-asin]').each((_, el) => {
      const $el = $(el);
      const asin = $el.attr('data-asin') || '';
      if (!asin) return;

      const title = $el.find('h2 a span, h2 span.a-text-normal').first().text().trim();
      const link = $el.find('h2 a.a-link-normal').first().attr('href') || '';
      const image = $el.find('img.s-image').first().attr('src') || '';
      const price = parsePrice($el.find('.a-price .a-offscreen').first().text());
      const originalPrice = parsePrice($el.find('.a-price[data-a-strike="true"] .a-offscreen, .a-text-price .a-offscreen').first().text());

      if (title) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `${config.base}${link}`,
          image,
          merchant: config.merchant,
          source: config.base.replace('https://', ''),
          ean: null, // Amazon does not expose EAN in search results
          category: $el.find('.a-color-secondary .a-size-base').first().text().trim() || null,
        });
      }
    });

    // NOTE: Amazon may block scrapers or require JS; returns [] if blocked
  } catch (err) {
    console.error(`deals-amazon-warehouse (${domain}) error:`, err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
