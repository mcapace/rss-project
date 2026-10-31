-- Recommendations for bottle and producer pages too.
ALTER TABLE public.wa_recommendations DROP CONSTRAINT IF EXISTS wa_recommendations_kind_check;
ALTER TABLE public.wa_recommendations ADD CONSTRAINT wa_recommendations_kind_check CHECK (kind IN ('story', 'cocktail', 'bottle', 'producer'));
