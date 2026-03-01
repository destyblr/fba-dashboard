const fetch = require('node-fetch');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function parsePrice(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^\d,\.]/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

exports.handler = async () => {
  const deals = [];
  try {
    const url = 'https://www.fnac.com/SearchResult/ResultList.aspx?SCat=0%211&sft=1&Search=';
    const res = await fetch(url, { headers: HEADERS, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Fnac uses .Article-item containers; selectors may change over time
    $('.Article-item, .js-Search-hash498, [class*="product-item"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.Article-desc a, .Article-title a, [class*="title"] a').first().text().trim();
      const link = $el.find('.Article-desc a, .Article-title a, [class*="title"] a').first().attr('href') || '';
      const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
      const price = parsePrice($el.find('.userPrice .finalPrice, .Price--current, [class*="price"]').first().text());
      const originalPrice = parsePrice($el.find('.oldPrice, .Price--old, [class*="crossed"]').first().text());
      const ean = $el.attr('data-ean') || $el.find('[data-ean]').attr('data-ean') || null;

      if (title) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `https://www.fnac.com${link}`,
          image,
          merchant: 'Fnac',
          source: 'fnac.com',
          ean,
          category: $el.find('.Article-family, [class*="category"]').first().text().trim() || null,
        });
      }
    });

    // NOTE: Fnac may render content client-side via JS; in that case this returns []
  } catch (err) {
    console.error('deals-fnac error:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
