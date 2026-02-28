const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
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
    const url = 'https://www.cdiscount.com/search/10/promotions.html';
    const res = await fetch(url, { headers: HEADERS, timeout: 10000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Cdiscount uses .prdtBILTit for title, .prdtBILPrice for price block
    $('.prdtBIL, .product-card, [class*="product-item"], .jsPrdtBIL').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.prdtBILTit, .product-card__title, [class*="title"]').first().text().trim();
      const link = $el.find('a.prdtBILA, a[href*="/f-"]').first().attr('href') || $el.find('a').first().attr('href') || '';
      const image = $el.find('img.prdtBILImg, img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
      const price = parsePrice($el.find('.prdtBILPrice .price, [class*="price-current"], .prdtPrice').first().text());
      const originalPrice = parsePrice($el.find('.prdtBILPrice .oldprice, [class*="price-old"], .prdtPriceSt').first().text());
      const ean = $el.attr('data-ean') || $el.attr('data-product-ean') || null;

      if (title) {
        deals.push({
          title,
          price,
          originalPrice,
          link: link.startsWith('http') ? link : `https://www.cdiscount.com${link}`,
          image,
          merchant: 'Cdiscount',
          source: 'cdiscount.com',
          ean,
          category: $el.find('.prdtBILCat, [class*="category"]').first().text().trim() || null,
        });
      }
    });

    // NOTE: Cdiscount heavily uses client-side rendering; static scrape may return []
  } catch (err) {
    console.error('deals-cdiscount error:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(deals),
  };
};
