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
    const url = 'https://www.rueducommerce.fr/rayon/bons-plans';
    const res = await fetch(url, { headers: HEADERS, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Rue du Commerce product cards
    $('.product-item, .product-card, [class*="product-list"] article, .item-product').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.product-item__title, .product-card__title, [class*="title"] a, h2 a').first().text().trim();
      const link = $el.find('a[href*="/p/"]').first().attr('href') || $el.find('a').first().attr('href') || '';
      const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
      const price = parsePrice($el.find('.price--current, .product-item__price, [class*="price"]:not([class*="old"])').first().text());
      const originalPrice = parsePrice($el.find('.price--old, .product-item__oldPrice, [class*="crossed"]').first().text());
      const ean = $el.attr('data-ean') || $el.find('[data-ean]').attr('data-ean') || null;

      if (title) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `https://www.rueducommerce.fr${link}`,
          image,
          merchant: 'Rue du Commerce',
          source: 'rueducommerce.fr',
          ean,
          category: $el.find('[class*="category"], [class*="family"]').first().text().trim() || null,
        });
      }
    });

    // NOTE: Rue du Commerce uses heavy client-side rendering; static scrape may return []
  } catch (err) {
    console.error('deals-rueducommerce error:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
