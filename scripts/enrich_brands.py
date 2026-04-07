"""
Enrichissement des brands — Script VPS

Lit les skipped_asins sans brand dans Supabase,
appelle SP-API Catalog pour obtenir la marque,
met à jour Supabase.

Usage (sur le VPS) :
    python3 enrich_brands.py

Nécessite : SUPABASE_URL, SUPABASE_KEY, SP_CLIENT_ID, SP_CLIENT_SECRET, SP_REFRESH_TOKEN
"""
import os
import time
import requests
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

# ── Config ──────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SP_CLIENT_ID = os.getenv("SP_CLIENT_ID")
SP_CLIENT_SECRET = os.getenv("SP_CLIENT_SECRET")
SP_REFRESH_TOKEN = os.getenv("SP_REFRESH_TOKEN")
MARKETPLACE_ID = "A13V1IB3VIYZZH"  # FR

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def get_lwa_token():
    """Obtenir un access token Amazon LWA."""
    resp = requests.post("https://api.amazon.com/auth/o2/token", data={
        "grant_type": "refresh_token",
        "refresh_token": SP_REFRESH_TOKEN,
        "client_id": SP_CLIENT_ID,
        "client_secret": SP_CLIENT_SECRET,
    })
    data = resp.json()
    if "access_token" not in data:
        raise Exception(f"LWA token failed: {data}")
    return data["access_token"]


def get_brand_from_catalog(asin: str, token: str) -> str | None:
    """Appelle SP-API Catalog Items pour obtenir le brandName."""
    url = f"https://sellingpartnerapi-eu.amazon.com/catalog/2022-04-01/items/{asin}"
    resp = requests.get(url, params={
        "marketplaceIds": MARKETPLACE_ID,
        "includedData": "summaries",
    }, headers={
        "x-amz-access-token": token,
        "Content-Type": "application/json",
    })

    if resp.status_code == 429:
        # Rate limit — attendre et réessayer
        time.sleep(2)
        return get_brand_from_catalog(asin, token)

    if resp.status_code != 200:
        print(f"  SP-API {resp.status_code} pour {asin}")
        return None

    data = resp.json()
    summaries = data.get("summaries", [])
    if summaries:
        return summaries[0].get("brandName")
    return None


def enrich_batch(batch_size: int = 50):
    """Enrichit un batch d'ASINs sans brand."""
    # Récupérer les ASINs sans brand
    resp = (
        sb.table("skipped_asins")
        .select("id, asin")
        .is_("brand", "null")
        .is_("brand_enriched_at", "null")
        .limit(batch_size)
        .execute()
    )
    asins = resp.data or []

    if not asins:
        print("Tous les ASINs sont déjà enrichis !")
        return 0

    print(f"{len(asins)} ASINs à enrichir...")

    token = get_lwa_token()
    enriched = 0

    for i, row in enumerate(asins):
        asin = row["asin"]
        brand = get_brand_from_catalog(asin, token)

        update = {"brand_enriched_at": datetime.utcnow().isoformat()}
        if brand:
            update["brand"] = brand
            enriched += 1

        sb.table("skipped_asins").update(update).eq("id", row["id"]).execute()

        if (i + 1) % 10 == 0:
            print(f"  [{i+1}/{len(asins)}] {enriched} enrichis")

        # SP-API rate limit : ~2 req/sec
        time.sleep(0.6)

        # Refresh token toutes les 40 requêtes
        if (i + 1) % 40 == 0:
            token = get_lwa_token()

    print(f"\n=== {enriched}/{len(asins)} enrichis ===")
    return enriched


if __name__ == "__main__":
    total = 0
    while True:
        count = enrich_batch(50)
        total += count
        if count == 0:
            break
        print(f"Total enrichis : {total}\n")
    print(f"\nTerminé — {total} ASINs enrichis au total")
