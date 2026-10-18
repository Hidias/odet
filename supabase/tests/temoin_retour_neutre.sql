-- Essai neutre du lot témoin (supabase/lots/temoin.conf) : ne modifie rien et se termine par l'erreur
-- volontaire attendue par scripts/migrations/lancer.sh. Sert seulement à vérifier l'action « Migrations en production ».
do $$
begin
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE (lot témoin, tout est annulé)\n0 écart(s) avec l''état d''avant (aucun)';
end
$$;
