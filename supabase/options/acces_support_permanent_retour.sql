-- Retour arrière du réglage facultatif : accès de support de la société n° 1 remis « à la demande »
-- (défaut du produit). À n'utiliser que si le retour arrière de 0270 à 0273 n'est pas joué (il supprime la table).
update public.companies set support_access_mode = 'on_demand'
 where is_instance_owner and support_access_mode = 'permanent';
