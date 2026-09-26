# La classe de Monsieur Dinsart, infos

PWA minimaliste à sens unique. Les parents installent la PWA et activent Web Push. `/admin/` est réservé à Monsieur Dinsart. L’envoi Push se fait côté serveur via une Supabase Edge Function. Le frontend est compatible GitHub Pages sous un sous-chemin de dépôt.

## Sécurité
Les valeurs SUPABASE_URL, SUPABASE_ANON_KEY et VAPID_PUBLIC_KEY sont publiques. Ne jamais placer VAPID_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY ou le mot de passe administrateur dans GitHub.

## Limite des statistiques
Le compteur d’envoi indique qu’un service Push a accepté le message. Le Web Push standard ne donne pas une preuve nominative de lecture par le parent.
