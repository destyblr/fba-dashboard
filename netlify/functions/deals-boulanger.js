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
    const url = 'https://www.boulanger.com/c/bons-plans';
    const res = await fetch(url, { headers: HEADERS, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Boulanger uses structured product cards
    $('.productList__item, .product-card, [class*="product-list"] article, .product-item').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.product-card__title, .productList__title, [class*="label"] a, h2 a').first().text().trim();
      const link = $el.find('a[href*="/ref/"]').first().attr('href') || $el.find('a').first().attr('href') || '';
      const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
      const price = parsePrice($el.find('.price--current, .productList__price, [class*="price"]:not([class*="old"])').first().text());
      const originalPrice = parsePrice($el.find('.price--old, .productList__oldPrice, [class*="crossed"]').first().text());
      const ean = $el.attr('data-ean') || $el.find('[data-ean]').attr('data-ean') || null;

      if (title) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `https://www.boulanger.com${link}`,
          image,
          merchant: 'Boulanger',
          source: 'boulanger.com',
          ean,
          category: $el.find('[class*="category"], [class*="family"]').first().text().trim() || null,
        });
      }
    });

    // NOTE: Boulanger may use client-side rendering; static scrape may return []
  } catch (err) {
    console.error('deals-boulanger error:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
