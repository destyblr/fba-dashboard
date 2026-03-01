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
    const targetUrl = 'https://www.fnac.com/tous-les-bons-plans/s1';
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

    // Fnac bons-plans: article.thumbnail containers
    $('article.thumbnail').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.thumbnail-titleLink, .thumbnail-title a').first().text().replace(/\s+/g, ' ').trim();
      const link = $el.find('a').first().attr('href') || '';
      const image = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
      const price = parsePrice($el.find('.thumbnail-price').first().text());
      const originalPrice = parsePrice($el.find('.thumbnail-oldPrice, .f-priceOld, del').first().text());
      const productId = $el.find('[data-product-id]').attr('data-product-id') || null;

      if (title && price) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `https://www.fnac.com${link}`,
          image,
          merchant: 'Fnac',
          source: 'fnac.com',
          ean: null,
          category: $el.find('.thumbnail-sub').first().text().trim() || null,
        });
      }
    });
  } catch (err) {
    console.error('deals-fnac error:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
