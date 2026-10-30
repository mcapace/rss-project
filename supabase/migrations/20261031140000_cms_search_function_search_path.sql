-- Pin the search functions' search_path (Supabase security advisor 0011).
ALTER FUNCTION public.cms_search_documents(text[], text, text, text, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.cms_search_media(text[], text, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.cms_search_keywords(text[], text, integer) SET search_path = public, pg_temp;
