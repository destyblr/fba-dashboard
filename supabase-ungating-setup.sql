-- =====================================================
-- Table ungating_brands — tracking des marques à ungater
-- Exécuter dans Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS ungating_brands (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_name text UNIQUE NOT NULL,
  status text DEFAULT 'a_acheter',        -- a_acheter | commande | en_attente | ungated
  wholesale_source text,                   -- nom/lien du grossiste
  nb_gated_asins int DEFAULT 0,
  avg_bsr numeric,
  score numeric DEFAULT 0,
  notes text,
  ungated_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_ungating_brands_status ON ungating_brands(status);
CREATE INDEX IF NOT EXISTS idx_ungating_brands_name ON ungating_brands(brand_name);

-- RLS : autoriser lecture/écriture avec la clé anon (dashboard public)
ALTER TABLE ungating_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON ungating_brands
  FOR ALL USING (true) WITH CHECK (true);

-- Ajouter colonne brand_type à skipped_asins si pas déjà présente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'skipped_asins' AND column_name = 'brand_enriched_at'
  ) THEN
    ALTER TABLE skipped_asins ADD COLUMN brand_enriched_at timestamptz;
  END IF;
END $$;
