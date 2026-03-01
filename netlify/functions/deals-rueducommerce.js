const fetch = require('node-fetch');
const cheerio = require('cheerio');

function parsePrice(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^\d,\.]/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

exports.handler = async () => {
  const deals = [];
  try {
    const SCRAPER_KEY = process.env.SCRAPERAPI_KEY;
    const targetUrl = 'https://www.rueducommerce.fr/rayon/bons-plans-58';
    const fetchUrl = SCRAPER_KEY
      ? `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(targetUrl)}`
      : targetUrl;

    const res = await fetch(fetchUrl, {
      headers: SCRAPER_KEY ? {} : {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      timeout: 60000,
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // RdC uses swiper slides with data-product-id for product carousels
    const seen = new Set();
    $('.swiper-slide[data-product-id]').each((_, el) => {
      const $el = $(el);
      const productId = $el.attr('data-product-id');
      if (seen.has(productId)) return; // avoid duplicates from multiple carousels
      seen.add(productId);

      const title = $el.find('img').first().attr('alt') || $el.find('a').first().text().replace(/\s+/g, ' ').trim();
      const link = $el.find('a[href]').first().attr('href') || '';
      const image = $el.find('img').first().attr('src') || '';
      const price = parsePrice($el.find('.price').first().text());
      const originalPrice = parsePrice($el.find('.price-old, .price--old, del, s').first().text());

      if (title && price) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `https://www.rueducommerce.fr${link}`,
          image,
          merchant: 'Rue du Commerce',
          source: 'rueducommerce.fr',
          ean: null,
          category: null,
        });
      }
    });
  } catch (err) {
    console.error('deals-rueducommerce error:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
