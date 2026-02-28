const fetch = require('node-fetch');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function parsePrice(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^\d,.\-]/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

exports.handler = async () => {
  const deals = [];

  try {
    const res = await fetch('https://www.saturn.de/de/campaign/angebote', {
      headers: HEADERS,
      timeout: 10000,
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Saturn shares the same CMS platform as MediaMarkt — nearly identical markup.
    // Note: if the page is fully client-side rendered, cheerio will return [].
    $('[data-test="product-card"], [class*="ProductCard"], [class*="product-card"]').each((_, el) => {
      const card = $(el);
      const title = card.find('[data-test="product-title"], [class*="ProductTitle"], h2, h3').first().text().trim();
      const link = card.find('a[href*="/product/"], a[href*="/p/"]').first().attr('href') || '';
      const image = card.find('img').first().attr('src') || card.find('img').first().attr('data-src') || '';
      const priceText = card.find('[data-test="current-price"], [class*="Price"]:not([class*="old"]):not([class*="struck"])').first().text();
      const originalPriceText = card.find('[data-test="old-price"], [class*="StrikePrice"], [class*="old-price"]').first().text();
      const ean = card.attr('data-ean') || card.attr('data-gtin') || card.find('[data-ean]').attr('data-ean') || null;

      if (!title) return;

      deals.push({
        title,
        price: parsePrice(priceText),
        originalPrice: parsePrice(originalPriceText),
        link: link.startsWith('http') ? link : link ? `https://www.saturn.de${link}` : null,
        image: image.startsWith('http') ? image : image ? `https://www.saturn.de${image}` : null,
        merchant: 'Saturn',
        source: 'saturn.de',
        ean: ean || null,
        category: null,
      });
    });
  } catch (err) {
    console.error('[deals-saturn] Scrape failed:', err.message);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(deals),
  };
};
