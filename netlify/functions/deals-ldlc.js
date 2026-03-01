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
    const url = 'https://www.ldlc.com/promotions/';
    const res = await fetch(url, { headers: HEADERS, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // LDLC uses well-structured listing with .pdt-item or .listing-product items
    $('.pdt-item, .product-item, .listing-product__item, [class*="product-card"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.pdt-desc a, .title-3 a, [class*="title"] a, h3 a').first().text().trim();
      const link = $el.find('.pdt-desc a, .title-3 a, [class*="title"] a, h3 a').first().attr('href') || '';
      const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
      const price = parsePrice($el.find('.price, .pdt-price .price, [class*="price"]:not([class*="old"])').first().text());
      const originalPrice = parsePrice($el.find('.old-price, .pdt-price .old, [class*="crossed"], [class*="before"]').first().text());
      const ean = $el.attr('data-ean') || $el.attr('data-product-ean') || null;

      if (title) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `https://www.ldlc.com${link}`,
          image,
          merchant: 'LDLC',
          source: 'ldlc.com',
          ean,
          category: $el.find('[class*="category"], .pdt-cat').first().text().trim() || null,
        });
      }
    });

    // NOTE: LDLC serves mostly server-side HTML, but some sections may need JS
  } catch (err) {
    console.error('deals-ldlc error:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
