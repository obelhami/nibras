# Nibras — Détail de chaque test unitaire (388 tests)

Chaque titre de test est déjà rédigé comme une affirmation vérifiable (scénario → résultat attendu).
Ce document les liste tous, groupés par fichier puis par bloc `describe`, avec le contexte de ce qui est réellement exécuté (vraie fonction importée, ou logique extraite testée en pur).

---

## `auth-routes.test.ts`
*Logique métier extraite de `routes/auth.ts` (OAuth Google, /auth/me, vérification email).*

**Google OAuth callback — validation du state (anti-CSRF)**
- state absent → invalide
- state inconnu du store (jamais émis par nous) → invalide
- state connu → valide
- le state est à usage unique : une fois consommé (delete), il redevient invalide

**Google OAuth — redirection selon rôle existant**
- utilisateur avec un rôle déjà défini → /dashboard
- nouvel utilisateur sans rôle → /choose-role

**/auth/me — dérivation du fallback de nom depuis l'email**
- extrait la partie locale d'un email standard
- chaîne vide → split("@")[0] renvoie "" (jamais undefined), le fallback "user" ne se déclenche donc jamais ici
- email sans "@" (ex: nom d'utilisateur brut) → renvoie la chaîne telle quelle

**send-verification — résolution du username (cascade de fallback)**
- priorité 1 : le username en attente (pending payload)
- priorité 2 : le username du token si aucun pending
- priorité 3 : dérivé de l'email si rien d'autre disponible
- rejette uniquement le fallback purpose "verification" (BR: seuls les signups en attente)

**verify — expiration du token de vérification (24h)**
- token expiré (date passée) → true
- token encore valide (date future) → false
- expiresAt calculé à +24h depuis maintenant
- username vérifié retombe sur la partie locale de l'email si le payload est vide

---

## `behavior.test.ts`
*Moteur comportemental `lib/behavior.ts` (Module 7) — vraies fonctions, DB mockée.*

**detectSilentOverload**
- utilisateur introuvable → confidence 0, aucun signal
- faible charge, aucun retard, aucune activité → confidence 0, aucun signal
- surcharge invisible avérée (25 tâches, 13 en retard, 6 en review bloquées, activité instable et nocturne) → signal détecté

**detectReviewSaturation**
- aucune tâche en review sur le projet → confidence 0, aucun signal
- file de review massivement saturée et bloquée → signal détecté
- quelques tâches en review, sous le seuil de backlog → pas de signal

**analyzeContributionStyle — contrat général**
- utilisateur introuvable → style par défaut "stabilizer", confidence 0
- aucune tâche assignée → renvoie un style valide avec une confiance bornée entre 0 et 1
- beaucoup de tâches critiques/urgentes livrées vite → ne doit PAS être classé "team_support" ni "debt_generator"
- n'appelle jamais getProjectReviewTasks (hors scope de cette fonction)

---

## `board-columns-routes.test.ts`
*Logique métier extraite de `routes/board/columns.routes.ts`.*

**POST columns — validations et calcul de position**
- première colonne d'un board (aucune existante) → position 0
- board avec colonnes 0,1,2 → nouvelle colonne en position 3
- nom vide (après trim) → rejeté
- BR : un slug déjà utilisé sur ce board → conflit (409)

**PATCH columns — construction dynamique des updates**
- aucun champ → erreur "No column changes provided"
- renommage vide → erreur "Column name cannot be empty"
- renommage seul → met à jour name ET slug ensemble
- position seule (0 est une valeur valide, pas "falsy")
- renommage + repositionnement en même temps → 3 champs mis à jour
- BR : renommer vers un slug déjà utilisé par une AUTRE colonne → conflit

**DELETE column — protection si des tâches y sont encore rattachées**
- colonne vide → suppression autorisée
- colonne contenant au moins une tâche → suppression bloquée (409)

---

## `board-metrics.test.ts`
*`recalculateBoardState` de `routes/board/metrics.ts` — vraie fonction, DB mockée.*

**recalculateBoardState — board introuvable**
- retourne null sans planter

**recalculateBoardState — métriques globales**
- board vide → toutes les métriques à 0
- taux de complétion calculé correctement (2 done / 4 total = 50%)
- complexité moyenne arrondie à 2 décimales, tâches sans complexité comptées comme 0
- tâches sans assignee comptées dans unassignedTasks
- répartition par colonne (byColumn) reflète le nombre de tâches par colonne

**recalculateBoardState — signaux comportementaux (weak signals)**
- tâche non-assignée + complexité >= 4 → signal "unassigned_high_complexity"
- tâche non-assignée mais complexité < 4 → aucun signal
- tâche en retard (due_date passée, pas "done") → signal "overdue" critique
- tâche "done" en retard → PAS de signal overdue (livrée, peu importe la date)
- échéance proche (<=2 jours, pas encore dépassée) → signal "deadline_risk" moyen
- échéance lointaine (>2 jours) → aucun signal de délai
- persiste les signaux : DELETE puis INSERT dans task_signals, puis upsert board_metrics

---

## `board-routes.test.ts`
*Logique métier extraite de `routes/board/boards.routes.ts`.*

**POST /boards — validation de la visibilité**
- valeurs autorisées : private, team, public
- valeur non reconnue → rejetée
- visibilité absente → défaut "private"

**POST /boards — BR : team_id obligatoire**
- teamId vide → refusé (400)
- teamId fourni → accepté

**POST/PATCH /boards — autorisation de rattachement à une équipe**
- le manager propriétaire de l'équipe peut rattacher son board
- un admin peut toujours rattacher n'importe quelle équipe
- un manager D'UNE AUTRE équipe ne peut pas rattacher
- un developer ne peut jamais rattacher une équipe

**POST /boards — colonnes personnalisées (dédoublonnage par slug)**
- aucune colonne fournie ou toutes invalides → fallback DEFAULT_COLUMNS
- colonnes personnalisées valides → conservées telles quelles
- deux noms différents produisant le même slug → le second est ignoré (pas de doublon DB)

**PATCH /boards/:id — updates conditionnels**
- aucun champ → erreur "No board changes provided"
- titre vide → erreur
- BR : impossible de retirer l'équipe d'un board (teamId vide)
- visibilité invalide → erreur
- plusieurs champs valides en même temps → tous appliqués

**GET /boards/:id/members — board sans équipe**
- board sans team_id → retourne une liste vide sans interroger la DB
- board avec team_id → interroge les membres

---

## `board-shared.test.ts`
*`routes/board/shared.ts` — utilitaires purs + `getAccessibleBoard`/`getManageableBoard` (DB mockée).*

**slugifyColumnName**
- minuscule et remplace les espaces par des tirets
- retire les caractères spéciaux
- retire les tirets en début/fin de chaîne
- chaîne vide ou uniquement des symboles → fallback "column"
- espaces multiples consécutifs → un seul tiret

**normalizeText (board/shared.ts)**
- trim une chaîne
- valeur non-string → chaîne vide

**getAccessibleBoard — lecture (BR-06/BR-07 style)**
- board introuvable → 404
- le propriétaire du board a toujours accès
- manager a accès même à un board privé qu'il ne possède pas
- admin a accès à tout
- board public → accessible par n'importe quel développeur
- board privé + développeur hors équipe → 403 Forbidden
- board privé + développeur MEMBRE de l'équipe → accès autorisé
- board sans équipe (team_id null) + développeur externe → 403

**getManageableBoard — écriture (création/édition colonnes, tâches)**
- board introuvable → 404
- propriétaire du board peut toujours le gérer, même s'il est developer
- developer non-propriétaire ne peut pas gérer un board (create_board refusé)
- manager non-propriétaire peut quand même gérer (permission create_board)

---

## `board-tasks-routes.test.ts`
*Logique métier extraite de `routes/board/tasks.routes.ts`.*

**POST task — résolution de la priorité**
- priorité valide fournie → conservée
- priorité absente ou invalide → fallback "medium"

**Task — validation de la complexité**
- valeurs dans la plage 1-5 acceptées
- valeurs hors plage rejetées
- complexité non fournie (null) → valide (optionnelle)

**POST task — BR : assignation scoping équipe**
- board sans équipe → erreur spécifique
- assigneeId manquant → erreur
- assigneeId fourni mais hors équipe → erreur 403
- tout est valide → pas d'erreur (null)

**PATCH task — déclenchement du log de réassignation**
- nouvel assigné différent de l'actuel → doit être loggé
- même assigné (aucun changement réel) → ne doit PAS être loggé
- tâche jamais assignée (null) puis assignée → doit être loggé

**POST task — sélection de la colonne cible**
- aucune colonne spécifiée → première colonne du board par défaut
- colonne spécifiée et existante → utilisée
- colonne spécifiée mais inexistante → undefined (404 attendu)
- board sans aucune colonne → 400 attendu en amont (pas de sélection possible)

**PATCH task — updates conditionnels et validations associées**
- aucun champ → erreur "No task changes provided"
- titre vide → erreur
- priorité invalide → erreur
- complexité hors plage → erreur
- assigneeId vide → erreur
- plusieurs champs valides → tous appliqués (assigneeId produit 2 colonnes SQL)

**POST task/move — fallback colonne source**
- colonne source trouvée en DB → utilisée telle quelle
- colonne source supprimée entre-temps → fallback sur les valeurs de la tâche

---

## `business-rules.test.ts`
*Règles métier extraites de `project.ts`, `tasks.ts`, `teams.ts` (fichier déjà existant avant cette session).*

**Validate name**
- nom vide → invalide
- nom avec espaces → trimé
- nom valide → accepté
- valeur non-string → chaîne vide

**Validate status**
- status valide → accepté
- status invalide → rejeté
- status par défaut = active quand non fourni

**Validate dates**
- format YYYY-MM-DD valide → accepté
- format invalide → rejeté
- startDate <= endDate → valide
- startDate > endDate → invalide
- une date null → pas de comparaison (valide)

**Manager/admin control — canAccessProject logic**
- admin → toujours autorisé
- créateur du projet → autorisé
- créateur avec id "58.0" vs "58" → tolère le format float Turso
- manager lié via team → autorisé
- manager non créateur, non lié → refusé
- developer → toujours refusé sauf admin

**manager_id control — isTeamManager logic**
- admin → toujours manager de la team
- manager_id correspond → autorisé
- manager_id différent → refusé
- developer → refusé même si même id

**Prevent duplicates**
- email déjà membre → doublon détecté
- email nouveau → pas de doublon
- liste vide → jamais de doublon

**Close task — business validation**
- tâche déjà done → refusé
- tâche non assignée → refusé
- tâche avec assignee_email → autorisé
- tâche avec multi-assignee seulement → autorisé
- tâche doing avec assigné → autorisé

**riskScore validation**
- 0 → valide
- 100 → valide
- 50 → valide
- null → valide (reset)
- -1 → invalide
- 101 → invalide
- 150 → invalide

**Pagination logic**
- valeurs par défaut (page=1, limit=20)
- page 2, limit 10 → offset 10
- page négative → retombe sur 1
- limit > 100 → plafonnée à 100
- valeurs non numériques → valeurs par défaut

**Priority validation — Tasks API**
- priorités valides → acceptées
- priorité invalide → rejetée
- priorité absente → fallback sur medium (comportement Hamza)

**Complexity validation — Tasks API**
- 1 à 5 → valide
- null/undefined → valide (optionnel)
- 0, 6, négatif → invalide
- nombre décimal → invalide

**userId validation — Assignees**
- userId numérique valide → accepté
- userId vide → invalide
- userId non numérique → invalide
- userId négatif ou zéro → invalide

**Close task — tous les statuts source**
- todo → peut être fermée (si assignée)
- doing → peut être fermée (si assignée)
- review → peut être fermée (si assignée)
- done → ne peut pas être re-fermée

**Remove member — protection du manager propriétaire**
- retirer un membre normal → autorisé par le manager
- retirer le manager lui-même → refusé
- admin peut retirer un membre normal
- admin ne peut pas non plus retirer le manager
- non-manager essaie de retirer → refusé

**PATCH project — validation dates partielles**
- modifier startDate seule → comparaison avec endDate de la base
- modifier endDate seule → comparaison avec startDate de la base
- modifier startDate après endDate existante → invalide
- aucune date fournie → garde les deux de la base

**Error codes format — Validation & Errors Standard**
- tous les codes sont en MAJUSCULES
- aucun code ne contient de chiffres
- format de réponse erreur contient message et code
- code UNAUTHORIZED correspond au HTTP 401

**Role check — création de team**
- manager → peut créer une team
- admin → peut créer une team
- developer → ne peut pas créer une team
- rôle null/inconnu → ne peut pas créer une team

**PATCH project — status non modifié garde la valeur existante**
- status non fourni → garde le status de la base
- status fourni valide → mis à jour
- status fourni invalide → rejeté

**riskScore — validation type entier**
- entier valide → accepté
- décimal → invalide même dans la plage 0-100
- null → valide (reset)

**assignee_email legacy — sync après suppression du dernier assigné**
- retirer le primary assignee → email passe au suivant
- retirer le dernier assigné → assignee_email = null
- retirer un assigné non primary → assignee_email inchangé

**getCurrentUser — recherche par userId**
- payload avec userId → recherche par userId
- payload sans userId → fallback sur email
- payload vide → undefined

**History integration — BR-03**
- création de tâche → historique avec from=null
- move todo → doing → historique cohérent
- close → historique avec toSlug=done
- champs obligatoires présents dans chaque entrée

---

## `errors.test.ts`
*Vraies fonctions de `lib/errors.ts` (format d'erreur standard).*

**fail — construction générique de réponse d'erreur**
- fixe set.status et retourne message + code
- inclut "details" seulement si fourni

**unauthorized — 401**
- status 401, code UNAUTHORIZED, message par défaut
- message personnalisé accepté

**forbidden — 403**
- status 403, code FORBIDDEN

**notFound — 404**
- status 404, code NOT_FOUND

**validationError — 400**
- status 400, code VALIDATION_ERROR, avec details optionnels

**conflict — 409**
- status 409, code CONFLICT

**internalError — 500**
- status 500, code INTERNAL_ERROR, message par défaut ne fuite pas de détails techniques

**permissionDenied — respecte le status déjà fixé par requirePermission**
- si set.status est déjà 403 (permission refusée) → reste 403 FORBIDDEN
- si set.status n'est PAS 403 (ex: token invalide) → 401 UNAUTHORIZED
- si set.status est undefined → 401 UNAUTHORIZED par défaut

---

## `guard.test.ts`
*`requirePermission` de `lib/guard.ts` — vraie fonction, DB mockée.*

**requirePermission — authentification**
- header Authorization absent → 401, retourne null
- token invalide → 401, retourne null (aucune requête DB)

**requirePermission — autorisation basée sur le rôle**
- utilisateur introuvable en DB → 403, retourne null
- utilisateur sans rôle assigné (role=null) → 403
- developer tente create_project (non autorisé) → 403
- developer tente create_task (autorisé) → retourne l'utilisateur
- manager tente view_team_kpis (autorisé) → retourne l'utilisateur
- admin a accès à manage_users
- la recherche utilisateur se fait bien par email du token (pas par id)

---

## `jwt.test.ts`
*Vraies fonctions de `lib/jwt.ts` (génération/vérification JWT).*

**createAccessToken**
- génère un token vérifiable contenant userId, email, username, role
- sans id fourni → pas de champ userId dans le payload
- sans role fourni → pas de champ role dans le payload
- expire dans 15 minutes (JWT-01 constraint du projet Nibras)

**createRefreshToken**
- contient uniquement l'email, expire dans 7 jours

**createVerificationToken**
- contient purpose="verification", expire dans 24h

**verifyAuthToken — validation du header Authorization**
- header absent → null
- header sans préfixe "Bearer " → null
- token malformé → null (pas d'exception levée)
- token signé avec un AUTRE secret → rejeté (sécurité)
- token expiré → null
- token valide → retourne le payload complet avec iat/exp
- token de vérification email n'est pas confondu avec un access token (purpose distinct)

---

## `kpi-routes.test.ts`
*Logique métier extraite de `routes/kpi.ts` (contrôle d'accès + fenêtre temporelle).*

**GET /kpi/boards/:id — canViewBoardKpis**
- admin voit toujours les KPIs, même hors de son périmètre
- manager voit toujours les KPIs (BR-07 : dans son scope, jamais bloqué ici)
- propriétaire du board (même developer) → autorisé
- board public → tout le monde peut voir les KPIs
- BR-06 : developer hors équipe ne peut PAS voir les KPIs d'un board privé
- developer MEMBRE de l'équipe du board → autorisé
- board sans équipe (team_id null), non public, non propriétaire → refusé

**sinceIso — calcul de la fenêtre temporelle**
- 7 jours en arrière depuis une date de référence connue
- 0 jour → retourne l'instant présent
- 30 jours (fenêtre par défaut du Behavioral Layer) traverse un changement de mois

---

## `kpi.test.ts`
*Vraies fonctions de `lib/kpi.ts` (Module 6 — moteur KPI).*

**computeOperationalKpis — ADT (Average Delivery Time)**
- aucune tâche terminée → ADT = 0
- une tâche créée puis "done" 24h après → ADT = 24h = 1 jour
- plusieurs tâches → ADT = moyenne des délais
- ne compte que le PREMIER passage à "done" (pas les réouvertures)

**computeOperationalKpis — VRR (Validation & Release Rate)**
- 2 tâches passées en review, 1 seule livrée → VRR = 50%
- aucune tâche n'a atteint "review" → fallback done/total
- aucune tâche, aucun historique → VRR = 0
- toutes les tâches en review sont livrées → VRR = 100%

**computeOperationalKpis — ERR (Error Rate Ratio / rework)**
- mouvement en arrière (position décroissante) → compté comme rework
- lignes de création (from_position null) ignorées du calcul ERR
- aucun mouvement réel → ERR = 0

**computeOperationalKpis — Review Saturation**
- 2 tâches actives dont 1 en review → saturation = 50%
- tâches "done" exclues du dénominateur (tâches actives)
- aucune tâche active → saturation = 0 (pas de division par zéro)

**computeFocusScore — Focus Score (KPI-02)**
- aucune activité, aucune tâche → score parfait de 100 ("excellent")
- changements de contexte fréquents (tâches différentes consécutives) → pénalité
- mouvements consécutifs sur la MÊME tâche → pas de context switch
- tâches non terminées → pénalité plafonnée à 30
- note contenant "block" (insensible à la casse) → détectée comme blocker
- score ne descend jamais sous 0 (clamp)
- labels : excellent (>=80), good (>=60), fair (>=40), poor (<40)

**computeTeamPulse — Team Pulse (KPI-03)**
- équipe sans tâches → healthy, score = 100
- workload > 5 tâches/membre → état "overloaded"
- ratio de retard élevé (>40%) → état "critical" quel que soit le score
- beaucoup de blockers (>=5) → état "unstable"
- livraison après due_date → comptée comme "delayed"
- memberCount <= 0 → traité comme 1 (pas de division par zéro)

---

## `notifications.test.ts`
*Logique du système de notifications (Module 9, fichier déjà existant avant cette session).*

**Notification types**
- 9 types définis
- tous les types attendus présents

**Notification severities**
- 3 niveaux
- ordre info < warning < critical

**Payload task_assigned**
- type correct
- severity = info
- recipient correct
- message contient le titre
- message contient l'assigneur
- entityType = task
- entityId correct

**Payload overdue_task**
- type correct
- severity = warning
- message contient la due_date
- message contient le titre

**Payload blocker_alert**
- type correct
- severity = critical
- message mentionne blocked

**Payload review_saturation**
- type correct
- severity = critical
- recipient = manager
- message contient le count
- message contient le nom du board
- entityType = board

**Payload deadline_soon**
- type correct
- severity = warning
- message contient la date

**Règles de déduplication**
- notif overdue déjà envoyée aujourd'hui → skip
- notif overdue de la veille → ne pas skip
- autre tâche → ne pas skip
- aucune notif → envoi autorisé

**Permissions trigger endpoints**
- manager autorisé
- admin autorisé
- developer non autorisé
- guest non autorisé

**Seuil review saturation**
- 2 → pas saturé
- 3 → saturé (seuil exact)
- 7 → saturé
- 0 → pas saturé

**Isolation des notifications**
- owner peut lire sa notif
- autre user ne peut pas lire

**Principe non-punitif (BR-10)**
- message overdue non-punitif
- message blocker non-punitif
- message review saturation non-punitif

---

## `pagination-meta.test.ts`
*Vraies fonctions de `lib/pagination.ts` (complément à business-rules.test.ts).*

**parsePagination — options defaultLimit / maxLimit**
- defaultLimit personnalisé utilisé quand limit absent
- maxLimit personnalisé plafonne la limite demandée
- limit invalide (négative) → retombe sur defaultLimit fourni
- page=0 → retombe sur 1

**buildPaginationMeta — métadonnées renvoyées au frontend**
- total=0 → totalPages=0 (pas de division qui donne NaN ou Infinity)
- total exactement divisible par limit
- total non divisible par limit → arrondi au supérieur
- un seul élément → 1 page
- reflète fidèlement page/limit fournis, sans les recalculer

---

## `permissions.test.ts`
*Vraies fonctions de `lib/permissions.ts` (moteur de permissions par rôle).*

**hasPermission — role Developer**
- peut créer une tâche
- ne peut PAS créer de projet
- ne peut PAS créer de board
- ne peut PAS voir les KPIs d'équipe
- ne peut PAS gérer les utilisateurs

**hasPermission — role Manager**
- peut créer projet, board et tâche
- peut voir les KPIs d'équipe (dans son scope)
- ne peut PAS gérer les utilisateurs (réservé à Admin)

**hasPermission — role Admin**
- a accès à TOUTES les actions

**hasPermission — rôles invalides ou absents**
- role null → toujours refusé
- role undefined → toujours refusé
- role inconnu (typo, injection) → toujours refusé, jamais d'exception

**getPermissions — objet complet de permissions par rôle**
- developer → seul create_task est true
- manager → tout sauf manage_users
- admin → tout est true
- rôle invalide → objet complet avec tout à false (jamais undefined)

---

## `project-teams.test.ts`
*Logique métier extraite de `routes/project.ts` (liaison équipe-projet).*

**POST /projects/:id/teams — mapping erreur DB → code métier**
- violation de clé primaire (déjà liée) → CONFLICT (409)
- violation de contrainte UNIQUE → CONFLICT (409)
- toute autre erreur DB (connexion, syntaxe...) → INTERNAL_ERROR (500), jamais 409

**POST /projects/:id/teams — ordre des validations**
- projet introuvable → 404 avant même de vérifier l'accès ou l'équipe
- projet trouvé mais accès refusé → 403 avant de vérifier l'équipe
- accès autorisé mais équipe introuvable → 404 équipe
- tout valide → ok, liaison créée

---

## `tasks-teams-gaps.test.ts`
*Derniers gaps de `routes/tasks.ts` (commentaires) et `routes/teams.ts` (PATCH team).*

**POST /tasks/:id/comments — contenu requis**
- contenu vide (ou espaces uniquement) → erreur
- contenu non-string (undefined) → erreur
- contenu valide → pas d'erreur, trim appliqué

**PATCH /teams/:id — updates conditionnels**
- aucun champ fourni → erreur "No team changes provided"
- nom vide → erreur "Team name cannot be empty"
- managerId pointant vers un utilisateur inexistant → erreur de validation
- managerId valide → update appliqué
- nom + manager valides ensemble → 2 updates

---

## `token-route.test.ts`
*Vraie route Elysia `routes/token.ts` testée via `app.handle()`, DB mockée.*

**POST /auth/refresh**
- token inexistant en DB → 401 "Invalid refresh token"
- token expiré en DB → 401 + suppression du token
- signature invalide (token altéré) → 401 "Invalid refresh token"
- token valide mais utilisateur supprimé entre-temps → 401 "User not found"
- token valide + utilisateur existant → 200, nouveau accessToken émis avec le bon rôle
- body sans refreshToken → 422 (validation Elysia)

---

## `user-routes.test.ts`
*Logique métier extraite de `routes/user.ts` (register, login, role, patch profile).*

**POST /register — validation du format email**
- emails valides
- emails invalides

**POST /register — confirmation du mot de passe**
- mots de passe identiques → valide
- mots de passe différents → invalide
- sensible à la casse

**POST /register — vérification en attente (anti-doublon)**
- demande de vérification encore valide → bloque un nouvel envoi (409)
- demande de vérification expirée → autorise un nouvel essai

**POST /user/role — validation du rôle assigné**
- rôles valides acceptés
- rôle invalide rejeté
- BR : un rôle déjà assigné ne peut pas être réassigné (409)

**POST /login — conditions préalables**
- utilisateur inexistant → not_found
- compte non vérifié (is_verified=0) → not_verified
- is_verified manquant (undefined) → traité comme non vérifié
- compte vérifié → ok

**PATCH /profile — construction dynamique de la requête UPDATE**
- aucun champ fourni → erreur "No profile changes provided"
- username vide (espaces uniquement) → erreur
- username seul, valide → 1 update, pas d'erreur
- changement de mot de passe incomplet (champ manquant) → erreur
- nouveau mot de passe trop court (< 6 caractères) → erreur
- confirmation ne correspond pas → erreur
- changement de mot de passe complet et valide → 1 update
- username + mot de passe en même temps → 2 updates

**Refresh token — expiration à 7 jours**
- expire exactement 7 jours après la création

---


**Total : 388 tests**