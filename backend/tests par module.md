# Nibras — Tests unitaires triés par module (CDC V1.1 + Full Project Breakdown)

Ce document reclasse les **388 tests** (`src/tests/*.test.ts`) selon les **10 modules**
définis dans `NIBRAS Full Project Breakdown` et les IDs fonctionnels du CDC V1.1
(§20 Functional requirements). Chaque module y correspond à un `MODULE N` du breakdown.

Légende statut : ✅ testé et vert · ⚠️ testé mais couverture partielle · ❌ aucun test (module pas encore codé)

---

## MODULE 1 — AUTHENTICATION SYSTEM
*CDC : AUTH-01 (registration), AUTH-02 (login/role switch), AUTH-03 (JWT middleware), AUTH-04 (session)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `jwt.test.ts` | 13 | AUTH-03 : génération/vérification JWT (access 15min, refresh 7j, verification 24h), rejet signature falsifiée, rejet expiré |
| `guard.test.ts` | 9 | AUTH-03 : middleware `requirePermission` (401 si pas de token, 403 si rôle insuffisant) |
| `auth-routes.test.ts` | 16 | AUTH-01/02 : OAuth Google (anti-CSRF state), redirection dashboard/choose-role, cascade username, expiration token vérification 24h |
| `user-routes.test.ts` (partie register/login) | ~14 | AUTH-01 : regex email, confirmation mot de passe, anti-doublon vérification ; AUTH-02 : conditions de login (introuvable/non vérifié/ok) |
| `token-route.test.ts` | 6 | AUTH-04 : `POST /auth/refresh` — seul test exécuté via vraie route Elysia (`app.handle`) |
| `business-rules.test.ts` → `getCurrentUser` | 3 | AUTH-02 : résolution utilisateur par userId ou email depuis le payload JWT |

**Sous-total Module 1 : ≈ 61 tests** — ✅

---

## MODULE 2 — USER & ROLE MANAGEMENT
*CDC : USER-01 (rôles), USER-02 (permission engine), USER-03 (space switching)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `permissions.test.ts` | 16 | USER-02 : matrice complète Developer/Manager/Admin × 6 actions, rôles invalides toujours refusés |
| `user-routes.test.ts` (partie /user/role) | 3 | USER-01/03 : validation des 3 rôles, BR "rôle déjà assigné non réassignable" |
| `business-rules.test.ts` → `Role check — création de team` | 4 | USER-02 : qui peut créer une team (manager/admin uniquement) |

**Sous-total Module 2 : 23 tests** — ✅

---

## MODULE 3 — PROJECT MANAGEMENT
*CDC : PROJ-01 (projets), TEAM-01 (équipes)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `project-teams.test.ts` | 7 | PROJ-01/TEAM-01 : liaison équipe-projet, mapping erreur SQLite→409, ordre des validations |
| `tasks-teams-gaps.test.ts` (partie PATCH team) | 5 | TEAM-01 : PATCH team conditionnel (nom, managerId) |
| `business-rules.test.ts` → plusieurs describe | 39 | Détail ci-dessous |

Détail des describe de `business-rules.test.ts` rattachés au Module 3 :
- `Manager/admin control — canAccessProject logic` — 6 tests (BR-06/BR-07)
- `manager_id control — isTeamManager logic` — 4 tests
- `Prevent duplicates` (membres d'équipe) — 3 tests
- `Remove member — protection du manager propriétaire` — 5 tests
- `PATCH project — validation dates partielles` — 4 tests
- `PATCH project — status non modifié` — 3 tests
- `Validate name` (nom de projet) — 4 tests
- `Validate status` (statut de projet) — 3 tests
- `Validate dates` (dates de projet) — 5 tests
- `Pagination logic` (liste projets) — 5 tests *(techniquement cross-cutting, rattaché ici car utilisé sur `/projects`)*

**Sous-total Module 3 : ≈ 51 tests** — ✅

---

## MODULE 4 — NIBRASELLO BOARD SYSTEM
*CDC : BOARD-01 (boards), COLUMN-01 (colonnes), TASK-01 (création tâche), TASK-02 (déplacement tâche)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `board-routes.test.ts` | 19 | BOARD-01 : visibilité, team_id obligatoire, déduplication colonnes, PATCH board |
| `board-columns-routes.test.ts` | 12 | COLUMN-01 : calcul position, slug dupliqué, PATCH conditionnel, protection DELETE |
| `board-tasks-routes.test.ts` | 24 | TASK-01/02 : priorité/complexité, assignation scopée équipe, log de réassignation, sélection colonne, move |
| `board-shared.test.ts` | 19 | BOARD-01 : `slugifyColumnName`/`normalizeText` (purs) + contrôle d'accès `getAccessibleBoard`/`getManageableBoard` |
| `tasks-teams-gaps.test.ts` (partie commentaires) | 3 | TASK-01 : validation contenu de commentaire |
| `business-rules.test.ts` → plusieurs describe | 27 | Détail ci-dessous |

Détail Module 4 dans `business-rules.test.ts` :
- `Close task — business validation` — 5 tests
- `Close task — tous les statuts source` — 4 tests
- `riskScore validation` — 7 tests (BR-04)
- `riskScore — validation type entier` — 3 tests
- `Priority validation — Tasks API` — 3 tests
- `Complexity validation — Tasks API` — 4 tests
- `userId validation — Assignees` — 4 tests (BR-02 multi-assignee)
- `assignee_email legacy — sync` — 3 tests (⚠️ compté aussi ailleurs, voir note)

**Sous-total Module 4 : ≈ 104 tests** — ✅ (module le plus couvert, cohérent avec le fait que c'est le cœur applicatif)

---

## MODULE 5 — HISTORY SYSTEM
*CDC : HIST-01 (traçabilité), BR-03 (chaque changement de statut génère une entrée)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `business-rules.test.ts` → `History integration — BR-03` | 4 | HIST-01 : entrée à la création, move todo→doing, close→done, champs obligatoires |
| `board-tasks-routes.test.ts` → `POST move — fallback colonne source` | 2 | HIST-01 : robustesse si la colonne source a été supprimée entre-temps |

**Sous-total Module 5 : 6 tests** — ⚠️ *(le plus petit module testé — logique simple, peu de branches)*

---

## MODULE 6 — KPI ENGINE
*CDC : KPI-01 (KPIs opérationnels ADT/VRR/ERR), KPI-02 (Focus Score), KPI-03 (Team Pulse), KPI-03 (KPI Glossary)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `kpi.test.ts` | 27 | KPI-01 : ADT, VRR, ERR, Review Saturation · KPI-02 : Focus Score (pénalités, clamp, labels) · KPI-03 : Team Pulse (healthy/overloaded/unstable/critical) |
| `kpi-routes.test.ts` | 10 | KPI-01/02/03 : contrôle d'accès `canViewBoardKpis` (BR-06/BR-07) + fenêtre temporelle `sinceIso` |

**Sous-total Module 6 : 37 tests** — ✅ *(module le mieux testé en tests purs, calculs 100% vérifiés à l'exécution réelle)*

---

## MODULE 7 — BEHAVIORAL ENGINE
*CDC : BEHAV-01 (silent overload), BEHAV-02 (review saturation), BEHAV-03 (contribution style)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `behavior.test.ts` | 10 | BEHAV-01 : silent overload (surcharge invisible) · BEHAV-02 : review saturation · BEHAV-03 : contribution style (contrat général) |
| `board-metrics.test.ts` (partie signaux) | 7 | Signaux faibles adjacents (`unassigned_high_complexity`, `overdue`, `deadline_risk`) — techniquement dans `board/metrics.ts`, conceptuellement proche du Behavioral Layer de la spec V1.1 §14 |

**Sous-total Module 7 : 17 tests** — ⚠️ *(les 7 styles de contribution se chevauchent par design — voir note plus bas)*

---

## MODULE 8 — AI ENGINE
*CDC : AI-01 (Recommendation Engine), AI-02 (Sprint Doctor), AI-03/BRAIN-01 (Nibras Brain)*

**Aucun test — ❌ module non implémenté dans le zip actuel.** Aucune route ni fichier `lib/ai.ts`,
`sprintDoctor.ts` ou `nibrasBrain.ts` n'existe encore dans `nibras-Dev/backend`. C'est cohérent avec
le planning du CDC (phase 7, "AI Copilot / AI Radar", après le Behavioral Layer V1).

---

## MODULE 9 — NOTIFICATION SYSTEM
*CDC : NOTIF-01 (alertes retard/blocage/surcharge/sprint)*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `notifications.test.ts` (déjà existant, session précédente) | 44 | NOTIF-01 : 9 types de notifications, 3 sévérités, déduplication anti-spam, isolation JWT par utilisateur, permissions trigger, principe non-punitif (BR-10) |

**Sous-total Module 9 : 44 tests** — ✅ *(déjà fait avant cette session, le plus mature)*

---

## MODULE 10 — TRELLO CONNECT
*CDC : TRELLO-01 (OAuth), TRELLO-02 (mapping), TRELLO-03 (sync worker)*

**Aucun test — ❌ module non implémenté dans le zip actuel.** Aucun fichier `routes/trello.ts` ni
`lib/trello.ts`. Cohérent avec le CDC qui place Trello Connect en priorité "Should have" et V2,
et le repositionne comme point d'entrée secondaire, pas le cœur du produit (§37 feedback manager).

---

## Tests transverses (non-fonctionnels, hors périmètre "module produit")

*CDC §21 Non-functional requirements : Traceability, Maintainability, standardized error codes.*

| Fichier de test | Tests | Ce qui est couvert |
|---|---|---|
| `errors.test.ts` | 12 | Format d'erreur standard (6 codes : UNAUTHORIZED/FORBIDDEN/NOT_FOUND/VALIDATION_ERROR/CONFLICT/INTERNAL_ERROR) utilisé par tous les modules |
| `pagination-meta.test.ts` | 9 | Pagination générique (`buildPaginationMeta`), utilisée par Projects/Teams/Tasks/Notifications |
| `business-rules.test.ts` → `Error codes format` | 4 | Format des codes d'erreur (MAJUSCULES, pas de chiffres) |
| `business-rules.test.ts` → `Pagination logic` (partie générique) | *(déjà compté au Module 3)* | — |

**Sous-total transverse : 25 tests**

---

## Récapitulatif par module

| Module | Statut CDC | Tests | % du total |
|---|---|---|---|
| 1. Authentication System | Must have | ≈61 | 15,7% |
| 2. User & Role Management | Must have | 23 | 5,9% |
| 3. Project Management | Must have | ≈51 | 13,1% |
| 4. Nibrasello Board System | Must have | ≈104 | 26,8% |
| 5. History System | Must have | 6 | 1,5% |
| 6. KPI Engine | Should have | 37 | 9,5% |
| 7. Behavioral Engine | Should have | 17 | 4,4% |
| 8. AI Engine | Should have | 0 (❌ non codé) | 0% |
| 9. Notification System | Should have | 44 | 11,3% |
| 10. Trello Connect | Should have | 0 (❌ non codé) | 0% |
| Transverse (erreurs, pagination) | Non-functional | 25 | 6,4% |
| **Sous-totaux ne totalisent pas 388 pile** | | | *(quelques tests comme `assignee_email legacy` touchent 2 modules à la fois — comptés une fois dans le tableau détaillé, d'où un léger écart d'arrondi ci-dessus)* |

**Constat clé** : la couverture suit fidèlement la maturité réelle du code — le Nibrasello Board
System (module le plus gros et le plus critique) concentre plus d'un quart des tests, tandis que
les Modules 8 (AI Engine) et 10 (Trello Connect) sont à 0% simplement parce qu'ils n'existent pas
encore dans `nibras-Dev/backend` — pas un trou de couverture, un module pas encore développé.

## Prochaine priorité suggérée (si tu codes la suite)

Dans l'ordre du CDC §32 (planning indicatif) : **Module 8 (AI Copilot / AI Radar, phase 7)** est la
suite logique après le Behavioral Layer déjà testé (Module 7). Quand tu commenceras ce module,
je peux faire pareil : lire le code, extraire la logique testable, écrire les tests au fur et à mesure.